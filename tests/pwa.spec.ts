import { test, expect } from '@playwright/test';
import { expectFreshGame, holdKey, openGame, position, restartGame } from './fixtures.ts';

test('installation metadata and icons resolve within the game directory', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveCount(1);
  const manifestURL = await link.evaluate((element: HTMLLinkElement) => element.href);
  const response = await page.request.get(manifestURL);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  const directory = new URL('./', page.url()).href;
  expect(manifest.name).toBe('Flying Dragon');
  expect(manifest.display).toBe('standalone');
  for (const key of ['start_url', 'scope']) expect(new URL(manifest[key], manifestURL).href).toBe(directory);
  const cdp = await page.context().newCDPSession(page);
  const processed = await cdp.send('Page.getAppManifest');
  expect(processed.errors).toEqual([]);
  expect(processed.manifest.id).toBe(new URL('/flying-dragon-game/', page.url()).href);
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  ]));
  const icons = manifest.icons as { src: string; sizes: string }[];
  for (const icon of icons) {
    const url = new URL(icon.src, manifestURL).href;
    expect(url.startsWith(directory)).toBe(true);
    const size = await page.evaluate(async url => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, url);
    expect(size).toBe(icon.sizes);
  }
  const apple = page.locator('link[rel="apple-touch-icon"]');
  await expect(apple).toHaveCount(1);
  expect((await page.request.get((await apple.getAttribute('href'))!)).ok()).toBe(true);
});

test('offline reload and a new launch retain images, flight, fire and restart', async ({ page, context }) => {
  await openGame(page, { items: [{ x: 900, y: 310 }] });
  await expect(page.locator('#offline-status')).toBeVisible();
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL('./', page.url()).href);
  await context.setOffline(true);
  await page.reload();
  await expectFreshGame(page);
  await expect(page.locator('#offline-status')).toBeVisible();
  const images = await page.locator('#player, .item, .enemy').evaluateAll(async elements => {
    const urls = [...new Set(elements.map(element => getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1]))];
    return Promise.all(urls.map(async url => {
      const image = new Image();
      image.src = url!;
      await image.decode();
      return image.naturalWidth > 0;
    }));
  });
  expect(images).toHaveLength(7);
  expect(images.every(Boolean)).toBe(true);
  const before = await position(page);
  await holdKey(page, 'ArrowRight', 150);
  expect((await position(page)).x).toBeGreaterThan(before.x);
  await page.keyboard.press('Space');
  await expect(page.locator('.fire')).toHaveCount(1);
  await holdKey(page, 'ArrowRight', 2000);
  await expect(page.locator('#game-won')).toBeVisible();
  await restartGame(page, 'click');
  const url = page.url();
  await page.close();
  const launched = await context.newPage();
  await launched.goto(url);
  await expectFreshGame(launched);
  await expect(launched.locator('#offline-status')).toBeVisible();
});
