/**
 * Video call services whose links show as Join Call in a location (#150, ADR-049), and the
 * hosts whose links show as a map link.
 *
 * MATCHING IS EXACT-HOST DATA: a host matches an entry when it equals it or ends with `.` +
 * the entry, after `new URL(...).hostname.toLowerCase()`. No regex, no substring, no path rules
 * (except the one `google.com/maps` path check in `locationLinks.ts`). Join Call renders on
 * other people's calendar events, so `zoom.us.evil.example` and `evilzoom.us` must never read
 * as Zoom; a trailing-dot host (`zoom.us.`) is not an entry either and shows as Open Link.
 *
 * Adding a service is one row that carries its own fixture (`sample`); the table test checks
 * every row. A missing service degrades to Open Link, which still works, so the list is never
 * urgent. Names are proper nouns and are not translated.
 */
export interface CallService {
  /** The service's own name, shown as "Join {name} Call" and "{name} call". */
  readonly name: string;
  /** Registrable hosts (and their subdomains) that serve the service's meeting links. */
  readonly hosts: readonly string[];
  /** A real-shaped meeting link, the row's own test fixture. */
  readonly sample: string;
}

export const CALL_SERVICES: readonly CallService[] = Object.freeze([
  {
    name: 'Zoom',
    hosts: ['zoom.us', 'zoom.com', 'zoomgov.com'],
    sample: 'https://us02web.zoom.us/j/84512207719?pwd=x7Kq',
  },
  {
    name: 'Google Meet',
    hosts: ['meet.google.com'],
    sample: 'https://meet.google.com/abc-defg-hij',
  },
  {
    name: 'Microsoft Teams',
    hosts: ['teams.microsoft.com', 'teams.live.com'],
    sample: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0',
  },
  { name: 'Webex', hosts: ['webex.com'], sample: 'https://acme.webex.com/meet/jane' },
  { name: 'VooV Meeting', hosts: ['voovmeeting.com'], sample: 'https://voovmeeting.com/dm/abc123' },
  {
    name: 'Tencent Meeting',
    hosts: ['meeting.tencent.com'],
    sample: 'https://meeting.tencent.com/dm/abc123',
  },
  {
    name: 'FaceTime',
    hosts: ['facetime.apple.com'],
    sample: 'https://facetime.apple.com/join#v=1&p=abc',
  },
  { name: 'Whereby', hosts: ['whereby.com'], sample: 'https://whereby.com/family-room' },
  { name: 'Jitsi', hosts: ['meet.jit.si', '8x8.vc'], sample: 'https://meet.jit.si/FamilyCatchUp' },
  { name: 'Skype', hosts: ['join.skype.com'], sample: 'https://join.skype.com/abcDEF123' },
  {
    name: 'GoTo',
    hosts: ['meet.goto.com', 'gotomeeting.com', 'gotomeet.me'],
    sample: 'https://meet.goto.com/123456789',
  },
  { name: 'BlueJeans', hosts: ['bluejeans.com'], sample: 'https://bluejeans.com/123456789' },
  { name: 'Lark', hosts: ['vc.larksuite.com'], sample: 'https://vc.larksuite.com/j/123456789' },
  { name: 'Feishu', hosts: ['vc.feishu.cn'], sample: 'https://vc.feishu.cn/j/123456789' },
  {
    name: 'DingTalk',
    hosts: ['meeting.dingtalk.com'],
    sample: 'https://meeting.dingtalk.com/j/abc123',
  },
] as const);

/** Hosts whose links are map links (any path). `google.com` + a `/maps` path is the one path rule. */
export const MAPS_HOSTS: readonly string[] = Object.freeze([
  'maps.google.com',
  'maps.app.goo.gl',
  'maps.apple.com',
]);

/** True when `host` (already lowercased) is `entry` or a subdomain of it. */
export function hostMatches(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}
