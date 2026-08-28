import { describe, it, expect } from 'vitest';
import {
  transition,
  LOGIN_DESTINATION,
  type LoginFlowState,
  type PersonCard,
} from '@/services/auth/loginFlow';
import type { ProveMethod } from '@/services/auth/proveMethods';

const mum: PersonCard = { id: 'm-1', name: 'Mum', color: '#F15D22', hasCredential: true };
const kid: PersonCard = { id: 'm-2', name: 'Kid', color: '#AED6F1', hasCredential: false };
const people = [mum, kid];

const idle: LoginFlowState = { kind: 'idle' };

function started(): LoginFlowState {
  return transition(idle, {
    type: 'START',
    familyId: 'fam-1',
    familyName: 'The Beans',
    people,
    source: 'roster',
  });
}

function atProve(methods: ProveMethod[] = [{ kind: 'password' }]): LoginFlowState {
  let s = started();
  s = transition(s, { type: 'PICK_PERSON', person: mum });
  return transition(s, { type: 'METHODS_RESOLVED', methods });
}

function atOpening(): LoginFlowState {
  return transition(atProve(), {
    type: 'PROVE_SUCCEEDED',
    grant: { memberId: mum.id, fkAvailable: true },
  });
}

describe('loginFlow transition', () => {
  it('START enters person-select from any state', () => {
    const s = started();
    expect(s).toMatchObject({ kind: 'person-select', familyId: 'fam-1', people });
  });

  it('happy path: pick → methods → prove → succeed → opening → done at /nook', () => {
    let s = started();
    s = transition(s, { type: 'PICK_PERSON', person: mum });
    expect(s.kind).toBe('prove-loading');
    s = transition(s, {
      type: 'METHODS_RESOLVED',
      methods: [{ kind: 'password' }],
    });
    expect(s).toMatchObject({ kind: 'prove', person: mum, fallbackDepth: 0 });
    s = transition(s, { type: 'PROVE_SUCCEEDED', grant: { memberId: mum.id, fkAvailable: true } });
    expect(s).toMatchObject({ kind: 'opening', retry: false });
    s = transition(s, { type: 'OPEN_SUCCEEDED' });
    expect(s).toEqual({ kind: 'done', destination: LOGIN_DESTINATION });
  });

  it('a transport failure goes to recovery and NEVER back to a credential screen', () => {
    let s = atOpening();
    s = transition(s, { type: 'OPEN_FAILED', reason: 'auth' });
    expect(s).toMatchObject({ kind: 'open-recovery', reason: 'auth', grant: { memberId: mum.id } });
    // Retry re-enters opening with the same grant — identity is never re-asked.
    s = transition(s, { type: 'RECOVERY_RETRY' });
    expect(s).toMatchObject({ kind: 'opening', retry: true, grant: { memberId: mum.id } });
    s = transition(s, { type: 'OPEN_SUCCEEDED' });
    expect(s.kind).toBe('done');
  });

  it('wrong-password returns to prove-loading (fresh methods), not to recovery', () => {
    const s0 = transition(atProve(), { type: 'PASSWORD_SUBMITTED', memberId: mum.id });
    expect(s0).toMatchObject({ kind: 'opening', grant: { fkAvailable: false } });
    const s1 = transition(s0, { type: 'OPEN_FAILED', reason: 'wrong-password' });
    expect(s1).toMatchObject({ kind: 'prove-loading', person: mum, people });
  });

  it('BACK from prove restores the picker without re-querying; BACK from picker exits', () => {
    const s0 = transition(atProve(), { type: 'BACK' });
    expect(s0).toMatchObject({ kind: 'person-select', people, familyName: 'The Beans' });
    expect(transition(s0, { type: 'BACK' })).toEqual(idle);
  });

  it('fallback taps only bump depth', () => {
    let s = atProve();
    s = transition(s, { type: 'PROVE_FELL_BACK' });
    s = transition(s, { type: 'PROVE_FELL_BACK' });
    expect(s).toMatchObject({ kind: 'prove', fallbackDepth: 2 });
  });

  it('stale events from superseded effects are inert', () => {
    // METHODS_RESOLVED landing after the user already went BACK to the picker
    const picker = transition(atProve(), { type: 'BACK' });
    expect(
      transition(picker, { type: 'METHODS_RESOLVED', methods: [{ kind: 'password' }] })
    ).toEqual(picker);
    // A late OPEN_SUCCEEDED after exit
    expect(transition(idle, { type: 'OPEN_SUCCEEDED' })).toEqual(idle);
    // A late PROVE_SUCCEEDED while opening (double-fire) does not restart opening
    const opening = atOpening();
    expect(
      transition(opening, { type: 'PROVE_SUCCEEDED', grant: { memberId: 'x', fkAvailable: false } })
    ).toEqual(opening);
  });

  it('EXIT idles the machine from anywhere', () => {
    expect(transition(atProve(), { type: 'EXIT' })).toEqual(idle);
    expect(transition(atOpening(), { type: 'EXIT' })).toEqual(idle);
  });
});

describe('prove-time transport failure (web cold start)', () => {
  it('OPEN_FAILED from prove goes to recovery with a null grant; retry re-proves', () => {
    const prove = atProve([{ kind: 'password' }]);
    const rec = transition(prove, { type: 'OPEN_FAILED', reason: 'auth' });
    expect(rec).toMatchObject({ kind: 'open-recovery', grant: null, reason: 'auth' });
    const retry = transition(rec, { type: 'RECOVERY_RETRY' });
    expect(retry).toMatchObject({ kind: 'prove-loading', person: mum });
  });

  it('wrong-password from prove stays inert (only opening can judge a password)', () => {
    const prove = atProve();
    expect(transition(prove, { type: 'OPEN_FAILED', reason: 'wrong-password' })).toEqual(prove);
  });
});
