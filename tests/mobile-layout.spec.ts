import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openGame, restartGame } from './fixtures.ts';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

function contextMenuCancelled(locator: Locator) {
  return locator.evaluate(element => !element.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  ));
}

function controlGeometry(page: Page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    buttons: [...document.querySelectorAll('#touch-controls button')].map(button => {
      const r = button.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  }));
}

test('cancels control context menus without disabling them on the rest of the page', async ({ page }) => {
  await openGame(page);
  for (const button of await page.locator('#touch-controls button').all()) {
    expect(await contextMenuCancelled(button)).toBe(true);
  }
  expect(await contextMenuCancelled(page.locator('body'))).toBe(false);
});

for (const outcome of ['death', 'victory']) {
  test(`keeps mobile controls in place after ${outcome} near the field edge`, async ({ page }) => {
    await openGame(page, {
      items: [outcome === 'victory' ? { x: 360, y: 800 } : { x: 0, y: 30 }],
      enemies: [outcome === 'death' ? { x: 330, y: 770 } : { x: 0, y: 30 }],
    });
    await page.getByRole('button', { name: 'Закрыть подсказку' }).click();
    const before = await controlGeometry(page);
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator(outcome === 'death' ? '#game-over' : '#game-won')).toBeVisible();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await controlGeometry(page)).toEqual(before);
    expect(await contextMenuCancelled(page.getByRole('button', { name: 'Стрелять', exact: true }))).toBe(true);
    await restartGame(page, 'tap');
  });
}
