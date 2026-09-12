/**
 * The whole decision, tested as a table — no Pinia, no Vue, no localStorage.
 *
 * That is the point of keeping it pure. Two of these rules are the kind that must
 * be provable rather than argued about: the Drive guarantee (a dismissed CALENDAR
 * notice must never suppress a Drive data-at-risk warning) and the four-rung
 * ownership ladder, which has several ways to name the wrong person.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveConnectionOwner,
  decideOutageAudience,
  type CalendarDownDescriptor,
  type OwnerCandidate,
  type OutageAudienceInput,
} from '../connectionOwner';

function conn(over: Partial<CalendarDownDescriptor> = {}): CalendarDownDescriptor {
  return { connectionId: 'c1', email: 'mum@gmail.com', ...over };
}

function member(over: Partial<OwnerCandidate> = {}): OwnerCandidate {
  return { id: 'm-mum', email: 'mum@example.com', ...over };
}

describe('resolveConnectionOwner — the ladder', () => {
  it('rung 1: connectedBy wins, and reports how it decided', () => {
    const v = resolveConnectionOwner(conn({ connectedBy: 'm-dad' }), [
      member(),
      member({ id: 'm-dad' }),
    ]);
    expect(v).toEqual({ kind: 'member', memberId: 'm-dad', via: 'connected-by' });
  });

  it('🔴 rung 1 FALLS THROUGH when the recorded member has left the pod', () => {
    // Otherwise the notice reads "Ask Unknown to reconnect it", which is worse
    // than naming a manager: it tells the reader nothing and looks broken.
    const v = resolveConnectionOwner(conn({ connectedBy: 'm-gone' }), [
      member({ id: 'm-mum', googleAccountEmail: 'mum@gmail.com' }),
    ]);
    expect(v).toEqual({ kind: 'member', memberId: 'm-mum', via: 'google-email' });
  });

  it('🔴 rung 2 beats rung 3 — googleAccountEmail is the OAuth-bound identity', () => {
    // `email` is documented on the model as "not required to match any specific
    // external account", so a contact-email collision must not outrank the real
    // Google binding.
    const v = resolveConnectionOwner(conn({ email: 'shared@gmail.com' }), [
      member({ id: 'm-dad', email: 'shared@gmail.com' }),
      member({ id: 'm-mum', googleAccountEmail: 'shared@gmail.com' }),
    ]);
    expect(v).toEqual({ kind: 'member', memberId: 'm-mum', via: 'google-email' });
  });

  it('rung 3: the contact email matches when nothing better does', () => {
    const v = resolveConnectionOwner(conn({ email: 'dad@work.com' }), [
      member({ id: 'm-dad', email: 'dad@work.com' }),
    ]);
    expect(v).toEqual({ kind: 'member', memberId: 'm-dad', via: 'contact-email' });
  });

  it('matches case-insensitively, because Google emails are', () => {
    const v = resolveConnectionOwner(conn({ email: 'MUM@Gmail.COM' }), [
      member({ id: 'm-mum', googleAccountEmail: 'mum@gmail.com' }),
    ]);
    expect(v.kind).toBe('member');
  });

  it('rung 4: nobody matches, so pod managers own it — and the email is carried', () => {
    const v = resolveConnectionOwner(conn({ email: 'stranger@gmail.com' }), [member()]);
    expect(v).toEqual({ kind: 'managers', accountEmail: 'stranger@gmail.com' });
  });

  it("🔴 the 'unknown' sentinel matches nobody and is carried as null", () => {
    // `calendarSyncStore` writes the literal 'unknown' when consent returns no
    // address. Rendering "Ask whoever manages unknown to reconnect it" is the
    // failure this guards; null lets the caller pick the no-account wording.
    const v = resolveConnectionOwner(conn({ email: 'unknown' }), [
      member({ id: 'm-x', email: 'unknown' }),
      member({ id: 'm-y', googleAccountEmail: 'unknown' }),
    ]);
    expect(v).toEqual({ kind: 'managers', accountEmail: null });
  });

  it('🔴 a member whose only email is a generated placeholder never matches', () => {
    // `FamilyMember.email` is a REQUIRED string the app fills with placeholders
    // for pets and members added without an address, so a bare non-empty check
    // would let two of them both "own" a connection.
    const placeholders = [
      member({ id: 'm-pet', email: 'fluffy@temp.beanies.family' }),
      member({ id: 'm-new', email: 'pending-abc@setup.local' }),
    ];
    expect(
      resolveConnectionOwner(conn({ email: 'fluffy@temp.beanies.family' }), placeholders).kind
    ).toBe('managers');
    expect(
      resolveConnectionOwner(conn({ email: 'pending-abc@setup.local' }), placeholders).kind
    ).toBe('managers');
  });
});

function decide(over: Partial<OutageAudienceInput> = {}) {
  const base: OutageAudienceInput = {
    variant: 'calendar',
    downConnections: [conn({ connectedBy: 'm-mum' })],
    members: [member({ id: 'm-mum' }), member({ id: 'm-kid' })],
    viewerId: 'm-kid',
    viewerCanManagePod: false,
    dismissedIds: [],
  };
  return decideOutageAudience({ ...base, ...over });
}

describe('decideOutageAudience — the Drive guarantee', () => {
  /**
   * ⚠️ THE most important assertions in this file.
   *
   * Dismissals are keyed on CALENDAR connection ids. Without the early return,
   * a member who dismissed the calendar notice and then loses Drive would be
   * filtered straight to 'hidden' — the data-at-risk warning would vanish for
   * them, silently and permanently, without anyone touching the Drive code.
   */
  it.each(['drive', 'both'] as const)(
    '🔴 %s ALWAYS reaches everyone, even with every calendar id dismissed',
    (variant) => {
      expect(
        decide({
          variant,
          downConnections: [conn({ connectionId: 'c1' }), conn({ connectionId: 'c2' })],
          dismissedIds: ['c1', 'c2'],
        })
      ).toEqual({ mode: 'owner' });
    }
  );

  it('🔴 drive reaches a viewer even before the roster has loaded', () => {
    expect(decide({ variant: 'drive', members: [], viewerId: null })).toEqual({ mode: 'owner' });
  });

  it('🔴 drive reaches a viewer who owns nothing and manages nothing', () => {
    expect(decide({ variant: 'both', viewerId: 'm-stranger', viewerCanManagePod: false })).toEqual({
      mode: 'owner',
    });
  });
});

