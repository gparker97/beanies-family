/**
 * Renders the default social preview card (Open Graph / Twitter
 * summary_large_image) to a static PNG at 1200x630.
 *
 * The card is deliberately static and committed rather than generated at
 * build time: it never changes per-page, and a build-time headless browser
 * would be a heavy dependency for one fixed image. Re-run this script by
 * hand if the brand art or layout changes.
 *
 *   node web/scripts/render-social-card.mjs              # writes og-default.png
 *   node web/scripts/render-social-card.mjs --compare    # all marks + contact sheet
 *
 * Design: docs/mockups/social-card-2026-08-26.html (direction 1, "horizon").
 * The mark beside the wordmark is the single bean (the app-icon mark). The
 * Pod — the four-bean sequence — was tried and rejected: at the ~550px a
 * reply card actually renders, the ring smudges and the flat row reads as
 * carousel dots rather than beans. `--compare` regenerates that comparison.
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const WIDTH = 1200;
const HEIGHT = 630;
/** Width a link card actually renders at in a Bluesky/Mastodon reply. */
const REPLY_WIDTH = 552;

/** Brand palette — CIG (.claude/skills/beanies-theme/SKILL.md). */
const SLATE = '#2C3E50';
const ORANGE = '#F15D22';
const TERRA = '#E67E22';
const SKY = '#AED6F1';

const dataUri = (rel) => {
  const path = resolve(ROOT, rel);
  const mime = path.endsWith('.webp') ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
};

const ART = dataUri('web/public/brand/beanies_family_hugging_transparent_1024x1024.webp');
const POD_RING = dataUri('public/brand/beanies_spinner_transparent_192x192.png');
const BEAN = dataUri('web/public/brand/beanies_small_bean_favicon_512x512.webp');

/**
 * The Pod as four flat marks. Colour order is fixed by the CIG —
 * Slate, Terracotta, Orange, Sky Silk — and must never be recoloured or
 * reordered ("the beanies always hold hands").
 */
const POD_ROW = [SLATE, TERRA, ORANGE, SKY]
  .map((c) => `<span class="bean" style="background:${c}"></span>`)
  .join('');

const WORDMARK = '<span class="w1">beanies</span><span class="w2">.family</span>';

/** The three candidate treatments for the mark beside the wordmark. */
const MARKS = {
  'pod-row': `<div class="lockup lockup--stack">
      <div class="pod-row">${POD_ROW}</div>
      <div class="word">${WORDMARK}</div>
    </div>`,
  'pod-ring': `<div class="lockup lockup--inline">
      <img class="mark mark--ring" src="${POD_RING}" alt="">
      <div class="word">${WORDMARK}</div>
    </div>`,
  bean: `<div class="lockup lockup--inline">
      <img class="mark mark--bean" src="${BEAN}" alt="">
      <div class="word">${WORDMARK}</div>
    </div>`,
};

const CARD_CSS = `
  .card {
    height: ${HEIGHT}px;
    overflow: hidden;
    position: relative;
    width: ${WIDTH}px;
    /* The landing hero's exact gradient — this is the continuity anchor
       between the preview and the page it opens (index.astro, .hero). */
    background: linear-gradient(180deg, #F8F9FA 0%, #EDF6FC 52%, #F8F9FA 100%);
  }
  /* Warm radial lifting the lower-left, echoing the hero's orange bloom. */
  .card__warm {
    background: radial-gradient(circle, rgba(241, 93, 34, 0.16) 0%, rgba(241, 93, 34, 0) 70%);
    border-radius: 50%;
    bottom: -420px;
    height: 900px;
    left: -300px;
    position: absolute;
    width: 900px;
  }
  .card__art {
    display: block;
    filter: drop-shadow(0 24px 44px rgba(44, 62, 80, 0.17));
    position: absolute;
    bottom: 118px;
    right: 100px;
    width: 505px;
  }
  /* A soft ground the family stands on. An earlier draft used a hairline
     rule here; at the ~550px a reply card actually renders it read as a
     stray line rather than a horizon. */
  .card__ground {
    background: radial-gradient(ellipse at center, rgba(44, 62, 80, 0.13) 0%, rgba(44, 62, 80, 0) 68%);
    bottom: 88px;
    height: 90px;
    position: absolute;
    right: 84px;
    width: 520px;
  }
  .lockup { bottom: 70px; left: 88px; position: absolute; }
  .lockup--inline { align-items: center; display: flex; gap: 20px; }
  .word {
    font-family: Outfit, sans-serif;
    font-size: 60px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  /* CIG wordmark rule: "beanies" in Deep Slate, ".family" in Heritage Orange. */
  .w1 { color: ${SLATE}; }
  .w2 { color: ${ORANGE}; }
  .pod-row { display: flex; gap: 11px; margin: 0 0 20px; }
  .bean {
    border-radius: 50% 50% 48% 48% / 56% 56% 44% 44%;
    display: block;
    height: 34px;
    width: 26px;
  }
  .mark { display: block; }
  .mark--ring { width: 86px; }
  .mark--bean { width: 74px; }
`;

