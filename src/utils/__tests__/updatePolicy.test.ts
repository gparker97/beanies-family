import { describe, it, expect } from 'vitest';
import { decideForce, FORCE_CAP_MS, type ForceInput } from '../updatePolicy';

/** An input that forces on every screen; each case breaks exactly one thing. */
function input(overrides: Partial<ForceInput> = {}): ForceInput {
  return {
    authInitialized: true,
    screen: 'landing',
    editing: false,
    hasHash: false,
    oauthPending: false,
    swApplying: false,
    quietBlocker: null,
    trigger: 'visible',
    behindForMs: 0,
    userRequested: false,
    ...overrides,
  };
}

const FORCE = { force: true };
const blocked = (blocker: string) => ({ force: false, blocker });

describe('decideForce', () => {
  describe('landing (the idle login landing view)', () => {
    it('forces when every gate is open', () => {
      expect(decideForce(input())).toEqual(FORCE);
    });

    it('waits for the auth store to initialise', () => {
      expect(decideForce(input({ authInitialized: false }))).toEqual(blocked('auth-init'));
    });

    it('never reloads over a focused text field', () => {
      expect(decideForce(input({ editing: true }))).toEqual(blocked('editing'));
    });

    it('needs no cap (there is nothing open to lose)', () => {
      expect(decideForce(input({ behindForMs: 0 }))).toEqual(FORCE);
    });
  });

  describe('landing honours the general quiet rule (review fix)', () => {
    it.each(['overlay', 'escape-layer', 'syncing', 'not-ready'] as const)(
      'a routine check defers on the landing while %s',
      (quietBlocker) => {
        expect(decideForce(input({ quietBlocker }))).toEqual(blocked(quietBlocker));
      }
    );
  });

  describe('other (any login view past the landing, resume-setup, the create wizard)', () => {
    it('is never reloaded by the periodic check', () => {
      expect(decideForce(input({ screen: 'other' }))).toEqual(blocked('not-idle'));
      expect(decideForce(input({ screen: 'other', trigger: 'nav' }))).toEqual(blocked('not-idle'));
    });

    it('a newer-version file waives the idle and focus gates', () => {
      expect(decideForce(input({ screen: 'other', trigger: 'newer-file', editing: true }))).toEqual(
        FORCE
      );
    });

    it('a person’s tap waives the idle and focus gates', () => {
      expect(decideForce(input({ screen: 'other', userRequested: true, editing: true }))).toEqual(
        FORCE
      );
    });

    it('still waits for auth init, whoever asked', () => {
      expect(
        decideForce(input({ screen: 'other', trigger: 'newer-file', authInitialized: false }))
      ).toEqual(blocked('auth-init'));
      expect(
        decideForce(input({ screen: 'other', userRequested: true, authInitialized: false }))
      ).toEqual(blocked('auth-init'));
    });
  });

  describe('shell (a family is open)', () => {
    const shell = (o: Partial<ForceInput> = {}) => input({ screen: 'shell', ...o });

    it('waits for the cap on a routine check', () => {
      expect(decideForce(shell({ behindForMs: FORCE_CAP_MS - 1 }))).toEqual(
        blocked('cap-not-reached')
      );
      expect(decideForce(shell({ trigger: 'nav', behindForMs: 0 }))).toEqual(
        blocked('cap-not-reached')
      );
    });

    it('forces once the cap is reached and the app is quiet', () => {
      expect(decideForce(shell({ behindForMs: FORCE_CAP_MS }))).toEqual(FORCE);
      expect(decideForce(shell({ trigger: 'nav', behindForMs: FORCE_CAP_MS * 3 }))).toEqual(FORCE);
    });

    it('a newer-version file or a tap skips the cap', () => {
      expect(decideForce(shell({ trigger: 'newer-file' }))).toEqual(FORCE);
      expect(decideForce(shell({ userRequested: true }))).toEqual(FORCE);
    });

    it.each(['overlay', 'escape-layer', 'syncing', 'not-ready'] as const)(
      'never reloads while not quiet (%s), even past the cap or when asked',
      (quietBlocker) => {
        expect(decideForce(shell({ quietBlocker, behindForMs: FORCE_CAP_MS }))).toEqual(
          blocked(quietBlocker)
        );
        expect(decideForce(shell({ quietBlocker, trigger: 'newer-file' }))).toEqual(
          blocked(quietBlocker)
        );
        expect(decideForce(shell({ quietBlocker, userRequested: true }))).toEqual(
          blocked(quietBlocker)
        );
      }
    );

    it('never reloads over a focused text field, even for a newer-version file', () => {
      expect(decideForce(shell({ editing: true, behindForMs: FORCE_CAP_MS }))).toEqual(
        blocked('editing')
      );
      expect(decideForce(shell({ editing: true, trigger: 'newer-file' }))).toEqual(
        blocked('editing')
      );
    });

    it('auth-init is never waived, on the shell too', () => {
      expect(decideForce(shell({ authInitialized: false, behindForMs: FORCE_CAP_MS }))).toEqual(
        blocked('auth-init')
      );
    });

    it('a tap waives a lingering focus (a select, a checkbox), but never the quiet rule', () => {
      expect(decideForce(shell({ editing: true, userRequested: true }))).toEqual(FORCE);
      expect(decideForce(shell({ editing: true, trigger: 'newer-file' }))).toEqual(
        blocked('editing')
      );
      expect(
        decideForce(shell({ editing: true, userRequested: true, quietBlocker: 'overlay' }))
      ).toEqual(blocked('overlay'));
    });
  });

  describe('gates nothing ever waives', () => {
    const urgentCases: Array<[string, Partial<ForceInput>]> = [
      ['routine landing', {}],
      ['newer-file on other', { screen: 'other', trigger: 'newer-file' }],
      ['tap on other', { screen: 'other', userRequested: true }],
      ['tap on the shell', { screen: 'shell', userRequested: true }],
      ['newer-file on the shell', { screen: 'shell', trigger: 'newer-file' }],
    ];

    it.each(urgentCases)('a service-worker apply in flight blocks (%s)', (_l, o) => {
      expect(decideForce(input({ ...o, swApplying: true }))).toEqual(blocked('sw-applying'));
    });

    it.each(urgentCases)('a URL fragment blocks (%s)', (_l, o) => {
      expect(decideForce(input({ ...o, hasHash: true }))).toEqual(blocked('hash'));
    });

    it.each(urgentCases)('a pending interactive OAuth blocks (%s)', (_l, o) => {
      expect(decideForce(input({ ...o, oauthPending: true }))).toEqual(blocked('oauth'));
    });

    it('sw-applying outranks every other blocker (the two reload paths must not race)', () => {
      expect(
        decideForce(
          input({
            swApplying: true,
            hasHash: true,
            oauthPending: true,
            editing: true,
            authInitialized: false,
          })
        )
      ).toEqual(blocked('sw-applying'));
    });
  });
});
