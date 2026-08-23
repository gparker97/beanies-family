/**
 * Web Vitals RUM → Plausible. Sends LCP, INP, CLS (+ TTFB, FCP) as
 * custom events. Runs on every page of the marketing site.
 *
 * All of them are sent with `interactive: false`. Plausible treats any custom
 * event as engagement unless told otherwise, so tagging these is what keeps
 * bounce rate meaningful — see plausible.io/docs/custom-event-goals.
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

type Plausible = (
  event: string,
  opts?: { props?: Record<string, string | number>; interactive?: boolean }
) => void;

function send({ name, value, rating }: Metric) {
  const p: Plausible | undefined = (window as unknown as { plausible?: Plausible }).plausible;
  if (!p) return;
  p(`CWV ${name}`, {
    props: {
      value: Math.round(name === 'CLS' ? value * 1000 : value),
      rating,
    },
    // Non-interactive: the browser reports these, the visitor does nothing.
    // Without this every session counts as engaged and bounce rate collapses
    // (it read 1% while ~92% of visitors fired a CWV event).
    interactive: false,
  });
}

onLCP(send);
onINP(send);
onCLS(send);
onFCP(send);
onTTFB(send);