const card = (variant) => `
  <div class="card">
    <div class="card__warm"></div>
    <div class="card__ground"></div>
    <img class="card__art" src="${ART}" alt="">
    ${MARKS[variant]}
  </div>`;

const page = (body, css = '') => `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; }
  ${CARD_CSS}
  ${css}
</style></head><body>${body}</body></html>`;

/** Fail loudly if the webfont did not arrive — a system-font fallback would
 *  silently ship an off-brand wordmark. */
async function assertFontLoaded(pw) {
  const ok = await pw.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('700 60px Outfit');
  });
  if (!ok) {
    throw new Error(
      'Outfit webfont did not load — refusing to render with a fallback face.\n' +
        'Check network access to fonts.googleapis.com and re-run.'
    );
  }
}

/** The shipped card. Everything else exists only for `--compare`. */
const DEFAULT_VARIANT = 'bean';

const compare = process.argv.includes('--compare');
const targets = compare ? Object.keys(MARKS) : [DEFAULT_VARIANT];

const outDir = resolve(ROOT, 'web/public/brand');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const pw = await ctx.newPage();

  for (const v of targets) {
    await pw.setContent(page(card(v)), { waitUntil: 'networkidle' });
    await assertFontLoaded(pw);
    const out = resolve(outDir, compare ? `og-default-${v}.png` : 'og-default.png');
    await pw.locator('.card').screenshot({ path: out });
    console.log(`  ${v.padEnd(9)} -> ${out.replace(ROOT + '/', '')}`);
  }

  // Contact sheet: every variant at the width a reply card actually renders,
  // which is the only size worth judging them at.
  if (targets.length > 1) {
    const scale = REPLY_WIDTH / WIDTH;
    const sheet = targets
      .map(
        (v) => `<figure><figcaption>${v}</figcaption>
          <div class="shrink"><div class="inner">${card(v)}</div></div></figure>`
      )
      .join('');
    await pw.setContent(
      page(
        `<div class="sheet">${sheet}</div>`,
        `
        .sheet { background:#fff; display:flex; flex-direction:column; gap:26px; padding:28px; width:${REPLY_WIDTH + 56}px; }
        figure { margin:0; }
        figcaption { color:#5b6b7a; font-family:Inter,sans-serif; font-size:12px; font-weight:600;
          letter-spacing:.08em; margin:0 0 7px; text-transform:uppercase; }
        .shrink { border:1px solid #e3e8ed; border-radius:12px; height:${Math.round(HEIGHT * scale)}px;
          overflow:hidden; width:${REPLY_WIDTH}px; }
        .inner { transform: scale(${scale}); transform-origin: top left; }
      `
      ),
      { waitUntil: 'networkidle' }
    );
    await assertFontLoaded(pw);
    const sheetOut = resolve(ROOT, 'docs/mockups/social-card-variants.png');
    await pw.locator('.sheet').screenshot({ path: sheetOut });
    console.log(`  sheet     -> ${sheetOut.replace(ROOT + '/', '')}`);
  }
} finally {
  await browser.close();
}
