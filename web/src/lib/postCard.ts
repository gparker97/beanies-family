/**
 * The link-preview card for a beanstalk post (1200x630): the post title and the beanies.family
 * wordmark on the left, the post's cover image in a rounded frame on the right, on the same light
 * ground as the site-wide hugging-family card (`public/brand/og-default.png`).
 *
 * Covers come in every shape (tall phone screenshots to wide banners), so the frame picks its
 * shape from the cover instead of cropping every cover to the card.
 *
 * Text is set with sharp's Pango text input and the Outfit file in `src/assets/og/`, so the
 * build never depends on a font installed on the machine or fetched from the network.
 *
 * Paths resolve from the working directory, which is `web/` for both `astro dev` and
 * `astro build` (the same assumption the previous generator made).
 */
import path from 'node:path';
import sharp from 'sharp';

export const CARD = { width: 1200, height: 630 } as const;

// Resolved per render, not at import, so a test can point the working directory at `web/`.
const asset = (file: string) => path.resolve('src/assets/og', file);
// One font file for every line: two weights of one family loaded side by side made Pango pick
// between them differently from card to card.
const FONT_FILE = 'Outfit-Bold.ttf';
const FONT_NAME = 'Outfit Bold';

const SLATE = '#2C3E50';
const ORANGE = '#F15D22';
const MARGIN_RIGHT = 70;
const TEXT_LEFT = 90;
const TEXT_GAP = 50; // clear space between the text column and the frame
const EYEBROW_TOP = 84;
const TITLE_TOP = 132;
const TITLE_BOTTOM = 440; // the wordmark on the ground image starts below this
const TITLE_SIZES = [68, 62, 56, 50, 44, 38] as const;
const RADIUS = 32;

export interface Frame {
  width: number;
  height: number;
  /** Which part of the cover survives the crop: a tall screenshot keeps its top. */
  anchor: 'top' | 'centre';
}

/** The frame shape for a cover of the given aspect ratio (width / height). */
export function frameFor(aspect: number): Frame {
  if (aspect < 0.9) return { width: 340, height: 510, anchor: 'top' };
  if (aspect < 1.25) return { width: 470, height: 470, anchor: 'centre' };
  return { width: 520, height: 340, anchor: 'centre' };
}

/**
 * A title as the card sets it: emoji dropped. The card has one font file and no emoji font, so an
 * emoji would render from whatever the build machine has installed, or as an empty box.
 */
export function cardTitle(title: string): string {
  return title
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function textImage(opts: { text: string; size: number; color: string; width: number }) {
  const image = sharp({
    text: {
      text: `<span foreground="${opts.color}">${escapeMarkup(opts.text)}</span>`,
      font: `${FONT_NAME} ${opts.size}`,
      fontfile: asset(FONT_FILE),
      width: opts.width,
      dpi: 72, // one point is one pixel, so `size` is the pixel size
      rgba: true,
      spacing: Math.round(opts.size * 0.06),
    },
  });
  const { data, info } = await image.png().toBuffer({ resolveWithObject: true });
  return { data, height: info.height };
}

/** The largest title size whose wrapped block fits above the wordmark. */
async function fitTitle(title: string, width: number) {
  let last: Awaited<ReturnType<typeof textImage>> | undefined;
  for (const size of TITLE_SIZES) {
    last = await textImage({ text: title, size, color: SLATE, width });
    if (TITLE_TOP + last.height <= TITLE_BOTTOM) break;
  }
  return last!;
}

const svg = (body: string, width: number, height: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`
  );

export interface PostCardInput {
  title: string;
  category: string;
  /** Absolute path of the cover image on disk. */
  coverPath: string;
}

export async function renderPostCard({
  title,
  category,
  coverPath,
}: PostCardInput): Promise<Buffer> {
  const meta = await sharp(coverPath).metadata();
  const frame = frameFor((meta.width ?? 1) / (meta.height ?? 1));
  const left = CARD.width - MARGIN_RIGHT - frame.width;
  const top = Math.round((CARD.height - frame.height) / 2);
  const textWidth = left - TEXT_LEFT - TEXT_GAP;

  const roundedRect = `<rect width="${frame.width}" height="${frame.height}" rx="${RADIUS}"/>`;
  const cover = await sharp(coverPath)
    .resize(frame.width, frame.height, {
      fit: 'cover',
      position: frame.anchor === 'top' ? 'top' : 'centre',
    })
    .composite([{ input: svg(roundedRect, frame.width, frame.height), blend: 'dest-in' }])
    .png()
    .toBuffer();

  const shadow = await sharp(
    svg(
      `<rect x="${left}" y="${top + 14}" width="${frame.width}" height="${frame.height}" rx="${RADIUS}" fill="${SLATE}" fill-opacity="0.28"/>`,
      CARD.width,
      CARD.height
    )
  )
    .blur(22)
    .png()
    .toBuffer();

  const border = svg(
    `<rect x="3" y="3" width="${frame.width - 6}" height="${frame.height - 6}" rx="${RADIUS - 3}" fill="none" stroke="#FFFFFF" stroke-width="6"/>`,
    frame.width,
    frame.height
  );

  const eyebrow = await textImage({
    text: `THE BEANSTALK  ·  ${category.toUpperCase()}`,
    size: 21,
    color: ORANGE,
    width: textWidth,
  });
  const titleBlock = await fitTitle(cardTitle(title), textWidth);

  return (
    sharp(asset('post-card-ground.png'))
      .composite([
        { input: shadow, left: 0, top: 0 },
        { input: cover, left, top },
        { input: border, left, top },
        { input: eyebrow.data, left: TEXT_LEFT + 2, top: EYEBROW_TOP },
        { input: titleBlock.data, left: TEXT_LEFT, top: TITLE_TOP },
      ])
      // JPEG, not PNG: the cover is usually a photo or a screenshot, and a PNG card ran to ~300 KB,
      // which some chat apps refuse to preview.
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer()
  );
}
