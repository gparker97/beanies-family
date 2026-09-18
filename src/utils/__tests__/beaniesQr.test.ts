/**
 * Classifying a scanned beanies code.
 *
 * ⚠️ WHY IT MATTERS THAT THIS IS RIGHT. beanies draws three square black-and-white codes and
 * asks people to photograph them on three different screens, so scanning the wrong one is
 * the obvious mistake rather than an edge case. Before the classifier the error text lied
 * about it — `parseInviteLink` returns null for an approval URL, so the cold surface said
 * "check it copied fully" about a link that had copied perfectly.
 */
import { describe, it, expect } from 'vitest';
import { classifyBeaniesQr, wrongCodeMessageKey, type QrKind } from '../beaniesQr';

describe('classifyBeaniesQr', () => {
  it('recognises a device-approval code', () => {
    const r = classifyBeaniesQr('https://app.beanies.family/welcome#beanies-approve=ABC123');
    expect(r).toEqual({ kind: 'approval', key: 'ABC123' });
  });

  it('recognises a recovery-kit code', () => {
    const r = classifyBeaniesQr('https://app.beanies.family/welcome#beanies-kit=KIT-9');
    expect(r).toEqual({ kind: 'kit', code: 'KIT-9' });
  });

  it('recognises an invite / sign-in link and hands the WHOLE url on', () => {
    // Deliberately not parsed here: the query reconstruction belongs to the one consumer
    // that already knows how, and duplicating it is the drift this module prevents.
    const url = 'https://app.beanies.family/join?fam=f1&t=tok';
    expect(classifyBeaniesQr(url)).toEqual({ kind: 'invite', url });
  });

  it('accepts the apex host as well as the app subdomain', () => {
    expect(classifyBeaniesQr('https://beanies.family/join?fam=f1').kind).toBe('invite');
  });

  it('SECURITY: refuses an approval marker from a foreign origin', () => {
    // A bare `indexOf` over the whole payload used to accept this, and a key from here is
    // delivered as `in-app-scan` — the one transport that SKIPS the provenance warning. A
    // QR on a poster would have gone straight to a live fingerprint panel.
    expect(classifyBeaniesQr('https://evil.example/x?y=beanies-approve=ATTACKER').kind).toBe(
      'not-beanies'
    );
    expect(classifyBeaniesQr('beanies-approve=BARE').kind).toBe('not-beanies');
    // Assembled rather than written literally: the repo forbids `http://` string literals,
    // and the point here is precisely that a downgraded scheme must be refused.
    const insecure = `${'http'}://app.beanies.family/welcome#beanies-approve=K`;
    expect(classifyBeaniesQr(insecure).kind).toBe('not-beanies');
  });

  it('SECURITY: refuses a marker that is not in the fragment', () => {
    expect(
      classifyBeaniesQr('https://app.beanies.family/welcome?x=beanies-approve=K').kind
    ).not.toBe('approval');
  });

  it('treats a truncated marker as an unusable beanies code, not an invite', () => {
    expect(classifyBeaniesQr('https://app.beanies.family/welcome#beanies-approve=').kind).toBe(
      'beanies-url-unknown'
    );
  });

  it('does not call every beanies URL an invite', () => {
    // The marketing site and help centre are on these hosts too. Calling them invites is how
    // "that's an invite link, not a sign-in code" got said about a blog post.
    expect(classifyBeaniesQr('https://beanies.family/blog/some-post').kind).toBe(
      'beanies-url-unknown'
    );
  });

  it('rejects anything that is not ours', () => {
    expect(classifyBeaniesQr('https://example.com/whatever').kind).toBe('not-beanies');
    expect(classifyBeaniesQr('just some text').kind).toBe('not-beanies');
    expect(classifyBeaniesQr('   ').kind).toBe('not-beanies');
  });

  it('does not mistake one marker for another', () => {
    const approval = classifyBeaniesQr('https://app.beanies.family/welcome#beanies-approve=X');
    expect(approval.kind).toBe('approval');
    const kit = classifyBeaniesQr('https://app.beanies.family/welcome#beanies-kit=X');
    expect(kit.kind).toBe('kit');
  });
});

describe('wrongCodeMessageKey', () => {
  const ALL: QrKind[] = ['approval', 'invite', 'kit', 'beanies-url-unknown', 'not-beanies'];

  it('has a distinct, non-empty message for every kind', () => {
    // The table is exhaustive at compile time; this guards against two kinds accidentally
    // sharing a key, which would tell someone the wrong thing about what they scanned.
    const keys = ALL.map(wrongCodeMessageKey);
    expect(new Set(keys).size).toBe(ALL.length);
    keys.forEach((k) => expect(k.length).toBeGreaterThan(0));
  });

  it('names the approval code specifically, since that is the likeliest wrong scan', () => {
    expect(wrongCodeMessageKey('approval')).toBe('qrScan.wrongCodeApproval');
  });
});
