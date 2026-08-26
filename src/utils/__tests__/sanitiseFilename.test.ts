/**
 * Filename sanitisation at the share boundary (#64, plan §6.3).
 *
 * These are security assertions, not tidiness ones: on the share path `file.name` comes from
 * an arbitrary third-party app and is persisted with the attachment.
 */
import { describe, it, expect } from 'vitest';
import { sanitiseAttachmentBase } from '../sanitiseFilename';

describe('sanitiseAttachmentBase (#64)', () => {
  it('keeps an ordinary name, minus its extension', () => {
    expect(sanitiseAttachmentBase('holiday-invite.pdf')).toBe('holiday-invite');
    expect(sanitiseAttachmentBase('Recipe Card 2.jpeg')).toBe('Recipe Card 2');
  });

  it('strips POSIX and Windows path traversal', () => {
    expect(sanitiseAttachmentBase('../../etc/passwd')).toBe('passwd');
    expect(sanitiseAttachmentBase('/absolute/path/photo.jpg')).toBe('photo');
    expect(sanitiseAttachmentBase('..\\..\\windows\\system32\\evil.png')).toBe('evil');
    expect(sanitiseAttachmentBase('../../../')).toBe('shared');
  });

  it('bounds a hostile length', () => {
    const out = sanitiseAttachmentBase(`${'a'.repeat(4096)}.jpg`);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out).toBe('a'.repeat(64));
  });

  it('never returns an empty string', () => {
    expect(sanitiseAttachmentBase('')).toBe('shared');
    expect(sanitiseAttachmentBase('.jpg')).toBe('shared');
    expect(sanitiseAttachmentBase('   ')).toBe('shared');
    expect(sanitiseAttachmentBase('...')).toBe('shared');
    expect(sanitiseAttachmentBase('///')).toBe('shared');
  });

  it('collapses characters that have meaning to a filesystem or a shell', () => {
    expect(sanitiseAttachmentBase('a;rm -rf ~;b.png')).toBe('a-rm -rf -b');
    expect(sanitiseAttachmentBase('null\u0000byte.png')).toBe('null-byte');
    expect(sanitiseAttachmentBase('emoji🫘name.png')).toBe('emoji-name');
  });

  it('does not leave a trailing separator after truncation', () => {
    const out = sanitiseAttachmentBase(`${'b'.repeat(63)}-tail.jpg`);
    expect(out.endsWith('-')).toBe(false);
  });
});
