/**
 * Weather glyph renderer (#134 Phase 2, P2.4): PURE, no fs. Geometry JSON in (the shape of
 * `src/constants/weatherGlyphs.json`), asset strings out:
 *
 *   svgColor(geo, kind, scheme)   full-colour SVG for an iOS imageset ('light' | 'dark')
 *   svgMono(geo, kind)            single-colour SVG for a template image (strokes black, no fills)
 *   vectorDrawable(geo, kind, mono)  Android VectorDrawable; full colour references @color/wx_*
 *                                    (night handled by values-night), mono references @color/wx_mono
 *   androidColorBlock(scheme)     the `wx_*` <color> lines appended to widget_colors.xml
 *   buildAssetFiles(geo)          every generated file as { repoRelativePath: content }
 *
 * `gen-weather-glyphs.mjs` writes buildAssetFiles(); `weatherGlyphAssets.test.ts` compares it with
 * the committed files, so the two can never drift. Colours mirror WeatherGlyph.vue per role
 * (light: slate strokes, Heritage Orange sun; dark: CIG slides 8-9 ink scale + -lift accents).
 *
 * Native assets draw at ONE stroke width (the web steps it by rendered size): the middle step.
 */

/** Per-scheme palette, by the web's `--wx-*` names. Hex comes from packages/brand/theme.css. */
export const PALETTE = {
  light: {
    bolt: '#E67E22', // terracotta-400
    fill: '#EAF4FC', // wall chores-card tint (no theme token)
    fog: '#506B7A', // secondary-400
    ink: '#2C3E50', // secondary-500
    moonFill: '#DAEEF9', // sky-silk-100
    snow: '#2C3E50',
    sun: '#F15D22', // primary-500
    sunFill: '#FDE6D4', // primary-100
    water: '#2C3E50',
    mono: '#000000',
  },
  dark: {
    bolt: '#F0A05A', // terracotta-lift
    fill: '#2F3E4B', // surface-hover
    fog: '#9AA9B4', // ink-faint
    ink: '#C3CED6', // ink-soft
    moonFill: '#26343F', // surface-overlay
    snow: '#F2F5F7', // ink
    sun: '#FF8B5E', // accent-lift
    sunFill: '#33FF8B5E', // accent-lift at 20% (ARGB; SVG gets fill-opacity instead)
    water: '#8FC7E8', // silk-lift
    mono: '#FFFFFF',
  },
};

/** role -> { stroke, fill } palette keys (null fill = none) and line caps/joins. */
const ROLES = {
  ink: { stroke: 'ink', fill: 'fill', cap: 'round', join: 'round' },
  sun: { stroke: 'sun', fill: 'sunFill', cap: 'round' },
  sunRays: { stroke: 'sun', fill: null, cap: 'round' },
  water: { stroke: 'water', fill: null, cap: 'round' },
  bolt: { stroke: 'ink', fill: 'bolt', join: 'round' },
  snow: { stroke: 'snow', fill: null, cap: 'round' },
  fog: { stroke: 'fog', fill: null, cap: 'round' },
  moon: { stroke: 'ink', fill: 'moonFill', join: 'round' },
  star: { stroke: 'ink', fill: null, cap: 'round' },
};

const NATIVE_STROKE = 1.9;

/** Android colour resource name per palette key. */
const ANDROID_NAME = {
  bolt: 'wx_bolt',
  fill: 'wx_fill',
  fog: 'wx_fog',
  ink: 'wx_ink',
  moonFill: 'wx_moon_fill',
  snow: 'wx_snow',
  sun: 'wx_sun',
  sunFill: 'wx_sun_fill',
  water: 'wx_water',
  mono: 'wx_mono',
};

const num = (n) => String(Math.round(n * 1000) / 1000);

/** A circle as an absolute-arc path (VectorDrawable has no <circle>). */
function circlePath({ cx, cy, r }) {
  return `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`;
}

/** Parses `translate(x y)` / `scale(s)` (the only transforms the geometry uses), in order. */
function parseTransform(t) {
  const out = [];
  for (const m of (t ?? '').matchAll(/(translate|scale)\(([^)]*)\)/g)) {
    const args = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (args.some(Number.isNaN)) throw new Error(`bad transform: ${t}`);
    out.push({ fn: m[1], args });
  }
  if ((t ?? '').replace(/(translate|scale)\([^)]*\)/g, '').trim()) {
    throw new Error(`unsupported transform: ${t}`);
  }
  return out;
}