describe('decideOutageAudience — a calendar-only outage', () => {
  it('shows the actionable prompt to the resolved owner', () => {
    expect(decide({ viewerId: 'm-mum' })).toEqual({ mode: 'owner' });
  });

  it('shows a notice, carrying the verdict as data, to everyone else', () => {
    expect(decide({ viewerId: 'm-kid' })).toEqual({
      mode: 'notice',
      owner: { kind: 'member', memberId: 'm-mum', via: 'connected-by' },
    });
  });

  it('🔴 a viewer who owns ONE of two down connections still gets the action', () => {
    // Deliberately `some`, not `every`: the reconnect button already repairs
    // everything it can, so handing this person a notice with someone else's
    // name on it would be the bug this feature exists to prevent, inverted.
    expect(
      decide({
        viewerId: 'm-mum',
        downConnections: [
          conn({ connectionId: 'c1', connectedBy: 'm-mum' }),
          conn({ connectionId: 'c2', connectedBy: 'm-dad' }),
        ],
        members: [member({ id: 'm-mum' }), member({ id: 'm-dad' })],
      })
    ).toEqual({ mode: 'owner' });
  });

  it('a pod manager gets the action when nobody resolves as owner', () => {
    expect(
      decide({
        downConnections: [conn({ email: 'stranger@gmail.com' })],
        viewerCanManagePod: true,
      })
    ).toEqual({ mode: 'owner' });
  });

  it('a non-manager gets the managers notice when nobody resolves', () => {
    expect(decide({ downConnections: [conn({ email: 'stranger@gmail.com' })] })).toEqual({
      mode: 'notice',
      owner: { kind: 'managers', accountEmail: 'stranger@gmail.com' },
    });
  });

  it('🔴 renders NOTHING while the roster is empty', () => {
    // The toast mounts long before `members` fills, and `canManagePod` falls back
    // to the session role until it does — so deciding early flashes the wrong
    // prompt at whoever loads first.
    expect(decide({ members: [], viewerId: null })).toEqual({ mode: 'hidden', reason: 'roster' });
  });

  it('hides when nothing is actually down', () => {
    expect(decide({ downConnections: [] })).toEqual({ mode: 'hidden', reason: 'nothing-down' });
  });
});

describe('decideOutageAudience — dismissal', () => {
  it('stays hidden for the outage that was dismissed', () => {
    expect(decide({ dismissedIds: ['c1'] })).toEqual({ mode: 'hidden', reason: 'dismissed' });
  });

  it('speaks up again for a NEWLY broken connection', () => {
    expect(
      decide({
        downConnections: [
          conn({ connectionId: 'c1', connectedBy: 'm-mum' }),
          conn({ connectionId: 'c2', connectedBy: 'm-mum' }),
        ],
        dismissedIds: ['c1'],
      }).mode
    ).toBe('notice');
  });

  it('🔴 stays quiet when one of two dismissed connections HEALS', () => {
    // The defect a joined fingerprint would have shipped: dismissing "c1,c2" then
    // healing c2 leaves "c1", which differs from the stored key, so the notice
    // would return for an outage already dismissed twice — triggered by something
    // getting better.
    expect(
      decide({ downConnections: [conn({ connectionId: 'c1' })], dismissedIds: ['c1', 'c2'] })
    ).toEqual({ mode: 'hidden', reason: 'dismissed' });
  });

  it('🔴 a dismissal never suppresses the prompt for someone who can act', () => {
    expect(decide({ viewerId: 'm-mum', dismissedIds: ['c1'] })).toEqual({ mode: 'owner' });
  });
});

describe('decideOutageAudience — a manager is not automatically an owner', () => {
  /**
   * A code review read this asymmetry as a bug. It is deliberate, and greg's
   * instruction settles it: the person who set the integration up is the one who
   * repairs it. Managing the pod does not mean holding the Google account's
   * password, and the consent is account-bound — so offering a non-owning manager
   * the button would be a dead end dressed up as a fix.
   */
  it('🔴 a pod manager who is NOT the owner still gets the notice', () => {
    expect(decide({ viewerId: 'm-kid', viewerCanManagePod: true }).mode).toBe('notice');
  });

  it('but a manager DOES get the action once nobody resolves as owner', () => {
    // The stuck-family escape hatch: when the connector leaves the pod their id no
    // longer resolves and their emails no longer match, so the ladder lands on
    // rung 4 and the family is never stranded.
    expect(
      decide({
        downConnections: [conn({ connectedBy: 'm-departed' })],
        viewerCanManagePod: true,
      })
    ).toEqual({ mode: 'owner' });
  });
});
