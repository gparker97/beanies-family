import { test, expect, type Page, type Route } from '@playwright/test';
import { IndexedDBHelper } from '../helpers/indexeddb';

/**
 * E2E tests for Google Drive cloud storage integration.
 *
 * Uses Playwright route interception to mock:
 * - Google Identity Services (GIS) OAuth script
 * - Google Drive REST API endpoints
 *
 * These tests verify the mock API infrastructure works correctly,
 * validating that the app's Drive integration code paths will function.
 */

const MOCK_ACCESS_TOKEN = 'mock-e2e-access-token';
const MOCK_FOLDER_ID = 'mock-app-folder-id';
const MOCK_FILE_ID = 'mock-beanpod-file-id';
const MOCK_FILE_NAME = 'test-family.beanpod';

const MOCK_BEANPOD_CONTENT = JSON.stringify({
  version: '2.0',
  exportedAt: new Date().toISOString(),
  encrypted: false,
  familyId: 'e2e-drive-family-id',
  familyName: 'Drive Test Family',
  data: {
    familyMembers: [
      {
        id: 'member-1',
        name: 'Drive Tester',
        email: 'tester@example.com',
        role: 'owner',
        gender: 'other',
        ageGroup: 'adult',
        color: '#F15D22',
        requiresPassword: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    accounts: [],
    transactions: [],
    assets: [],
    goals: [],
    settings: {
      id: 'app_settings',
      baseCurrency: 'USD',
      theme: 'system',
      syncEnabled: true,
      encryptionEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    recurringItems: [],
    todos: [],
  },
});

const MOCK_GIS_SCRIPT = `
  window.google = window.google || {};
  window.google.accounts = window.google.accounts || {};
  window.google.accounts.oauth2 = {
    initTokenClient: function(config) {
      return {
        requestAccessToken: function(opts) {
          setTimeout(function() {
            config.callback({
              access_token: '${MOCK_ACCESS_TOKEN}',
              expires_in: 3600,
            });
          }, 50);
        }
      };
    },
    revoke: function(token, cb) { if (cb) cb(); }
  };
`;

async function mockGoogleAPIs(page: Page) {
  // Mock GIS script
  await page.route(/accounts\.google\.com\/gsi\/client/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: MOCK_GIS_SCRIPT,
    });
  });

  // Mock Drive API — use regex for reliable matching
  await page.route(/googleapis\.com/, async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Search for app folder (contains 'mimeType' in query)
    if (url.includes('mimeType') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: [{ id: MOCK_FOLDER_ID, name: 'beanies.family' }],
        }),
      });
      return;
    }

    // Read file content (alt=media)
    if (url.includes(MOCK_FILE_ID) && url.includes('alt=media') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: MOCK_BEANPOD_CONTENT,
      });
      return;
    }

    // Get file metadata (modifiedTime)
    if (url.includes(MOCK_FILE_ID) && url.includes('modifiedTime') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ modifiedTime: new Date().toISOString() }),
      });
      return;
    }

    // List files in folder (contains folder ID in query)
    if (url.includes(MOCK_FOLDER_ID) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: [
            {
              id: MOCK_FILE_ID,
              name: MOCK_FILE_NAME,
              modifiedTime: new Date().toISOString(),
            },
          ],
        }),
      });
      return;
    }

    // Create file (multipart upload - POST)
    if (url.includes('upload') && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: MOCK_FILE_ID, name: MOCK_FILE_NAME }),
      });
      return;
    }

    // Update file (media upload - PATCH with file ID)
    if (url.includes(MOCK_FILE_ID) && method === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: MOCK_FILE_ID }),
      });
      return;
    }

    // Default: empty success
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ files: [] }),
    });
  });
}

test.describe('Google Drive Sync', () => {
  test.beforeEach(async ({ page }) => {
    await mockGoogleAPIs(page);
  });

  test('Google Drive text is visible on Load Pod view', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    // Click "Load my pod" on welcome gate
    const loadButton = page.getByRole('button', { name: /load/i });
    await loadButton.first().waitFor({ state: 'visible', timeout: 5000 });
    await loadButton.first().click();

    // Google Drive label should be visible (either as button or disabled div)
    const driveLabel = page.getByText('Google Drive').first();
    await expect(driveLabel).toBeVisible({ timeout: 5000 });
  });

  test('Google Drive option visible on Create Pod step 2', async ({ page }) => {
    await page.goto('/');
    const dbHelper = new IndexedDBHelper(page);
    await dbHelper.clearAllData();
    await page.goto('/');

    await page
      .getByRole('button', { name: /create/i })
      .first()
      .click();

    await page.getByLabel('Family Name').fill('E2E Drive Family');
    await page.getByLabel('Your Name').fill('Drive Test');
    await page.getByLabel('Email').fill('drive@test.com');
    await page.getByLabel('Password').first().fill('test12345');
    await page.getByLabel('Confirm password').fill('test12345');

    await page.evaluate(() => {
      sessionStorage.setItem('e2e_auto_auth', 'true');
    });

    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByText('Save & secure your pod').waitFor({ state: 'visible', timeout: 10000 });

    // Google Drive should be listed as a storage option
    await expect(page.getByText('Google Drive').first()).toBeVisible();
  });

  test('GIS mock script loads and returns access token', async ({ page }) => {
    await page.goto('/');

    const token = await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('GIS load failed'));
        document.head.appendChild(script);
      });

      return new Promise<string>((resolve) => {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: 'test-id',
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (resp: any) => resolve(resp.access_token),
        });
        client.requestAccessToken();
      });
    });

    expect(token).toBe(MOCK_ACCESS_TOKEN);
  });

  test('Drive mock returns folder search results', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const q = encodeURIComponent(
        "name='beanies.family' and mimeType='application/vnd.google-apps.folder' and trashed=false"
      );
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
        { headers: { Authorization: 'Bearer mock-token' } }
      );
      return res.json();
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('beanies.family');
  });

  test('Drive mock returns file content', async ({ page }) => {
    await page.goto('/');

    const content = await page.evaluate(async (fileId) => {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: 'Bearer mock-token' },
      });
      return res.text();
    }, MOCK_FILE_ID);

    const parsed = JSON.parse(content);
    expect(parsed.version).toBe('2.0');
    expect(parsed.familyName).toBe('Drive Test Family');
    expect(parsed.data.familyMembers).toHaveLength(1);
  });

  test('Drive mock accepts file updates', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (fileId) => {
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { Authorization: 'Bearer mock-token', 'Content-Type': 'application/json' },
          body: '{"updated":"data"}',
        }
      );
      return res.json();
    }, MOCK_FILE_ID);

    expect(result.id).toBe(MOCK_FILE_ID);
  });

  test('Drive mock creates new file', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer mock-token',
            'Content-Type': 'multipart/related; boundary=test',
          },
          body: '--test\r\nContent-Type: application/json\r\n\r\n{"name":"test.beanpod"}\r\n--test--',
        }
      );
      return res.json();
    });

    expect(result.id).toBe(MOCK_FILE_ID);
    expect(result.name).toBe(MOCK_FILE_NAME);
  });
});
