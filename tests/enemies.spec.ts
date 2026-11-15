import { test, expect } from '@playwright/test';
import { holdKey, openGame, restartGame } from './fixtures.ts';

test('enemies wait, pursue a stationary dragon, stop to attack and follow it again', async ({ page }) => {
  await openGame(page, { enemies: [{ x: 960, y: 300 }, ...Array.from({ length: 5 }, () => ({ x: 1100, y: 600 }))] });
  const enemy = page.locator('.enemy').first();
  const position = () => enemy.evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) }));
  const initial = await position();
  await page.locator('#close-game-help').click();
  await page.clock.runFor(3000);
  expect(await position()).toEqual(initial);
  await page.keyboard.press('ArrowRight');
  await page.clock.runFor(1000);
  const following = await position();
  expect(following.x).toBeLessThan(initial.x);
  expect(Math.hypot(following.x - initial.x, following.y - initial.y)).toBeCloseTo(60, 0);
  await page.clock.runFor(4000);
  await expect(enemy).toHaveClass(/hitting/);
  const stopped = await position();
  await page.clock.runFor(100);
  expect(await position()).toEqual(stopped);
  await holdKey(page, 'ArrowLeft', 500);
  expect((await position()).x).toBeLessThan(stopped.x);
  await expect(enemy).not.toHaveClass(/hitting/);
});

test('death freezes enemies and restarting makes them wait again', async ({ page }) => {
  await openGame(page, { items: [{ x: 1100, y: 600 }], enemies: [{ x: 650, y: 310 }] });
  const positions = () => page.locator('.enemy').evaluateAll(nodes => nodes.map(node => ({ x: node.style.left, y: node.style.top })));
  await holdKey(page, 'ArrowRight', 1600);
  await expect(page.locator('#game-over')).toBeVisible();
  const dead = await positions();
  await page.clock.runFor(3000);
  expect(await positions()).toEqual(dead);
  await restartGame(page, 'click');
  const fresh = await positions();
  await page.clock.runFor(3000);
  expect(await positions()).toEqual(fresh);
});
