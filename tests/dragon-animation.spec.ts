import { test, expect } from '@playwright/test';
import { holdKey, openGame, position, restartGame } from './fixtures.ts';

test('wings and tail move independently without changing the body or flight bounds', async ({ page }) => {
  await openGame(page);
  const player = page.locator('#player');
  const before = await player.boundingBox();
  for (const selector of ['.dragon-wing-left', '.dragon-wing-right', '.dragon-tail']) {
    const part = player.locator(selector);
    await expect(part).toBeVisible();
    const poses = await part.evaluate(node => {
      const animation = node.getAnimations()[0]!;
      animation.pause();
      const duration = Number(animation.effect!.getComputedTiming().duration);
      const sample = (fraction: number) => {
        animation.currentTime = duration * fraction;
        return getComputedStyle(node).transform;
      };
      return [sample(0), sample(0.5)];
    });
    expect(poses[0]).not.toBe(poses[1]);
  }
  expect(await player.boundingBox()).toEqual(before);
  expect(await player.locator('.dragon-body').evaluate(node => getComputedStyle(node).transform)).toBe('none');
  const start = await position(page);
  await holdKey(page, 'ArrowRight', 500);
  expect((await position(page)).x - start.x).toBeCloseTo(90, -1);
});

test('death stops the wings and tail and restarting resumes them', async ({ page }) => {
  await openGame(page, { items: [{ x: 1100, y: 600 }], enemies: [{ x: 650, y: 310 }] });
  const animated = page.locator('.dragon-wing-left, .dragon-wing-right, .dragon-tail');
  const states = () => animated.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationPlayState));
  expect(await states()).toEqual(['running', 'running', 'running']);
  await holdKey(page, 'ArrowRight', 1600);
  await expect(page.locator('#player')).toHaveClass(/dead/);
  expect(await states()).toEqual(['paused', 'paused', 'paused']);
  await restartGame(page, 'click');
  expect(await states()).toEqual(['running', 'running', 'running']);
});

test('reduced motion keeps the whole dragon visible and controllable without decorative animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  const parts = page.locator('.dragon-part');
  await expect(parts).toHaveCount(4);
  expect(await parts.evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).length)).toBe(0);
  for (const part of await parts.all()) await expect(part).toBeVisible();
  const start = await position(page);
  await holdKey(page, 'ArrowRight', 200);
  expect((await position(page)).x).toBeGreaterThan(start.x);
});
