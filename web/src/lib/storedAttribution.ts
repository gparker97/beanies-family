/**
 * Capture + sweep + read of the campaign tag on the marketing site (#118). Shared by
 * `AppLinks.astro` and the /ios and /android redirect pages (`storeRedirect.ts`), so there is
 * ONE first-touch rule: an unexpired stored tag always wins over the URL's.
 */
import {
  ATTRIBUTION_STORAGE_KEY,
  makeEnvelope,
  parseAttribution,
  readEnvelope,
  type Attribution,
} from '@beanies/brand/attribution';

/** A stored value that is not JSON reads as `corrupt` (replaced), not as a storage refusal. */
function parseStored(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { v: 0 };
  }
}

/**
 * Capture. First touch wins: an unexpired envelope is never overwritten; a corrupt or
 * expired one is replaced. There is no firehose on the site; the CTA `attributed` prop is the
 * production-visible signal when storage is refused. Returns the tag in force for this page
 * (stored, else the one just parsed), computed AFTER the capture so a tag captured on this very
 * page decorates its links.
 */
export function readStoredAttribution(search: string): Attribution | null {
  const now = Date.now();
  const parsed = parseAttribution(search);
  let stored: Attribution | null = null;
  try {
    const existing = readEnvelope(parseStored(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)), now);
    if (existing.state === 'ok') stored = existing.fields;
    else if (parsed) {
      localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(makeEnvelope(parsed, now)));
    } else if (existing.state !== 'none') {
      // Expired or corrupt and nothing to replace it: remove it, so the tag really does leave
      // the device after 30 days as the privacy page says, not only when a new tag arrives.
      localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
    }
  } catch (err) {
    console.warn(
      '[attribution] localStorage refused — forwarding unattributed; check private mode/quota',
      err
    );
  }
  return stored ?? parsed;
}
