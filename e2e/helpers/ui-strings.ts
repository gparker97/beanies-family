/**
 * E2E UI String Resolver
 *
 * Imports the app's UI string definitions so E2E tests can reference
 * translation keys instead of hardcoded English strings. This prevents
 * minor copy changes from breaking tests.
 *
 * Usage:
 *   import { ui } from '../helpers/ui-strings';
 *   await page.getByText(ui('assets.hasLoan')).click();
 *   await dialog.getByPlaceholder(ui('assets.assetName')).fill('Home');
 */
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';

/**
 * Resolve a UI string key to its English display text.
 * Throws if the key doesn't exist (catches typos at test time).
 */
export function ui(key: UIStringKey): string {
  const text = UI_STRINGS[key];
  if (!text) throw new Error(`Unknown UI string key: "${key}"`);
  return text;
}
