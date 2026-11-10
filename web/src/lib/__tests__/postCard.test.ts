/**
 * The link-preview card's layout rules and a smoke render. Covers come in every shape, so the
 * frame must follow the cover; and a title is Pango markup, so it must be escaped.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import sharp from 'sharp';
import { CARD, cardTitle, escapeMarkup, frameFor, renderPostCard } from '../postCard';

describe('frameFor', () => {
  it('gives a tall cover a portrait frame that keeps its top', () => {
    expect(frameFor(488 / 800)).toEqual({ width: 340, height: 510, anchor: 'top' });
  });
  it('gives a square-ish cover a square frame', () => {
    expect(frameFor(1)).toMatchObject({ width: 470, height: 470 });
    expect(frameFor(1600 / 1480)).toMatchObject({ width: 470, height: 470 });
  });
  it('gives a wide cover a landscape frame', () => {
    expect(frameFor(1200 / 750)).toMatchObject({ width: 520, height: 340 });
    expect(frameFor(1200 / 576)).toMatchObject({ width: 520, height: 340 });
  });
});

describe('cardTitle', () => {
  it('drops emoji, which the card has no font for', () => {
    expect(cardTitle('sorry my beans ... v1 is here 🥲')).toBe('sorry my beans ... v1 is here');
    expect(cardTitle('family 👨‍👩‍👧 time')).toBe('family time');
  });
});

describe('escapeMarkup', () => {
  it('escapes the characters Pango reads as markup', () => {
    expect(escapeMarkup('me & <my> AI')).toBe('me &amp; &lt;my&gt; AI');
  });
});

describe('renderPostCard', () => {
  it('renders a 1200x630 JPEG, with a markup-unsafe title', async () => {
    const cwd = process.cwd();
    // The renderer resolves its assets from `web/`, as `astro build` runs it.
    const web = path.resolve(__dirname, '../../..');
    process.chdir(web);
    try {
      const out = await renderPostCard({
        title: 'tips & tricks <for> a very long beanstalk title that has to wrap and shrink to fit',
        category: 'updates',
        coverPath: path.join(web, 'public/brand/og-default.png'),
      });
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe('jpeg');
      expect([meta.width, meta.height]).toEqual([CARD.width, CARD.height]);
    } finally {
      process.chdir(cwd);
    }
  });
});
