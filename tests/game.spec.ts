import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { holdKey, openGame, position, restartGame } from './fixtures.ts';

async function objectsOutsideViewport(page: Page) {
  return page.locator('#player, .item, .enemy').evaluateAll(elements => elements.flatMap(element => {
    const r = element.getBoundingClientRect();
    return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
      ? [{ className: element.className, x: r.x, y: r.y, width: r.width, height: r.height }] : [];
  }));
}
async function resizeGame(page: Page, size: { width: number; height: number }) {
  const event = await page.evaluateHandle(() => {
    const state = { resized: false };
    window.addEventListener('resize', () => { state.resized = true; }, { once: true });
    return state;
  });
  await page.setViewportSize(size);
  await expect.poll(() => event.evaluate(state => state.resized)).toBe(true);
  await event.dispose();
  await page.clock.runFor(32);
}
for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Space']) {
  test(`hides the initial hint on physical ${key}`, async ({ page }) => {
    await openGame(page);
    await page.keyboard.press(key);
    await expect(page.locator('#game-help')).toBeHidden();
  });
}
test('keeps the initial hint for unrelated keys and key releases', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('a');
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('#game-help')).toBeVisible();
});
test('leaves the idle field untouched between inputs', async ({ page }) => {
  await openGame(page);
  const observation = await page.evaluateHandle(() => {
    const state = { count: 0 };
    const observer = new MutationObserver(records => { state.count += records.length; });
    observer.observe(document.querySelector('#field')!, { subtree: true, attributes: true, childList: true });
    observer.observe(document.querySelector('#player')!, { attributes: true });
    return { finish: () => { observer.disconnect(); return state.count; } };
  });
  await page.clock.runFor(120);
  expect(await observation.evaluate(value => value.finish())).toBe(0);
  await observation.dispose();
});
test('loads all game assets from a subdirectory and supports held keyboard input', async ({ page }) => {
  const failures: string[] = [];
  const resources = new Set<string>();
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failures.push(`${response.status()} ${response.url()}`);
    const path = new URL(response.url()).pathname;
    if (/\.(js|css|png)$/.test(path)) resources.add(path);
  });
  await openGame(page);
  const before = await position(page);
  await holdKey(page, 'ArrowRight', 500);
  expect((await position(page)).x - before.x).toBeCloseTo(90, -1);
  const stopped = await position(page);
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(stopped);
  await page.keyboard.press('Space');
  await expect(page.locator('.fire')).toHaveCount(1);
  await page.clock.runFor(6000);
  await expect(page.locator('.fire')).toHaveCount(0);
  expect(failures).toEqual([]);
  await expect.poll(() => [...resources].filter(path => path.endsWith('.png')).length).toBe(7);
  expect([...resources].every(path => path.startsWith(new URL(page.url()).pathname))).toBe(true);
});
test('keeps the current game and all objects visible after shrinking and growing', async ({ page }) => {
  await openGame(page);
  const ids = await page.locator('.item, .enemy').evaluateAll(elements => elements.map(element => `${element.className}:${element.dataset.id}:${element.dataset.type}`));
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 240, height: 240 }]) {
    await resizeGame(page, size);
    expect(await objectsOutsideViewport(page)).toEqual([]);
    expect(await page.locator('.item, .enemy').evaluateAll(elements => elements.map(element => `${element.className}:${element.dataset.id}:${element.dataset.type}`))).toEqual(ids);
    await expect(page.locator('#player-health-scale-text')).toHaveText('100 / 100');
  }
});
test('keeps an arbitrarily rotated player visible in a short window', async ({ page }) => {
  await openGame(page);
  await page.mouse.move(950, 200);
  await page.mouse.down();
  await page.clock.runFor(200);
  await page.mouse.up();
  await resizeGame(page, { width: 640, height: 180 });
  expect(await objectsOutsideViewport(page)).toEqual([]);
});
test('movement stays inside the new right edge after resize', async ({ page }) => {
  await openGame(page);
  await resizeGame(page, { width: 390, height: 844 });
  await holdKey(page, 'ArrowRight', 2000);
  const player = (await page.locator('#player').boundingBox())!;
  expect(player.x).toBeGreaterThanOrEqual(0);
  expect(player.x + player.width).toBeGreaterThan(370);
  expect(player.x + player.width).toBeLessThanOrEqual(391);
});
test('can still collect a gem at the left edge after resize', async ({ page }) => {
  await openGame(page, { items: [{ x: 0, y: 300 }, ...Array.from({ length: 9 }, () => ({ x: 1200, y: 630 }))], enemies: [{ x: 1100, y: 600 }] });
  await resizeGame(page, { width: 640, height: 480 });
  await holdKey(page, 'ArrowLeft', 2000);
  await expect(page.locator('.item[data-id="1"]')).toHaveCount(0);
  await expect(page.locator('#items-scale-text')).toHaveText('1 / 10');
});
test('detects enemy damage at current positions after resize', async ({ page }) => {
  await openGame(page, { items: [{ x: 1100, y: 630 }], enemies: [{ x: 960, y: 300 }, ...Array.from({ length: 5 }, () => ({ x: 1100, y: 600 }))] });
  await resizeGame(page, { width: 640, height: 480 });
  await holdKey(page, 'ArrowRight', 300);
  await expect(page.locator('#player-health-scale-text')).toHaveText('100 / 100');
  await holdKey(page, 'ArrowRight', 100);
  await expect(page.locator('#player-health-scale-text')).toHaveText('95 / 100');
});
test('a fireball destroys an enemy at its current position after resize', async ({ page }) => {
  await openGame(page, { items: [{ x: 1100, y: 630 }], enemies: [{ x: 690, y: 150 }, ...Array.from({ length: 5 }, () => ({ x: 1100, y: 600 }))] });
  await resizeGame(page, { width: 640, height: 480 });
  await page.keyboard.press('Space');
  await page.clock.runFor(400);
  await expect(page.locator('.enemy')).toHaveCount(5);
});
for (const closeHelp of [false, true]) {
  test(`shows the victory message with the initial hint ${closeHelp ? 'closed' : 'open'}`, async ({ page }) => {
    await openGame(page, { items: [{ x: 750, y: 310 }], enemies: [{ x: 1100, y: 600 }] });
    if (closeHelp) await page.getByRole('button', { name: 'Закрыть подсказку' }).click();
    await holdKey(page, 'ArrowRight', 100);
    await expect(page.locator('#items-scale-text')).toHaveText('10 / 10');
    await expect(page.locator('#game-won')).toHaveText('Ты победил, поздравляю! Чтобы начать заново, обнови страницу или нажми кнопку Ещё раз');
    await expect(page.locator('#game-help')).toBeHidden();
    await expect(page.locator('#game-over')).toBeHidden();
    const stopped = await position(page);
    await holdKey(page, 'ArrowLeft', 300);
    await page.keyboard.press('Space');
    expect(await position(page)).toEqual(stopped);
    await expect(page.locator('.fire')).toHaveCount(0);
    await restartGame(page, closeHelp ? 'Enter' : 'click');
  });
  test(`shows the death message with the initial hint ${closeHelp ? 'closed' : 'open'}`, async ({ page }) => {
    await openGame(page, { items: [{ x: 1100, y: 600 }], enemies: [{ x: 650, y: 310 }] });
    if (closeHelp) {
      await page.getByRole('button', { name: 'Закрыть подсказку' }).focus();
      await page.keyboard.press('Space');
      await expect(page.locator('#game-help')).toBeHidden();
      await expect(page.locator('.fire')).toHaveCount(0);
    }
    await holdKey(page, 'ArrowRight', 1600);
    await expect(page.locator('#player-health-scale-text')).toHaveText('0 / 100');
    await expect(page.locator('#game-over')).toHaveText('Твой дракон погиб. Чтобы начать заново, обнови страницу или нажми кнопку Ещё раз');
    await expect(page.locator('#game-help')).toBeHidden();
    await restartGame(page, closeHelp ? 'Space' : 'click');
  });
}
test('repeated restarts keep one input handler and a playable fresh game', async ({ page }) => {
  await openGame(page, { items: [{ x: 750, y: 310 }], enemies: [{ x: 1100, y: 600 }] });
  for (let round = 0; round < 3; round++) {
    await holdKey(page, 'ArrowRight', 100);
    await expect(page.locator('#game-won')).toBeVisible();
    await restartGame(page, 'Enter');
  }
  const before = await position(page);
  await holdKey(page, 'ArrowUp', 100);
  expect(before.y - (await position(page)).y).toBeCloseTo(18, -1);
  await page.keyboard.press('Space');
  await expect(page.locator('.fire')).toHaveCount(1);
});