function glyphParts(geo, kind) {
  const parts = geo.glyphs[kind];
  if (!parts) throw new Error(`unknown weather glyph: ${kind}`);
  return parts;
}

function hexRgb(hex) {
  // '#RRGGBB' or '#AARRGGBB' -> { rgb: '#RRGGBB', opacity }
  if (hex.length === 9)
    return { rgb: `#${hex.slice(3)}`, opacity: parseInt(hex.slice(1, 3), 16) / 255 };
  return { rgb: hex, opacity: 1 };
}

function svgPart(part, paint) {
  const def = ROLES[part.role];
  if (!def) throw new Error(`unknown role: ${part.role}`);
  const { stroke, fill } = paint(def);
  const attrs = [];
  if (part.circle) {
    attrs.push(`cx="${part.circle.cx}" cy="${part.circle.cy}" r="${part.circle.r}"`);
  } else {
    attrs.push(`d="${part.d}"`);
  }
  if (part.transform) attrs.push(`transform="${part.transform}"`);
  attrs.push(fill);
  attrs.push(`stroke="${stroke}"`);
  if (part.strokeWidth) attrs.push(`stroke-width="${part.strokeWidth}"`);
  if (def.cap) attrs.push(`stroke-linecap="${def.cap}"`);
  if (def.join) attrs.push(`stroke-linejoin="${def.join}"`);
  return `  <${part.circle ? 'circle' : 'path'} ${attrs.join(' ')}/>`;
}

function svgDoc(geo, parts, paint) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geo.viewBox}" width="24" height="24" fill="none" stroke-width="${NATIVE_STROKE}">
${parts.map((p) => svgPart(p, paint)).join('\n')}
</svg>
`;
}

export function svgColor(geo, kind, scheme) {
  const pal = PALETTE[scheme];
  if (!pal) throw new Error(`unknown scheme: ${scheme}`);
  return svgDoc(geo, glyphParts(geo, kind), (def) => {
    let fill = 'fill="none"';
    if (def.fill) {
      const { rgb, opacity } = hexRgb(pal[def.fill]);
      fill = `fill="${rgb}"${opacity < 1 ? ` fill-opacity="${num(opacity)}"` : ''}`;
    }
    return { stroke: pal[def.stroke], fill };
  });
}

export function svgMono(geo, kind) {
  return svgDoc(geo, glyphParts(geo, kind), () => ({
    stroke: PALETTE.light.mono,
    fill: 'fill="none"',
  }));
}

function vdPath(part, mono) {
  const def = ROLES[part.role];
  const d = part.circle ? circlePath(part.circle) : part.d;
  const a = [`android:pathData="${d}"`];
  if (!mono && def.fill) a.push(`android:fillColor="@color/${ANDROID_NAME[def.fill]}"`);
  a.push(`android:strokeColor="@color/${mono ? 'wx_mono' : ANDROID_NAME[def.stroke]}"`);
  a.push(`android:strokeWidth="${part.strokeWidth ?? NATIVE_STROKE}"`);
  if (def.cap) a.push(`android:strokeLineCap="${def.cap}"`);
  if (def.join) a.push(`android:strokeLineJoin="${def.join}"`);
  return a;
}

function vdPartXml(part, mono) {
  const attrs = vdPath(part, mono);
  const tf = parseTransform(part.transform);
  if (!tf.length) return `    <path\n${attrs.map((x) => `        ${x}`).join('\n')}/>`;
  // translate(a b) scale(s) == scale then translate, which is a <group>'s own order. A group
  // holds one translate and one scale, so anything else would need nesting: reject it loudly.
  const t = tf.find((x) => x.fn === 'translate');
  const s = tf.find((x) => x.fn === 'scale');
  if (tf.length > 2 || (tf.length === 2 && tf[0].fn !== 'translate')) {
    throw new Error(`unsupported transform order: ${part.transform}`);
  }
  const g = [];
  if (t) g.push(`android:translateX="${t.args[0]}"`, `android:translateY="${t.args[1] ?? 0}"`);
  if (s)
    g.push(
      `android:scaleX="${s.args[0]}"`,
      `android:scaleY="${s.args[1] ?? s.args[0]}"`,
      'android:pivotX="0"',
      'android:pivotY="0"'
    );
  return `    <group ${g.join(' ')}>\n      <path\n${attrs.map((x) => `          ${x}`).join('\n')}/>\n    </group>`;
}

export function vectorDrawable(geo, kind, mono) {
  const [, , w, h] = geo.viewBox.split(' ');
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/gen-weather-glyphs.mjs from src/constants/weatherGlyphs.json. Do not edit. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${w}dp"
    android:height="${h}dp"
    android:viewportWidth="${w}"
    android:viewportHeight="${h}">
${glyphParts(geo, kind)
  .map((p) => vdPartXml(p, mono))
  .join('\n')}
</vector>
`;
}

