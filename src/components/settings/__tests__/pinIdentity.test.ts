/**
 * "Who am I?" must have ONE answer on the PIN surfaces.
 *
 * `WallSetupCard` gates entry on the member having a PIN and, when they do not,
 * opens `PinSettings` in place. The two used to ask DIFFERENT questions:
 * the card asked `familyStore.currentMember`, which falls back to the OWNER
 * when nothing else resolves, while the form keyed off
 * `authStore.currentUser?.memberId`. With a pod open but no member signed in —
 * opening a `.beanpod` from the welcome gate on a fresh device is exactly that
 * — the card demanded a PIN for the owner's row and the form could not set one.
 * `handleSave` then began `if (!me.value) return;`, so the Save button did
 * literally nothing: no message, no log, no toast, and closing the modal
 * returned to the same prompt. Reported from the field on an Android tablet.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
/** Comments describe what the code must NOT do, so strip them before asserting. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

describe('the PIN surfaces agree on who the current member is', () => {
  it('both derive the member from authStore.currentUser, not the owner fallback', () => {
    for (const file of [
      'src/components/settings/PinSettings.vue',
      'src/components/settings/WallSetupCard.vue',
    ]) {
      const src = code(read(file));
      expect(src, `${file} must key off the signed-in user`).toContain(
        'authStore.currentUser?.memberId'
      );
      // `familyStore.currentMember` resolves to the OWNER when nothing else
      // does, which is the disagreement that produced the dead end.
      expect(src, `${file} must not use the owner-fallback identity`).not.toContain(
        'familyStore.currentMember'
      );
    }
  });

  it('PinSettings never returns silently when there is no signed-in member', () => {
    // The project rule is explicit: nothing fails silently. A bare `return`
    // here is a button that does nothing, which is unreportable and undebuggable.
    const src = code(read('src/components/settings/PinSettings.vue'));
    const start = src.indexOf('async function handleSave');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).not.toMatch(/if \(!me\.value\) return;/);
    expect(body).toContain("t('pin.noSignedInMember')");
    expect(body).toContain('logEvent(');
  });
});
