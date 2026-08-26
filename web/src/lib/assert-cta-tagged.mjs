/**
 * Build-time guard: every conversion link into the app must carry `data-cta`.
 *
 * WHY THIS EXISTS. The three CTA goals shipped on 2026-08-26 wired to exactly two
 * buttons — the homepage hero and the beanstalk footer — while the nav CTA (which
 * renders on all ~110 pages), the homepage's closing CTA and the inline story links
 * went untagged. The goals therefore recorded nothing at all for a day, and the
 * failure was invisible: Plausible's outbound-link autocapture kept logging the very
 * same clicks, so the dashboard looked alive while the goals sat empty. Nothing in
 * the build, the tests or the lint could tell the difference between "nobody clicked"
 * and "we forgot an attribute".
 *
 * This runs on the BUILT HTML rather than the source, because that is the only place
 * the question is actually settled — a CTA can reach the page from a component, an
 * MDX file or a content collection, and only the output sees all three.
 *
 * TO ADD A NEW CTA: put `data-cta` + `data-cta-loc` on the anchor. That is the whole
 * contract; this guard then leaves it alone.
 *
 * TO EXEMPT A LINK: add it to EXEMPT below WITH A REASON. Exemptions are deliberately
 * awkward to add so the set stays reviewed — an un-reasoned exemption is how the
 * original gap would quietly return.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Links that point at the app but are NOT conversion CTAs. */
const EXEMPT = [
  {
    // Sign-in is returning-user intent, not acquisition. Tagging it as
    // "CTA: Create Pod" would inflate the goal with people who already have a pod.
    test: (href) => /^https:\/\/app\.beanies\.family\/login\/?$/.test(href),
    reason: 'sign-in link (returning user, not a conversion)',
  },
  {
    // Help and oauth pages say things like "open app.beanies.family in Safari" as
    // part of the instructions. These are prose references the reader is meant to
    // read, not buttons we are asking them to press. Scoped to those two trees so
    // an untagged CTA on a marketing page is still caught; the nav CTA that these
    // pages DO render comes from Nav.astro and is tagged, so it is unaffected.
    test: (_href, page) => /^(help|oauth)[/.]/.test(page),
    reason: 'prose reference inside a help/oauth page, not a CTA',
  },
  {
    // Astro emits a stub page for each `redirects` entry (see astro.config.mjs).
    // Its link is the redirect target itself — machinery, with no human clicking it.
    test: (_href, page) => page === 'welcome.html' || page === 'home.html',
    reason: 'generated redirect stub, not a page anyone converts on',
  },
];

/** An <a> whose href enters the app or a store. */
const APP_LINK = /^(https:\/\/app\.beanies\.family(\/.*)?|\/(ios|android|download))$/;

function htmlFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) htmlFiles(full, base, out);
    else if (entry.endsWith('.html')) out.push([full, relative(base, full)]);
  }
  return out;
}

export default function assertCtaTagged() {
  return {
    name: 'beanies:assert-cta-tagged',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const root = typeof dir === 'string' ? dir : fileURLToPath(dir);
        const offenders = [];
        let tagged = 0;

        for (const [file, page] of htmlFiles(root)) {
          const html = readFileSync(file, 'utf8');
          for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
            const href = tag.match(/href="([^"]*)"/)?.[1];
            if (!href || !APP_LINK.test(href)) continue;
            if (tag.includes('data-cta=')) {
              tagged++;
              continue;
            }
            if (EXEMPT.some((e) => e.test(href, page))) continue;
            offenders.push({ page, href });
          }
        }

        if (offenders.length) {
          // Group by href: one missing attribute on a shared component shows up on
          // every page that renders it, and a 110-line list buries the one fact the
          // author needs (which link, and roughly where).
          const byHref = new Map();
          for (const o of offenders) {
            if (!byHref.has(o.href)) byHref.set(o.href, []);
            byHref.get(o.href).push(o.page);
          }
          const detail = [...byHref.entries()]
            .map(([href, pages]) => {
              const where =
                pages.length > 3
                  ? `${pages.slice(0, 3).join(', ')} … and ${pages.length - 3} more (likely a shared component)`
                  : pages.join(', ');
              return `  ${href}\n    on: ${where}`;
            })
            .join('\n');
          throw new Error(
            `${offenders.length} link(s) into the app are missing data-cta, so their clicks ` +
              `would not reach Plausible:\n\n${detail}\n\n` +
              `Add data-cta="CTA: <goal name>" and data-cta-loc="<placement>" to each anchor.\n` +
              `If a link genuinely is not a CTA, add it to EXEMPT (with a reason) in ` +
              `src/lib/assert-cta-tagged.mjs.`
          );
        }

        logger.info(`CTA guard: ${tagged} tagged app link(s), 0 untagged.`);
      },
    },
  };
}
