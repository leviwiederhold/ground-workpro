import type { Page } from '@playwright/test';

export function attachFailFast(page: Page) {
  page.on('pageerror', (error) => {
    throw new Error(`[pageerror] ${error.message}`);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      throw new Error(`[console.error] ${message.text()}`);
    }
  });
}
