/**
 * Web Vitals RUM → Plausible. Sends LCP, INP, CLS (+ TTFB, FCP) as
 * custom events. Runs on every page of the marketing site.
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

type Plausible = (event: string, opts?: { props?: Record<string, string | number> }) => void;

function send({ name, value, rating }: Metric) {
  const p: Plausible | undefined = (window as unknown as { plausible?: Plausible }).plausible;
  if (!p) return;
  p(`CWV ${name}`, {
    props: {
      value: Math.round(name === 'CLS' ? value * 1000 : value),
      rating,
    },
  });
}

onLCP(send);
onINP(send);
onCLS(send);
onFCP(send);
onTTFB(send);
