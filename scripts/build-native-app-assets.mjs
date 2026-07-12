// Builds the source input images that @capacitor/assets consumes to generate
// every Android/iOS launcher-icon and splash-screen density variant.
//
// Source art: public/brand/beanies_family_hugging_transparent_1024x1024.png
// Brand background: Cloud White #F8F9FA (icons/light splash), Deep Slate #2C3E50 (dark splash).
//
// Run: node scripts/build-native-app-assets.mjs
// Then: npx @capacitor/assets generate --android   (regenerates android/app/src/main/res/*)
//
// The generated native files ARE committed to the repo — CI's `cap sync` does not
// regenerate them. Re-run this + the generate step whenever the brand art changes.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SRC = 'public/brand/beanies_family_hugging_transparent_1024x1024.png';
const OUT = 'assets';

const CLOUD_WHITE = { r: 0xf8, g: 0xf9, b: 0xfa, alpha: 1 };
const DEEP_SLATE = { r: 0x2c, g: 0x3e, b: 0x50, alpha: 1 };

const art = await sharp(SRC).ensureAlpha().toBuffer();

async function centeredOnCanvas(canvasSize, artSize, background) {
  const scaledArt = await sharp(art)
    .resize(artSize, artSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background },
  })
    .composite([{ input: scaledArt, gravity: 'center' }])
    .png()
    .toBuffer();
}

await mkdir(OUT, { recursive: true });

// Adaptive-icon FOREGROUND: art scaled into the safe zone (~64% of 1024) on a
// transparent canvas so no mask (circle/squircle/round) clips the family group.
await sharp(await centeredOnCanvas(1024, 656, { r: 0, g: 0, b: 0, alpha: 0 })).toFile(
  `${OUT}/icon-foreground.png`
);

// Adaptive-icon BACKGROUND: solid Cloud White.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: CLOUD_WHITE } })
  .png()
  .toFile(`${OUT}/icon-background.png`);

// LEGACY square icon (pre-Android-8 launchers, iOS, Play hi-res): art on Cloud White.
await sharp(await centeredOnCanvas(1024, 880, CLOUD_WHITE)).toFile(`${OUT}/icon-only.png`);

// SPLASH (light): small centered mark on Cloud White, 2732×2732.
await sharp(await centeredOnCanvas(2732, 900, CLOUD_WHITE)).toFile(`${OUT}/splash.png`);

// SPLASH (dark): same on Deep Slate.
await sharp(await centeredOnCanvas(2732, 900, DEEP_SLATE)).toFile(`${OUT}/splash-dark.png`);

console.log('Wrote assets/{icon-foreground,icon-background,icon-only,splash,splash-dark}.png');
