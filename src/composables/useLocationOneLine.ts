import { useTranslation } from '@/composables/useTranslation';
import type { PlaceRef } from '@/types/models';
import { fillTemplate } from '@/utils/fillTemplate';
import { describeLocation, type OneLinePart } from '@/utils/location/locationLinks';

/**
 * Format `describeLocation(...).oneLine` as the single line the compact surfaces show (#150):
 * `📍 place · 🎥 Zoom call · 🔗 host · Map Link`. Each part is prefixed here (the view model is
 * translator-free), and the parts are joined with ' · '.
 *
 * `pin: false` leaves the place without its 📍 for a surface that shows the place bare today
 * (the confirm row, the calendar import row). With the flag off the line is exactly the
 * stored text (plus the 📍 when `pin`), as today.
 */
export function formatLocationOneLine(
  parts: OneLinePart[],
  t: (key: 'location.callOf' | 'location.mapLink') => string,
  pin = true
): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case 'place':
          return pin ? `📍 ${part.text}` : part.text;
        case 'call':
          return `🎥 ${fillTemplate(t('location.callOf'), { service: part.text })}`;
        case 'link':
          return `🔗 ${part.text}`;
        case 'map':
          return t('location.mapLink');
      }
    })
    .join(' · ');
}

/** Template-facing wrapper: `locationOneLine(text, place, { pin })`. */
export function useLocationOneLine() {
  const { t } = useTranslation();
  function locationOneLine(
    text: string | null | undefined,
    place?: PlaceRef | null,
    opts: { pin?: boolean } = {}
  ): string {
    const { oneLine } = describeLocation(text, place);
    return formatLocationOneLine(oneLine, t, opts.pin ?? true);
  }
  return { locationOneLine };
}