/** Markers bracketing the generated block inside widget_colors.xml. */
export const COLOR_BLOCK_START =
  '    <!-- wx-glyph colours: generated by scripts/gen-weather-glyphs.mjs, do not edit -->';
export const COLOR_BLOCK_END = '    <!-- /wx-glyph colours -->';

export function androidColorBlock(scheme) {
  const pal = PALETTE[scheme];
  const lines = Object.entries(ANDROID_NAME).map(([key, name]) => {
    // Android wants #AARRGGBB; SVG-side palette already carries it for sunFill only.
    return `    <color name="${name}">${pal[key]}</color>`;
  });
  return [COLOR_BLOCK_START, ...lines, COLOR_BLOCK_END].join('\n');
}

/** camelCase glyph kind -> snake_case Android resource stem. */
export const snake = (kind) => kind.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const IOS_ASSETS = 'ios/App/BeaniesWidgets/Assets.xcassets';
const ANDROID_DRAWABLE = 'android/app/src/main/res/drawable';
const INFO = { author: 'xcode', version: 1 };
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

/** Every generated file, keyed by repo-relative path. */
export function buildAssetFiles(geo) {
  const files = {};
  for (const kind of Object.keys(geo.glyphs)) {
    const set = `${IOS_ASSETS}/wx-${kind}.imageset`;
    files[`${set}/Contents.json`] = json({
      images: [
        { filename: `wx-${kind}.svg`, idiom: 'universal' },
        {
          appearances: [{ appearance: 'luminosity', value: 'dark' }],
          filename: `wx-${kind}-dark.svg`,
          idiom: 'universal',
        },
      ],
      info: INFO,
      properties: { 'preserves-vector-representation': true },
    });
    files[`${set}/wx-${kind}.svg`] = svgColor(geo, kind, 'light');
    files[`${set}/wx-${kind}-dark.svg`] = svgColor(geo, kind, 'dark');

    const mono = `${IOS_ASSETS}/wx-${kind}-mono.imageset`;
    files[`${mono}/Contents.json`] = json({
      images: [{ filename: `wx-${kind}-mono.svg`, idiom: 'universal' }],
      info: INFO,
      properties: {
        'preserves-vector-representation': true,
        'template-rendering-intent': 'template',
      },
    });
    files[`${mono}/wx-${kind}-mono.svg`] = svgMono(geo, kind);

    files[`${ANDROID_DRAWABLE}/wx_${snake(kind)}.xml`] = vectorDrawable(geo, kind, false);
    files[`${ANDROID_DRAWABLE}/wx_${snake(kind)}_mono.xml`] = vectorDrawable(geo, kind, true);
  }
  return files;
}

/** Replaces (or appends before </resources>) the generated colour block in a colours file. */
export function withColorBlock(xml, scheme) {
  const block = androidColorBlock(scheme);
  const start = xml.indexOf(COLOR_BLOCK_START);
  if (start !== -1) {
    const end = xml.indexOf(COLOR_BLOCK_END, start) + COLOR_BLOCK_END.length;
    return xml.slice(0, start) + block + xml.slice(end);
  }
  return xml.replace(/<\/resources>/, `${block}\n</resources>`);
}

export const COLOR_FILES = {
  light: 'android/app/src/main/res/values/widget_colors.xml',
  dark: 'android/app/src/main/res/values-night/widget_colors.xml',
};
