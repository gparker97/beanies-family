import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/marketing', () => ({ MARKETING_URL: 'https://beanies.family' }));
vi.mock('@/utils/openExternal', () => ({ openExternal: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

import { HELP_PATHS, helpUrl, openHelpArticle } from '../helpLinks';
import { openExternal } from '@/utils/openExternal';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { getArticle } from '@/content/help';

const mockOpenExternal = vi.mocked(openExternal);
const mockReportError = vi.mocked(reportError);
const mockLogEvent = vi.mocked(logEvent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('helpUrl', () => {
  it('composes an absolute, cross-origin article url', () => {
    expect(helpUrl(HELP_PATHS.wallSetup)).toBe(
      'https://beanies.family/help/getting-started/set-up-the-beanie-wall'
    );
  });
});

/**
 * THE DRIFT GUARD, and the reason `HELP_PATHS` exists as a record rather than as
 * strings at the call sites.
 *
 * A help link and its article live in different halves of the repo (the app
 * links, the Astro site renders), so renaming a slug breaks the link with no
 * error anywhere: the user just gets a marketing 404. Nothing at runtime can
 * catch that without pulling the whole help corpus into the app bundle, so it
 * is caught here instead, at test time, for every declared path at once.
 */
describe('every declared help path resolves to a real article', () => {
  for (const [name, path] of Object.entries(HELP_PATHS)) {
    it(`${name} -> ${path}`, () => {
      const [category, slug] = path.split('/');
      expect(
        getArticle(category, slug),
        `HELP_PATHS.${name} points at "${path}", which is not a real article. ` +
          'Either the constant or the article slug was renamed; fix whichever is wrong.'
      ).toBeDefined();
    });
  }
});

describe('openHelpArticle', () => {
  it('logs the click and then opens the article', () => {
    openHelpArticle(HELP_PATHS.wallSetup, 'wall-setup-card');

    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'wall-setup-card',
        message: 'help_click',
        context: { action: 'help_click' },
      })
    );
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'https://beanies.family/help/getting-started/set-up-the-beanie-wall'
    );
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('logs the click even when opening throws, so a failing link is still visible as an attempt', () => {
    mockOpenExternal.mockImplementationOnce(() => {
      throw new Error('nope');
    });

    expect(() => openHelpArticle(HELP_PATHS.wallSetup, 'wall-setup-card')).not.toThrow();

    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'wall-setup-card', severity: 'warning' })
    );
  });

  it('carries the calling surface, which is how the two links are told apart', () => {
    openHelpArticle(HELP_PATHS.zeroKnowledge, 'create-welcome');
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'create-welcome' })
    );
  });
});
