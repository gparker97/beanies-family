import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import geometry from '../weatherGlyphs.json';
// @ts-expect-error: no type declarations for the generator's renderer (plain JS).
import * as renderer from '../../../scripts/weatherGlyphRender.mjs';

const { buildAssetFiles, COLOR_FILES, withColorBlock } = renderer;

// Drift guard (#134 P2.4): the committed native weather glyph assets (iOS imagesets, Android
// drawables, the wx_* colours) must equal what the renderer produces from weatherGlyphs.json.
const FIX = 'run `node scripts/gen-weather-glyphs.mjs` and commit the assets';
const root = resolve(__dirname, '../../..');
const read = (rel: string) =>
  existsSync(resolve(root, rel)) ? readFileSync(resolve(root, rel), 'utf8') : null;

describe('native weather glyph assets', () => {
  const files = buildAssetFiles(geometry) as Record<string, string>;

  it('generates 7 files for each of the 9 glyphs', () => {
    expect(Object.keys(files)).toHaveLength(9 * 7);
  });

  it.each(Object.keys(files))('%s matches the generator', (rel) => {
    expect(read(rel), FIX).toBe(files[rel]);
  });

  it.each(Object.entries(COLOR_FILES) as [string, string][])(
    '%s colours carry the wx_* block',
    (scheme, rel) => {
      const committed = read(rel);
      expect(committed, FIX).not.toBeNull();
      expect(withColorBlock(committed as string, scheme), FIX).toBe(committed);
    }
  );
});
