import { describe, it, expect } from 'vitest';
import { attachmentKind, isPdf, PDF_MIME } from '../attachmentKind';

describe('attachmentKind', () => {
  it('classifies PDFs as pdf', () => {
    expect(attachmentKind({ mime: PDF_MIME })).toBe('pdf');
    expect(isPdf({ mime: 'application/pdf' })).toBe(true);
  });

  it('classifies images (and unknown mimes) as image', () => {
    expect(attachmentKind({ mime: 'image/jpeg' })).toBe('image');
    expect(attachmentKind({ mime: 'image/png' })).toBe('image');
    // Unknown/legacy mime falls back to image (the historical default).
    expect(attachmentKind({ mime: '' })).toBe('image');
    expect(isPdf({ mime: 'image/webp' })).toBe(false);
  });
});
