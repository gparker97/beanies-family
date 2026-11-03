/**
 * track(): the ONE way the marketing site's own scripts send a Plausible custom event.
 *
 * Plausible is loaded by an `is:inline` loader + stub queue in BaseLayout.astro (and in
 * download.astro, which is standalone and carries its own copy). This helper only looks
 * `window.plausible` up and calls it: absent is a quiet no-op (a blocker, or a page without
 * the loader), and a throw is caught and warned, so analytics can never break a page.
 *
 * Props are strings only, the shape Plausible's custom properties take; send numbers as
 * strings (`percent: '25'`).
 */

export type PlausibleProps = Record<string, string>;
export type PlausibleFn = (name: string, opts?: { props?: PlausibleProps }) => void;

export function track(name: string, props: PlausibleProps): void {
  try {
    const plausible = (window as unknown as { plausible?: PlausibleFn }).plausible;
    plausible?.(name, { props });
  } catch (err) {
    console.warn(
      `[plausible] could not send ${name}; check the Plausible loader in BaseLayout.astro (or download.astro, which has its own)`,
      err
    );
  }
}
