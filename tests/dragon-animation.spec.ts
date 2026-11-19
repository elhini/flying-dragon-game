import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectOfflineReady, holdKey, openGame, position, restartGame } from './fixtures.ts';

async function decodedSprite(page: Page): Promise<string> {
  const sprite = page.locator('.dragon-sprite');
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

test('the dragon animation moves without changing flight bounds or controls', async ({ page }) => {
  const loaded: string[] = [];
  page.on('response', response => loaded.push(response.url()));
  await openGame(page);
  const player = page.locator('#player');
  expect(await decodedSprite(page)).toMatch(/\.webp$/);
  expect(loaded.some(url => /dragon-flight-[\w-]+\.webp$/.test(url))).toBe(true);
  expect(loaded.some(url => url.endsWith('.gif'))).toBe(false);
  const before = await player.boundingBox();
  const first = await player.screenshot();
  await expect.poll(async () => !(await player.screenshot()).equals(first)).toBe(true);
  expect(await player.boundingBox()).toEqual(before);
  const start = await position(page);
  await holdKey(page, 'ArrowRight', 500);
  expect((await position(page)).x - start.x).toBeCloseTo(90, -1);
});

test('death stops the animation offline and it resumes after restart and reload', async ({ page, context }) => {
  await openGame(page, { items: [{ x: 1100, y: 600 }], enemies: [{ x: 650, y: 310 }] });
  await expectOfflineReady(page);
  await context.setOffline(true);
  await holdKey(page, 'ArrowRight', 1600);
  await expect(page.locator('#player')).toHaveClass(/dead/);
  expect(await decodedSprite(page)).toMatch(/\.png$/);
  await restartGame(page, 'click');
  expect(await decodedSprite(page)).toMatch(/\.webp$/);
  await page.reload();
  expect(await decodedSprite(page)).toMatch(/\.webp$/);
});

test('reduced motion shows a still dragon and keeps it controllable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  expect(await decodedSprite(page)).toMatch(/\.png$/);
  const start = await position(page);
  await holdKey(page, 'ArrowRight', 200);
  expect((await position(page)).x).toBeGreaterThan(start.x);
});

test('the GIF stays the base image and the WebP is applied only where image-set() supports types', async ({ page }) => {
  await openGame(page);
  const rules = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find(candidate => candidate.href?.includes('/assets/'))!;
    const sprite = [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.dragon-sprite');
    const supported = [...sheet.cssRules].filter((rule): rule is CSSSupportsRule => rule instanceof CSSSupportsRule && rule.cssText.includes('.dragon-sprite'));
    return {
      base: sprite.map(rule => rule.style.getPropertyValue('background-image')).filter(Boolean),
      supported: supported.flatMap(rule => [...rule.cssRules].map(inner => inner.cssText)),
    };
  });
  expect(rules.base.some(image => /^url\(.*\.gif.*\)$/.test(image))).toBe(true);
  expect(rules.base.some(image => image.includes('.webp'))).toBe(false);
  expect(rules.supported.join('')).toMatch(/image-set\(.*\.webp.*\.gif/s);
});
