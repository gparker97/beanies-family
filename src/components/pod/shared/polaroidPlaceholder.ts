/**
 * The glyphs and tints a photo-less polaroid can show (#86).
 *
 * Data, not behaviour, and kept OUT of `PolaroidImage.vue` on purpose: that file is ~200
 * lines of genuinely intricate logic (the lh3 propagation-retry ladder), and four glyphs of
 * raw SVG path data would roughly double it with content that has no reason to sit beside
 * behaviour. As a plain module the table is also directly unit-testable.
 *
 * WHY VARY AT ALL. A cookbook where every un-photographed recipe shows the identical drawing
 * reads as a broken image repeated down the page; the same drawing in four poses reads as a
 * house style. The variant is chosen from the recipe id, so it is stable for a given recipe
 * across renders, reloads and devices — never random, which would flicker on every re-render.
 *
 * All colours are CIG brand values. Alert Red is not among them and must not be: this is a
 * neutral empty state, not a warning.
 */

/** One stroke in a glyph. `viewBox` is `0 0 64 64` for every entry. */
export interface PlaceholderPath {
  d: string;
  /** Defaults to the svg's own 2.4 when omitted. */
  strokeWidth?: number;
  dashArray?: string;
}

export interface PlaceholderGlyph {
  paths: PlaceholderPath[];
}

/*
 * No `key`/name field: the svg is `aria-hidden`, the frame already carries a translated
 * caption, and an unread field is a standing invitation to bit-rot. The comment above each
 * entry is for humans reading the table.
 */

/**
 * ⚠️ ENTRY ZERO IS THE EXISTING ARTWORK, COPIED VERBATIM.
 *
 * Everything shipped before #86 showed this cloche, so keeping it as one of the variants
 * means the change adds variety rather than replacing a look users already know. Do not
 * "tidy" its path data.
 */
export const PLACEHOLDER_GLYPHS: readonly PlaceholderGlyph[] = Object.freeze([
  {
    // cloche
    paths: [
      { d: 'M14 30h36a2 2 0 0 1 2 2v2a18 18 0 0 1-18 18h-4a18 18 0 0 1-18-18v-2a2 2 0 0 1 2-2z' },
      { d: 'M24 22c0-2 2-3 4-3s4 1 4 3' },
      { d: 'M32 18c0-2 2-3 4-3s4 1 4 3' },
      { d: 'M40 14c0-2 2-3 4-3' },
      { d: 'M10 54h44', strokeWidth: 1.5, dashArray: '2 2' },
    ],
  },
  {
    // pot
    paths: [
      { d: 'M16 28h32v14a12 12 0 0 1-12 12h-8a12 12 0 0 1-12-12z' },
      { d: 'M12 28h40' },
      { d: 'M20 22c0-2 2-3 4-3' },
      { d: 'M30 18c0-2 2-3 4-3' },
      { d: 'M40 22c0-2 2-3 4-3' },
      { d: 'M10 54h44', strokeWidth: 1.5, dashArray: '2 2' },
    ],
  },
  {
    // bowl
    paths: [
      { d: 'M12 32h40a20 20 0 0 1-20 20 20 20 0 0 1-20-20z' },
      { d: 'M24 24c0-2 2-4 4-4' },
      { d: 'M34 20c0-2 2-4 4-4' },
      { d: 'M10 54h44', strokeWidth: 1.5, dashArray: '2 2' },
    ],
  },
  {
    // whisk
    paths: [
      { d: 'M32 12v14' },
      { d: 'M32 26c-8 4-12 12-10 22' },
      { d: 'M32 26c8 4 12 12 10 22' },
      { d: 'M32 26v22' },
      { d: 'M26 48h12' },
      { d: 'M10 54h44', strokeWidth: 1.5, dashArray: '2 2' },
    ],
  },
]);

/**
 * Brand tints for the glyph. Terracotta first — it is what shipped, and what the surrounding
 * kraft-paper gradient was designed against.
 */
export const PLACEHOLDER_TINTS: readonly string[] = Object.freeze(['#E67E22', '#F15D22']);
