/**
 * Brand art, imported (not `staticFile`d) on purpose.
 *
 * `remotion.config.ts` points the public dir at the generated screenshots, so
 * `staticFile()` cannot reach `public/brand/`. Importing lets Remotion's bundler
 * resolve and fingerprint these directly from the repo.
 *
 * Golden rule (CIG): the beanies hold hands and are never separated, and the
 * arrow in the logo is never rotated. Nothing here may be rotated or cropped.
 */
import hugging from '../public/brand/beanies_family_hugging_transparent_1600x1600.png';
import logo from '../public/brand/beanies_logo_transparent_logo_only_192x192.png';
import celebrating from '../public/brand/beanies_celebrating_line_transparent_560x225.png';
/** The CIG's designated asset for "data encrypted" — not a padlock. */
import coveringEyes from '../public/brand/beanies_covering_eyes_transparent_512x512.png';
/** The CIG's designated asset for feature bullet points. */
import impactBullet from '../public/brand/beanies_impact_bullet_transparent_192x192.png';

export const ART = { hugging, logo, celebrating, coveringEyes, impactBullet } as const;
