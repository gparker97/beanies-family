/**
 * What a location string holds, worked out at render time (#150, ADR-049): the place text, any
 * video call links (Join Call), map links and other web links (Open Link). Links are derived,
 * never stored, so nothing about them can go stale.
 *
 * `describeLocation` is the one view model every surface renders. It is also the only display
 * branch on the `placeSuggestions` flag: with it off, every surface gets exactly today's text
 * and map link.
 *
 * ACCEPTANCE POLICY (the whole of it; a new rule needs a failing fixture and an ADR-049 line):
 * a span found by `extractUrlSpans` is a link only when (a) it had an explicit `http(s)://`
 * scheme, or (b) it is a bare host that starts with `www.` or matches `CALL_SERVICES` or the
 * Maps hosts. Every accepted link is screened by `safeExternalHref`. Any other bare
 * `word.word` ("St.Regis Hotel", "Mt.Pleasant Rd", "Jln.Besar/Kitchener") stays place text.
 */
import { isFlagEnabled } from '@/config/flags';
import { CALL_SERVICES, MAPS_HOSTS, hostMatches } from '@/constants/callServices';
import type { PlaceRef } from '@/types/models';
import { extractUrlSpans, safeExternalHref, type UrlSpan } from '@/utils/url';
import { detailOf, mapsHref, validPlace } from './placeText';

/**
 * Whether #150's location behaviour is on. The ONLY reader of the `placeSuggestions` flag (a
 * unit test greps `src/` for the id); every other caller goes through this function.
 */
export function locationLinksEnabled(): boolean {
  return isFlagEnabled('placeSuggestions');
}

export type LocationLinkKind = 'call' | 'map' | 'web';

export interface LocationLink {
  /** Screened by `safeExternalHref`: safe to bind to an `href` or hand to `openExternal`. */
  href: string;
  kind: LocationLinkKind;
  /** The call service's name, for `kind: 'call'`. */
  service?: string;
  /** Lowercased hostname (punycode for an IDN host). */
  host: string;
}

export interface ParsedLocation {
  /** The text with the accepted links cut out and the separators tidied: what is shown. */
  place: string;
  links: LocationLink[];
  /**
   * `place` minus any non-http scheme token (`zoommtg://…`, `msteams://…`,
   * `javascript://…`), which stays visible but is never sent to a map search. '' = no map link.
   */
  mapQuery: string;
}

/**
 * Edge separators left behind when a link is cut out of "Room 3, 12 Main St: https://…".
 * Line breaks are kept (multi-line addresses exist); runs of other whitespace become a space.
 */
function tidy(s: string): string {
  return s
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/[\s:]+([,;])/g, '$1')
    .replace(/([,;])[\s,;]*[,;]/g, '$1')
    .replace(/^[\s,;:|·-]+/, '')
    .replace(/[\s,;:|·-]+$/, '');
}

/**
 * Where a scheme URL stops when extended to the next whitespace: `PROTOCOL_URL_REGEX`'s own
 * stop set (`src/utils/url.ts`) minus `,`, `;` and `)`, which a Maps URL's `@lat,lng` and a
 * Wikipedia path need. Mirrored rather than shared, so `extractUrls` stays as it is.
 */
