import type { Page } from '@playwright/test';

export function attachFailFast(page: Page) {
  page.on('pageerror', (error) => {
    throw new Error(`[pageerror] ${error.message}`);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (
        text.includes('Failed to load resource') &&
        (text.includes('400 (Bad Request)') ||
          text.includes('401 (Unauthorized)') ||
          text.includes('403 (Forbidden)') ||
          text.includes('404 (Not Found)') ||
          text.includes('409 (Conflict)') ||
          text.includes('net::ERR_CONNECTION_REFUSED') ||
          text.includes('net::ERR_FILE_NOT_FOUND'))
      ) {
        return;
      }
      const location = message.location();
      const source = location?.url ? ` @ ${location.url}` : '';
      throw new Error(`[console.error] ${message.text()}${source}`);
    }
  });
}
