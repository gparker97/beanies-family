/**
 * Every Outfit/Inter/Caveat face the shared export shell renders (`ExportSheet` +
 * `ExportPeopleLegend`) — each forced into flight before capture so the fonts-ready
 * gate actually covers them (no FOUT). A sheet whose body uses further faces passes
 * them as extras to `useSheetExportRunner`, which appends them to this list.
 * Weights/styles must match what the components actually use.
 */
export const SHEET_EXPORT_FONTS: readonly string[] = [
  '600 15px Outfit', // labels, meta
  '700 16px Outfit', // headings, names, chips
  '800 24px Outfit', // heading, date range
  'italic 400 14px Outfit', // .export-tagline
  '400 14px Inter', // body
  '700 22px Caveat', // header accent
];
