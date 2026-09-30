import { describe, it, expect } from 'vitest';
import {
  familiesInList,
  inlineFontFace,
  mergeSameFileFaces,
  parseFontFaceBlocks,
  parseUnicodeRange,
  selectFontFaces,
} from '@/utils/fontFaceEmbed';

// The shape Google Fonts' css2 endpoint serves (trimmed): a variable font repeated per weight
// with the SAME file per script subset.
const GF = `
/* latin-ext */
@font-face {
  font-family: 'Caveat';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/caveat/v23/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Caveat';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/caveat/v23/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+2000-206F;
}
/* latin */
@font-face {
  font-family: 'Caveat';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/caveat/v23/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+2000-206F;
}
/* latin */
@font-face {
  font-family: 'Outfit';
  font-style: normal;
  font-weight: 800;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/outfit/v15/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

const cps = (s: string) => new Set([...s].map((c) => c.codePointAt(0)!));

describe('fontFaceEmbed', () => {
  it('parses unicode-range singles, spans and wildcards', () => {
    expect(parseUnicodeRange('U+0000-00FF, U+0131, U+4??')).toEqual([
      [0, 0xff],
      [0x131, 0x131],
      [0x400, 0x4ff],
    ]);
  });

  it('normalises a font-family list', () => {
    expect(familiesInList(`"Outfit", 'Inter Variable', sans-serif`)).toEqual([
      'outfit',
      'inter variable',
      'sans-serif',
    ]);
  });

  it('parses every @font-face block, resolving relative URLs against the sheet', () => {
    const blocks = parseFontFaceBlocks(GF, 'https://fonts.googleapis.com/css2?x');
    expect(blocks.map((b) => b.family)).toEqual(['caveat', 'caveat', 'caveat', 'outfit']);
    expect(blocks[1]!.urls).toEqual(['https://fonts.gstatic.com/s/caveat/v23/latin.woff2']);

    const rel = parseFontFaceBlocks(
      `@font-face { font-family: X; src: url("../f/x.woff2") format("woff2"), url(data:font/woff2;base64,AA) }`,
      'https://app.example/assets/index.css'
    );
    expect(rel[0]!.urls).toEqual(['https://app.example/f/x.woff2']);
    expect(rel[0]!.ranges).toBeNull();
  });

  it('keeps only faces for families the element uses and subsets its text needs', () => {
    const blocks = parseFontFaceBlocks(GF, 'https://fonts.googleapis.com/');
    const picked = selectFontFaces(blocks, new Set(['caveat', 'cursive']), cps('every job'));
    // latin only: no latin-ext character in the text, and Outfit is not used.
    expect(picked.map((b) => b.urls[0])).toEqual([
      'https://fonts.gstatic.com/s/caveat/v23/latin.woff2',
      'https://fonts.gstatic.com/s/caveat/v23/latin.woff2',
    ]);
    // A latin-ext character pulls that subset in too.
    expect(selectFontFaces(blocks, new Set(['caveat']), cps('ł')).map((b) => b.urls[0])).toEqual([
      'https://fonts.gstatic.com/s/caveat/v23/ext.woff2',
    ]);
  });

  it('merges per-weight blocks of one file into a single weight range', () => {
    const blocks = parseFontFaceBlocks(GF, 'https://fonts.googleapis.com/');
    const merged = mergeSameFileFaces(blocks);
    expect(merged).toHaveLength(3);
    const latin = merged.find((b) => b.urls[0]!.endsWith('caveat/v23/latin.woff2'))!;
    expect(latin.cssText).toMatch(/font-weight: 400 700/);
    // Unmerged blocks keep their own single weight.
    expect(merged.find((b) => b.family === 'outfit')!.cssText).toMatch(/font-weight: 800/);
  });

  it('inlines data: URLs, and drops a face whose file could not be fetched', () => {
    const [block] = parseFontFaceBlocks(GF, 'https://fonts.googleapis.com/').slice(1);
    const url = block!.urls[0]!;
    const css = inlineFontFace(block!, new Map([[url, 'data:font/woff2;base64,QUJD']]));
    expect(css).toContain('url(data:font/woff2;base64,QUJD)');
    expect(css).not.toContain('fonts.gstatic.com');
    expect(inlineFontFace(block!, new Map())).toBeNull();
  });
});
