import { test, expect } from '@playwright/test';
import { openGame, holdKey, restartGame } from './fixtures.ts';

for (const [random, terrain] of [[0, 'grass'], [0.5, 'earth'], [0.999, 'stone']] as const) {
  test(`${terrain} repeats across the field and remains available offline after restart`, async ({ page, context }) => {
    await openGame(page, { terrain: random, items: [{ x: 900, y: 310 }] });
    const field = page.locator('#field');
    await expect(field).toHaveAttribute('data-terrain', terrain);
    await expect(page.locator('#offline-status')).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    const imageSize = await field.evaluate(async node => {
      const style = getComputedStyle(node);
      const url = style.backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1];
      if (!url) throw new Error('Terrain texture is missing');
      const image = new Image();
      image.src = url;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight, repeat: style.backgroundRepeat };
    });
    expect(imageSize.width).toBeGreaterThan(0);
    expect(imageSize.height).toBe(imageSize.width);
    expect(imageSize.repeat.split(',').every(value => value.trim() === 'repeat')).toBe(true);
    const viewport = page.viewportSize()!;
    expect(await field.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    await holdKey(page, 'ArrowRight', 2000);
    await expect(page.locator('#game-won')).toBeVisible();
    await expect(field).toHaveAttribute('data-terrain', terrain);
    await restartGame(page, 'click');
    await expect(field).toHaveAttribute('data-terrain', terrain);
  });
}

test('starting another game chooses a new terrain without reloading the page', async ({ page }) => {
  await openGame(page, { terrain: 0, items: [{ x: 900, y: 310 }] });
  await expect(page.locator('#field')).toHaveAttribute('data-terrain', 'grass');
  await holdKey(page, 'ArrowRight', 2000);
  await expect(page.locator('#game-won')).toBeVisible();
  await page.evaluate(() => { Math.random = () => 0.999; });
  await restartGame(page, 'click');
  await expect(page.locator('#field')).toHaveAttribute('data-terrain', 'stone');
});