const SCHEME_URL_STOP = /[\s<>"'`}\]]/;
/** Sentence punctuation that is never the last character of a link. */
const TRAILING_PUNCTUATION = /[.,;:!?\u2026]/;

/**
 * Where an accepted link was cut out, while the leftover text is tidied. A private-use
 * character, so the patterns below can be plain literals (no RegExp built from strings); if
 * typed text ever held one it would simply read as a cut, which becomes a space.
 */
const CUT = '\uE000';
/** A bracket or quote pair left holding nothing but a cut: `( )`, `<>`, `[]`, `""`. */
const EMPTY_PAIR =
  /\(\s*\uE000\s*\)|\[\s*\uE000\s*\]|\{\s*\uE000\s*\}|<\s*\uE000\s*>|"\s*\uE000\s*"|'\s*\uE000\s*'|`\s*\uE000\s*`|\u201C\s*\uE000\s*\u201D|\u2018\s*\uE000\s*\u2019/gu;
/** Sentence punctuation stuck to the end of a cut: what was trimmed off the link ("<link>."). */
const PUNCTUATION_AFTER_CUT = /\uE000[.!?:\u2026]+/gu;
const CUTS_IN_A_ROW = /\uE000[\s\uE000]*\uE000/gu;
/** The space a cut leaves inside the member's own brackets: "(Room 2 <link>)" → "(Room 2)". */
const CUT_BEFORE_CLOSER = /\s*\uE000(?=[)\]}>])/gu;
const CUT_AFTER_OPENER = /(?<=[([{<])\uE000\s*/gu;

/**
 * The text left after the accepted links were cut out (`CUT` marks each place): a bracket or
 * quote pair left empty and sentence punctuation stuck to a cut are dropped, a cut inside the
 * member's own brackets closes up, and `tidy` evens the separators (and strips a dangling `:`
 * or `-`). Only characters touching a cut go, so text the member typed with a letter or a
 * digit in it is never removed, and neither is a separator between two pieces of it
 * ("Room 3 & 4", "Zoom - Room 2").
 */
function tidyCut(rest: string): string {
  let s = rest.replace(CUTS_IN_A_ROW, CUT);
  for (let before = ''; before !== s;) {
    before = s;
    s = s.replace(EMPTY_PAIR, CUT).replace(PUNCTUATION_AFTER_CUT, CUT).replace(CUTS_IN_A_ROW, CUT);
  }
  s = s.replace(CUT_BEFORE_CLOSER, '').replace(CUT_AFTER_OPENER, '');
  return tidy(s.replaceAll(CUT, ' '));
}

const NON_HTTP_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HTTP_SCHEME = /^https?:\/\//i;

/**
 * Classify a screened href: a known call service, a map link, or an ordinary web link. Exact
 * host data only (see `callServices.ts`); the one path rule is `google.com` + `/maps`.
 */
export function linkKindOf(href: string): Pick<LocationLink, 'kind' | 'service' | 'host'> {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'web', host: '' };
  }
  const host = url.hostname.toLowerCase();
  for (const service of CALL_SERVICES) {
    if (service.hosts.some((entry) => hostMatches(host, entry))) {
      return { kind: 'call', service: service.name, host };
    }
  }
  if (MAPS_HOSTS.some((entry) => hostMatches(host, entry))) return { kind: 'map', host };
  if (hostMatches(host, 'google.com') && /^\/maps(?:\/|$)/.test(url.pathname)) {
    return { kind: 'map', host };
  }
  return { kind: 'web', host };
}

/** A bare host is a link only with `www.` or a call-service / Maps host (rule b). */
function bareHostAccepted(raw: string): boolean {
  let host: string;
  try {
    host = new URL(`https://${raw}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith('www.')) return true;
  if (MAPS_HOSTS.some((entry) => hostMatches(host, entry))) return true;
  return CALL_SERVICES.some((s) => s.hosts.some((entry) => hostMatches(host, entry)));
}

/**
 * In a location string a scheme URL runs on past `,`, `;` and `)` to the next whitespace (or
 * `SCHEME_URL_STOP` character: `Join <https://…>` ends at the `>`), so a Google Maps URL keeps
 * its `@lat,lng,17z`; `extractUrls`' own matching stops at the comma and is left unchanged for
 * its other callers. It never runs into the next scheme span.
 *
 * Sentence punctuation after the link is not part of it: a trailing run of `.`, `,`, `;`, `:`,
 * `!`, `?` or an ellipsis is trimmed from the WHOLE span ("Online: https://meet.google.com/
 * abc-defg-hij." links without the period; a `?` followed by query text is not trailing), and
 * so is an unbalanced `)`, but not one that closes a `(` inside the URL ("…/wiki/Bean_(plant)").
 */
function extendSchemeSpan(text: string, span: UrlSpan, nextStart: number): UrlSpan {
  let end = span.end;
  while (end < text.length && end < nextStart && !SCHEME_URL_STOP.test(text[end]!)) end++;
  // Never trim into the scheme itself (`https://` plus one character).
  const floor = span.start + text.slice(span.start, end).indexOf('://') + 4;
  while (end > floor) {
    const last = text[end - 1]!;
    if (TRAILING_PUNCTUATION.test(last)) {
      end--;
      continue;
    }
    if (last !== ')') break;
    const body = text.slice(span.start, end);
    if (body.split('(').length >= body.split(')').length) break;
    end--;
  }
  const raw = text.slice(span.start, end);
  return { ...span, raw, url: raw, end };
}

/** Split a location string into its place text and its screened links. Pure. */
export function parseLocation(text: string | null | undefined): ParsedLocation {
  const source = text ?? '';
  const spans = extractUrlSpans(source);
  const schemeStarts = spans.filter((s) => s.hadScheme).map((s) => s.start);

  const accepted: Array<{ start: number; end: number; link: LocationLink }> = [];
  for (const span of spans) {
    let candidate = span;
    if (span.hadScheme) {
      const next = schemeStarts.filter((s) => s > span.start).sort((a, b) => a - b)[0];
      candidate = extendSchemeSpan(source, span, next ?? source.length);
    } else if (!bareHostAccepted(span.raw)) {
      continue;
    }
    // Never two links over the same characters (a bare host inside a scheme URL, say).
    if (accepted.some((a) => candidate.start < a.end && a.start < candidate.end)) continue;
    const href = safeExternalHref(candidate.url);
    if (!href) continue;
    accepted.push({
      start: candidate.start,
      end: candidate.end,
      link: { href, ...linkKindOf(href) },
    });
  }
  accepted.sort((a, b) => a.start - b.start);

  let rest = '';
  let at = 0;
  for (const a of accepted) {
    rest += `${source.slice(at, a.start)}${CUT}`;
    at = a.end;
  }
  rest += source.slice(at);
  // Untouched text stays exactly as typed (trimmed); only a cut needs tidying.
  const tidied = tidyCut(rest);
  // A cut that leaves only punctuation behind ("<link>.") leaves no place.
  const place = accepted.length ? (/[\p{L}\p{N}]/u.test(tidied) ? tidied : '') : source.trim();
  const isOtherScheme = (token: string) => NON_HTTP_SCHEME.test(token) && !HTTP_SCHEME.test(token);
  const mapQuery = place.split(/\s+/).some(isOtherScheme)
    ? tidy(place.replace(/\S+/g, (token) => (isOtherScheme(token) ? '' : token)))
    : place;
  return { place, links: accepted.map((a) => a.link), mapQuery };
}

export type OneLinePartKind = 'place' | 'call' | 'link' | 'map';

/**
 * One part of a single-line rendering, translator-free: the place text (name and detail joined
 * by ', '), the service name for a call, the hostname for a web link, and '' for a map link.
 * Template surfaces prefix each part themselves (📍 place, 🎥 + `location.callOf` for a call,
 * 🔗 host, `location.mapLink` for a map) and join the parts with ' · '.
 */
export interface OneLinePart {
  kind: OneLinePartKind;
  text: string;
}

export interface LocationView {
  /** The valid picked place's name (the map row's link text). */
  placeName?: string;
  /** The kept detail under the place (never part of the map search). */
  detail?: string;
  /** The text to show when there is no picked place (links cut out when the flag is on). */
  plain: string;
  /** The map link for the place text, or undefined when there is nothing to search for. */
  mapHref?: string;
  links: LocationLink[];
  /** In order: place, calls, map links, web links. */
  oneLine: OneLinePart[];
}

export interface DescribeLocationOptions {
  /** Defaults to `locationLinksEnabled()`. */
  enabled?: boolean;
  /**
   * With the flag off, whether the surface shows a map link today (default true).
   * `EmergencyContactsPage` and `ExternalEventDetailsModal` pass false.
   */
  mapWhenOff?: boolean;
}

/**
 * The one view model for every location surface. Runs `parseLocation` first and applies
 * `validPlace` / `detailOf` to the remaining place text, so a link is never part of the detail.
 * Flag off: exactly today's text and map link, nothing else.
 */
export function describeLocation(
  text: string | null | undefined,
  place?: PlaceRef | null,
  opts: DescribeLocationOptions = {}
): LocationView {
  const source = text ?? '';
  const enabled = opts.enabled ?? locationLinksEnabled();
  if (!enabled) {
    return {
      plain: source,
      mapHref: (opts.mapWhenOff ?? true) ? mapsHref(source) : undefined,
      links: [],
      oneLine: [{ kind: 'place', text: source }],
    };
  }

  const parsed = parseLocation(source);
  const valid = validPlace(parsed.place, place);
  const detail = valid ? detailOf(parsed.place, valid) : '';
  const mapHref = valid
    ? mapsHref(parsed.place, valid)
    : parsed.mapQuery
      ? mapsHref(parsed.mapQuery)
      : undefined;

  const oneLine: OneLinePart[] = [];
  if (parsed.place) oneLine.push({ kind: 'place', text: parsed.place });
  for (const link of parsed.links) {
    if (link.kind === 'call') oneLine.push({ kind: 'call', text: link.service ?? link.host });
  }
  for (const link of parsed.links) if (link.kind === 'map') oneLine.push({ kind: 'map', text: '' });
  for (const link of parsed.links)
    if (link.kind === 'web') oneLine.push({ kind: 'link', text: link.host });

  return {
    ...(valid ? { placeName: valid.name } : {}),
    ...(detail ? { detail } : {}),
    plain: parsed.place,
    mapHref,
    links: parsed.links,
    oneLine,
  };
}

/**
 * A location with a meeting URL appended (a Google Calendar event's join link, #150 P4),
 * unless the text already contains it.
 */
export function withMeetingUrl(
  location: string | null | undefined,
  url: string | null | undefined
): string {
  const base = location ?? '';
  if (!url) return base;
  if (base.includes(url)) return base;
  return base.trim() ? `${base.trimEnd()} ${url}` : url;
}

/** The read row's label: "Location", or "Location or Link" once the text holds a link. */
export function locationLabelKey(
  view: Pick<LocationView, 'links'>
): 'planner.field.location' | 'planner.field.locationOrLink' {
  return view.links.length ? 'planner.field.locationOrLink' : 'planner.field.location';
}

/**
 * What a Join Call button shows under itself: hostname + pathname, never the query or the
 * fragment (a passcode must not show on a shared screen). An IDN host shows as punycode.
 */
export function joinCaption(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${url.hostname}${path}`;
  } catch {
    return '';
  }
}
