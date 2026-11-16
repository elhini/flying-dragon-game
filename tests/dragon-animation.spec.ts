import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { holdKey, openGame, position, restartGame } from './fixtures.ts';

async function decodedSprite(page: Page): Promise<string> {
  const sprite = page.locator('.dragon-sprite, .dragon-part').first();
  await expect(sprite).toBeVisible();
  return sprite.evaluate(async node => {
    const url = getComputedStyle(node).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1];
    if (!url) throw new Error('Dragon image is missing');
    const image = new Image();
    image.src = url;
    await image.decode();
    return url;
  });
}

for (const animation of ['css', 'gif'] as const) {
  test.describe(`animation=${animation}`, () => {
    const selector = animation === 'css' ? '.dragon-part' : '.dragon-sprite';

    test('the chosen animation moves without changing flight bounds or controls', async ({ page }) => {
      await openGame(page, { animation });
      const player = page.locator('#player');
      await expect(page.locator(selector).first()).toBeVisible();
      expect(await decodedSprite(page)).toMatch(animation === 'css' ? /\.png$/ : /\.gif$/);
      const before = await player.boundingBox();
      if (animation === 'css') {
        for (const part of ['.dragon-wing-left', '.dragon-wing-right', '.dragon-tail']) {
          const poses = await player.locator(part).evaluate(node => {
            const motion = node.getAnimations()[0]!;
            motion.pause();
            motion.currentTime = 0;
            const first = getComputedStyle(node).transform;
            motion.currentTime = Number(motion.effect!.getComputedTiming().duration) / 2;
            return [first, getComputedStyle(node).transform];
          });
          expect(poses[0]).not.toBe(poses[1]);
        }
      } else {
        const first = await player.screenshot();
        await expect.poll(async () => !(await player.screenshot()).equals(first)).toBe(true);
      }
      expect(await player.boundingBox()).toEqual(before);
      const start = await position(page);
      await holdKey(page, 'ArrowRight', 500);
      expect((await position(page)).x - start.x).toBeCloseTo(90, -1);
    });

    test('death stops animation offline and the selected mode survives restart and reload', async ({ page, context }) => {
      await openGame(page, { animation, items: [{ x: 1100, y: 600 }], enemies: [{ x: 650, y: 310 }] });
      await expect(page.locator('#offline-status')).toBeVisible();
      await context.setOffline(true);
      await holdKey(page, 'ArrowRight', 1600);
      await expect(page.locator('#player')).toHaveClass(/dead/);
      expect(await decodedSprite(page)).toMatch(/\.png$/);
      if (animation === 'css') {
        expect(await page.locator('.dragon-wing-left, .dragon-wing-right, .dragon-tail').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationPlayState))).toEqual(['paused', 'paused', 'paused']);
      }
      await restartGame(page, 'click');
      await expect(page.locator(selector).first()).toBeVisible();
      expect(await decodedSprite(page)).toMatch(animation === 'css' ? /\.png$/ : /\.gif$/);
      if (animation === 'css') {
        expect(await page.locator('.dragon-wing-left').evaluate(node => getComputedStyle(node).animationPlayState)).toBe('running');
      }
      await page.reload();
      await expect(page.locator(selector).first()).toBeVisible();
      expect(await decodedSprite(page)).toMatch(animation === 'css' ? /\.png$/ : /\.gif$/);
    });

    test('reduced motion disables animation and keeps the dragon controllable', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openGame(page, { animation });
      expect(await decodedSprite(page)).toMatch(/\.png$/);
      expect(await page.locator(selector).evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).length)).toBe(0);
      const start = await position(page);
      await holdKey(page, 'ArrowRight', 200);
      expect((await position(page)).x).toBeGreaterThan(start.x);
    });
  });
}

for (const animation of [undefined, 'unknown']) {
  test(`GIF is the default for ${animation === undefined ? 'a missing' : 'an unknown'} animation parameter`, async ({ page }) => {
    await openGame(page, { animation });
    expect(await decodedSprite(page)).toMatch(/\.gif$/);
    await expect(page.locator('.dragon-part')).toHaveCount(0);
  });
}
