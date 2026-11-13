import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { holdKey, openGame, restartGame, touchInput, position } from './fixtures.ts';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
function contextMenuCancelled(locator: Locator) {
  return locator.evaluate(element => !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
}
function controlGeometry(page: Page) {
  return page.locator('#joystick, .touch-fire').evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
}
test('cancels context menus on mobile controls and the playable field', async ({ page }) => {
  await openGame(page);
  expect(await contextMenuCancelled(page.locator('#joystick'))).toBe(true);
  expect(await contextMenuCancelled(page.locator('.touch-fire'))).toBe(true);
  expect(await contextMenuCancelled(page.locator('body'))).toBe(true);
});
test('starting area stays empty when the phone rotates before playing', async ({ page }) => {
  await openGame(page, { items: [{ x: 190, y: 410 }], enemies: [{ x: 160, y: 400 }] });
  const intruders = () => page.evaluate(() => {
    const player = document.querySelector('#player')!.getBoundingClientRect();
    const margin = Math.min(20, Math.min(innerWidth, innerHeight) * 0.05);
    return [...document.querySelectorAll('.item, .enemy')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < player.right + margin && rect.right > player.left - margin &&
        rect.top < player.bottom + margin && rect.bottom > player.top - margin;
    }).map(element => element.className);
  });
  expect(await intruders()).toEqual([]);
  const resized = await page.evaluateHandle(() => {
    const state = { done: false };
    window.addEventListener('resize', () => { state.done = true; }, { once: true });
    return state;
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => resized.evaluate(state => state.done)).toBe(true);
  await resized.dispose();
  expect(await intruders()).toEqual([]);
  await expect(page.locator('#items-scale-text')).toHaveText('0 / 10');
  await expect(page.locator('#player-health-scale-text')).toHaveText('100 / 100');
});
for (const outcome of ['death', 'victory']) {
  test(`keeps mobile controls in place after ${outcome} near the field edge`, async ({ page }) => {
    await openGame(page, {
      items: [outcome === 'victory' ? { x: 360, y: 800 } : { x: 0, y: 30 }],
      enemies: [outcome === 'death' ? { x: 330, y: 770 } : { x: 0, y: 30 }],
    });
    await page.getByRole('button', { name: 'Закрыть подсказку' }).click();
    const before = await controlGeometry(page);
    await holdKey(page, 'ArrowDown', 2000);
    await holdKey(page, 'ArrowRight', 1800);
    await expect(page.locator(outcome === 'death' ? '#game-over' : '#game-won')).toBeVisible();
    expect(await controlGeometry(page)).toEqual(before);
    await restartGame(page, 'tap');
    expect(await controlGeometry(page)).toEqual(before);
    const touch = await touchInput(page);
    const rect = (await page.locator('#joystick').boundingBox())!;
    const origin = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const start = await position(page);
    await touch.down(1, origin);
    await touch.move(1, { x: origin.x + 30, y: origin.y - 10 });
    await page.clock.runFor(100);
    expect((await position(page)).x).toBeGreaterThan(start.x);
    await touch.up(1);
  });
}
