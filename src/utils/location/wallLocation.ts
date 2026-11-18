import type { UIStringKey } from '@/services/translation/uiStrings';
import type { PlaceRef } from '@/types/models';
import { fillTemplate } from '@/utils/fillTemplate';
import { describeLocation } from './locationLinks';

type WallT = (key: UIStringKey) => string;

/**
 * The wall sheet's location cell (#150): the place as the value with its kept detail under it.
 * A call shows by its service name with "Join from your phone" under it. NOTHING on the wall is
 * a link, so no href is returned. With the feature off this is the stored text and nothing
 * else (`main` = the text, no sub lines).
 */
export function wallLocation(
  text: string | null | undefined,
  place: PlaceRef | null | undefined,
  t: WallT
): { main: string; subs: string[] } | null {
  if (!text) return null;
  const view = describeLocation(text, place);
  const calls = view.links.filter((l) => l.kind === 'call');
  const placeText = view.placeName ?? view.plain;
  const subs: string[] = [];
  if (view.detail) subs.push(view.detail);
  // With no place text, the first part of the line is the value: a call as "Zoom call" (the
  // approved mockup, and the same wording as a second call below and the calendar block), a
  // map link as "Map Link", a web link by its host.
  const first = placeText ? null : view.oneLine[0];
  const firstText =
    first?.kind === 'map'
      ? t('location.mapLink')
      : first?.kind === 'call'
        ? fillTemplate(t('location.callOf'), { service: first.text })
        : (first?.text ?? '');
  const main = placeText || firstText || text;
  for (const call of calls.slice(placeText ? 0 : 1)) {
    subs.push(fillTemplate(t('location.callOf'), { service: call.service ?? call.host }));
  }
  if (calls.length) subs.push(t('location.joinFromPhone'));
  return { main, subs };
}
