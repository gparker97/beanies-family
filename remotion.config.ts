/**
 * Remotion CLI config for the store promo video (`npm run promo:studio` / `promo:render`).
 *
 * Scoped entirely to `promo/`. Nothing here touches the Vue app, its Vite config,
 * or its bundle: React + Remotion are devDependencies and no file under `src/`
 * imports them.
 *
 * `setPublicDir` points `staticFile()` at the screenshot harness output rather
 * than the app's own `public/` (which holds PWA icons). Those PNGs are generated
 * and git-ignored, so run `npm run store:screenshots` before rendering.
 */
import { Config } from '@remotion/cli/config';

Config.setPublicDir('scripts/store-screenshots/.out');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
