/**
 * Films shown on the marketing site: one record per film, plus the pure helpers the
 * FilmCard component (and its tests) use. Plan:
 * ~/projects/beanies-ops/docs/plans/2026-11-03-musical-homepage-and-media-hosting.md
 *
 * MEDIA URLS ARE ABSOLUTE PRODUCTION URLS, built from SITE_URL, so `astro dev`,
 * `astro preview` and Lighthouse CI (a localhost port) load the real files instead of
 * 404ing into the console-error gate. Objects live in the private media bucket behind
 * the apex distribution's `/media/*` behaviour at immutable, versioned keys
 * (`media/<film>/<version>/<file>`). A new cut goes to the next version and is uploaded
 * and verified with the ops repo's `scripts/media/upload-media.sh` BEFORE the record
 * below changes; earlier versions are never deleted, because cached pages keep
 * referencing them.
 */
import { SITE_URL } from '@beanies/brand/nav';
import { ORGANIZATION } from '@beanies/brand/schema';

export interface FilmUrls {
  film720: string;
  film1080: string;
  loop640: string;
  loop960: string;
  poster: string;
}

export interface Film {
  /** Lowercase, as greg wrote it: the stub on the card, the dialog's name, the VideoObject name. */
  title: string;
  description: string;
  /** Running time in whole seconds; every duration string derives from this. */
  durationS: number;
  /** ISO date the film went live at its URL, for the VideoObject: set it on the day the page deploys. */
  uploadDate: string;
  /** Plausible event-name prefix: `<prefix>: Seen`, `: Play`, `: Progress`, `: Error`. */
  eventPrefix: string;
  urls: FilmUrls;
}

/** Below this width the dialog plays the 720p film and the card the 640 loop. */
export const NARROW_MQ = '(max-width: 899px)';

/** Watch-depth milestones sent as `<prefix>: Progress { percent }`. */
export const MILESTONES = [25, 50, 75, 100] as const;

/** The upload set of one film version (`05-delivery/cuts/web/` for the musical). */
function mediaUrls(keyPrefix: string): FilmUrls {
  const base = `${SITE_URL}/media/${keyPrefix}/`;
  return {
    film720: `${base}film-720.mp4`,
    film1080: `${base}film-1080.mp4`,
    loop640: `${base}loop-640.mp4`,
    loop960: `${base}loop-960.mp4`,
    poster: `${base}poster-1280.webp`,
  };
}

export const MUSICAL: Film = {
  title: 'the morning routine musical',
  description:
    'a 67-second animated musical about the chaos of a family morning, written and produced by greg, the dad who makes beanies.family.',
  durationS: 67,
  uploadDate: '2026-11-03', // bump to the deploy date when deploy-web.yml ships this page
  eventPrefix: 'Musical',
  urls: mediaUrls('musical/v1'),
};

type Timed = Pick<Film, 'durationS'>;

function minutesSeconds({ durationS }: Timed): [number, number] {
  const total = Math.max(0, Math.round(durationS));
  return [Math.floor(total / 60), total % 60];
}

/** "1:07", the stub's running time. */
export function durationClock(film: Timed): string {
  const [m, s] = minutesSeconds(film);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "PT1M7S", the VideoObject `duration`. */
export function durationIso(film: Timed): string {
  const [m, s] = minutesSeconds(film);
  return `PT${m ? `${m}M` : ''}${s || !m ? `${s}S` : ''}`;
}

/** "1 minute 7 seconds", for the card's accessible name. */
export function durationSpoken(film: Timed): string {
  const [m, s] = minutesSeconds(film);
  const parts: string[] = [];
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (s || !m) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

/** The film as a schema.org VideoObject, a node in the page's JSON-LD @graph. */
export function videoObject(film: Film): Record<string, unknown> {
  return {
    '@type': 'VideoObject',
    name: film.title,
    description: film.description,
    thumbnailUrl: film.urls.poster,
    uploadDate: film.uploadDate,
    duration: durationIso(film),
    contentUrl: film.urls.film1080,
    publisher: { '@id': ORGANIZATION['@id'] },
  };
}

/**
 * The milestones reached at `currentTime` and not yet in `fired`, in order. Pure: the
 * caller adds what it sends to `fired`, which it resets per opening, so a rewind never
 * re-fires and a seek past several returns them all. `[]` while the duration is unknown
 * (NaN before metadata, Infinity for a stream) or zero.
 */
export function newMilestones(
  currentTime: number,
  duration: number,
  fired: ReadonlySet<number>
): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return [];
  const percent = (currentTime / duration) * 100;
  return MILESTONES.filter((m) => percent >= m && !fired.has(m));
}

/**
 * MediaError codes by number. A local table on purpose: the `MediaError` global is not
 * defined in happy-dom (the vitest environment), and the codes are fixed by the spec.
 */
const MEDIA_ERR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

/**
 * A short, fixed-vocabulary reason for `<prefix>: Error`: an Error / DOMException `name`
 * (a `play()` rejection), `MEDIA_ERR_<NAME>` for a media element's `error`, else `unknown`.
 */
export function errorReason(e: unknown): string {
  if (typeof e !== 'object' || e === null) return 'unknown';
  const { name, code } = e as { name?: unknown; code?: unknown };
  if (typeof name === 'string' && name) return name;
  if (typeof code === 'number' && MEDIA_ERR_NAMES[code]) return MEDIA_ERR_NAMES[code];
  return 'unknown';
}
