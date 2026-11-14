import { test as base, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { releaseServer } from './pwa-server.ts';
import { expectFreshGame, position } from './fixtures.ts';

let directory: string;
const test = base.extend<{ releases: Awaited<ReturnType<typeof releaseServer>> }>({
  releases: async ({}, use) => {
    const server = await releaseServer({ first: join(directory, 'first'), second: join(directory, 'second') });
    try { await use(server); } finally { await server.close(); }
  },
});
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dragon-pwa-releases-'));
  for (const version of ['first', 'second']) {
    await build({
      root: fileURLToPath(new URL('..', import.meta.url)),
      base: './',
      logLevel: 'silent',
      build: { outDir: join(directory, version), emptyOutDir: true },
      plugins: [{ name: 'test-release-title', transformIndexHtml: html => html.replace('<title>Flying Dragon</title>', `<title>Dragon ${version}</title>`) }],
    });
  }
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test('a waiting update preserves games in every window and activates after they close', async ({ page, context, releases }) => {
  await page.goto(releases.url);
  await expect(page.locator('#offline-status')).toBeVisible();
  const neighborCache = `flying-dragon-game:${releases.origin}/neighbor/:v1`;
  await page.evaluate(async name => {
    await (await caches.open(name)).put('/neighbor/data', new Response('neighbor data'));
  }, neighborCache);
  const neighbor = await context.newPage();
  await neighbor.goto(`${releases.origin}/neighbor/`);
  expect(await neighbor.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await page.keyboard.down('ArrowRight');
  const start = await position(page);
  await expect.poll(async () => (await position(page)).x).toBeGreaterThan(start.x);
  await page.keyboard.up('ArrowRight');
  const stopped = await position(page);
  const originalDocument = await page.evaluateHandle(() => document);
  const secondWindow = await context.newPage();
  await secondWindow.goto(releases.url);
  await expect(secondWindow.locator('#offline-status')).toBeVisible();
  releases.publish();
  const workerStarted = context.waitForEvent('serviceworker');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  const newWorker = await workerStarted;
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeVisible();
  expect(await originalDocument.evaluate(original => original === document)).toBe(true);
  await originalDocument.dispose();
  expect(await position(page)).toEqual(stopped);
  await expect(page).toHaveTitle('Dragon first');
  await context.setOffline(true);
  await page.reload();
  await expectFreshGame(page);
  await expect(page).toHaveTitle('Dragon first');
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeVisible();
  const activated = await newWorker.evaluateHandle(() => {
    const state = { done: false };
    globalThis.addEventListener('activate', () => { state.done = true; }, { once: true });
    return state;
  });
  await page.close();
  await expect.poll(() => secondWindow.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  await secondWindow.close();
  await expect.poll(() => activated.evaluate(state => state.done)).toBe(true);
  await activated.dispose();
  const launched = await context.newPage();
  await launched.goto(releases.url);
  await expectFreshGame(launched);
  await expect(launched).toHaveTitle('Dragon second');
  expect(await launched.evaluate(async name => (await (await caches.open(name)).match('/neighbor/data'))?.text(), neighborCache)).toBe('neighbor data');
});

for (const touch of [false, true]) {
  test.describe(touch ? 'touch update' : 'desktop update', () => {
    test.use({ hasTouch: touch, viewport: touch ? { width: 420, height: 740 } : { width: 1280, height: 720 } });
    test('the update button applies a downloaded release offline without reloading other games', async ({ page, context, releases }) => {
      await page.goto(releases.url);
      await expect(page.locator('#offline-status')).toBeVisible();
      const update = page.getByRole('button', { name: 'Обновить', exact: true });
      await expect(update).toBeHidden();
      const otherGame = await context.newPage();
      await otherGame.goto(releases.url);
      await expect(otherGame.locator('#offline-status')).toBeVisible();
      await page.bringToFront();
      if (touch) await context.setOffline(true);
      releases.publish();
      if (touch) await context.setOffline(false);
      else await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
      await expect(update).toBeVisible();
      await page.locator('#close-game-help').click();
      await expect(update).toBeVisible();
      await expect(page).toHaveTitle('Dragon first');
      await context.setOffline(true);
      let navigations = 0;
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      if (touch) await update.tap(); else await update.click();
      await expect(page).toHaveTitle('Dragon second');
      await expectFreshGame(page);
      await expect(page.locator('#offline-status')).toBeVisible();
      await expect(update).toBeHidden();
      expect(navigations).toBe(1);
      await expect(otherGame).toHaveTitle('Dragon first');
      await expect(otherGame.getByRole('button', { name: 'Обновить', exact: true })).toBeHidden();
      await page.reload();
      await expect(page).toHaveTitle('Dragon second');
      await expectFreshGame(page);
    });
  });
}

test('a failed update leaves the previous version available for offline launch', async ({ page, context, releases }) => {
  await page.goto(releases.url);
  await expect(page.locator('#offline-status')).toBeVisible();
  releases.publish();
  releases.fail('index.html');
  const observed = await page.evaluateHandle(async () => {
    const state = { failed: false };
    const registration = (await navigator.serviceWorker.getRegistration())!;
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing!;
      worker.addEventListener('statechange', () => { if (worker.state === 'redundant') state.failed = true; });
    });
    await registration.update();
    return state;
  });
  await expect.poll(() => observed.evaluate(state => state.failed)).toBe(true);
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeHidden();
  await observed.dispose();
  await context.setOffline(true);
  await page.close();
  const launched = await context.newPage();
  await launched.goto(releases.url);
  await expectFreshGame(launched);
  await expect(launched).toHaveTitle('Dragon first');
  await expect(launched.locator('#offline-status')).toBeVisible();
});

test('a partially published release cannot cache old HTML as the new version', async ({ page, context, releases }) => {
  await page.goto(releases.url);
  await expect(page.locator('#offline-status')).toBeVisible();
  releases.publish();
  releases.pin('index.html', 'first');
  const observed = await page.evaluateHandle(async () => {
    const state = { failed: false };
    const registration = (await navigator.serviceWorker.getRegistration())!;
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing!;
      worker.addEventListener('statechange', () => { if (worker.state === 'redundant') state.failed = true; });
    });
    await registration.update();
    return state;
  });
  await expect.poll(() => observed.evaluate(state => state.failed)).toBe(true);
  await observed.dispose();
  releases.pin('index.html', null);
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  await context.setOffline(true);
  await page.close();
  const launched = await context.newPage();
  await launched.goto(releases.url);
  await expectFreshGame(launched);
  await expect(launched).toHaveTitle('Dragon second');
});

test('a parent site worker cannot report offline readiness for an incomplete game', async ({ page, releases }) => {
  await page.goto(`${releases.origin}/neighbor/`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/parent-sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${releases.origin}/parent-sw.js`);
  releases.fail('pwa-maskable-512.png');
  await page.goto(releases.url);
  await expectFreshGame(page);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${releases.origin}/parent-sw.js`);
  await expect(page.locator('#offline-status')).toBeHidden();
  releases.fail(null);
  await page.reload();
  await expect(page.locator('#offline-status')).toBeVisible();
});

test('a first installation rejects new HTML served with an old worker', async ({ page, releases }) => {
  releases.publish();
  releases.pin('sw.js', 'first');
  await page.goto(releases.url);
  await expectFreshGame(page);
  await expect(page).toHaveTitle('Dragon second');
  const result = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register(new URL('sw.js', location.href));
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) return 'missing';
    if (worker.state === 'activated' || worker.state === 'redundant') return worker.state;
    return new Promise<string>(resolve => worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') resolve(worker.state);
    }));
  });
  expect(result).toBe('redundant');
  await expect(page.locator('#offline-status')).toBeHidden();
  releases.pin('sw.js', null);
  await page.reload();
  await expect(page.locator('#offline-status')).toBeVisible();
});

test('a failed first installation leaves no partial game cache and can retry', async ({ page, context, releases }) => {
  releases.fail('pwa-maskable-512.png');
  await page.goto(releases.url);
  await expectFreshGame(page);
  const result = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register(new URL('sw.js', location.href));
    const worker = registration.installing || registration.active;
    if (!worker) return 'missing';
    if (worker.state === 'activated' || worker.state === 'redundant') return worker.state;
    return new Promise<string>(resolve => worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') resolve(worker.state);
    }));
  });
  expect(result).toBe('redundant');
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await expect(page.locator('#offline-status')).toBeHidden();
  releases.fail(null);
  await page.reload();
  await expect(page.locator('#offline-status')).toBeVisible();
  await context.setOffline(true);
  await page.goto(`${releases.url}index.html?from=home`);
  await expectFreshGame(page);
});

test('the worker leaves POST requests and uncached URLs to the server', async ({ page, releases }) => {
  await page.goto(releases.url);
  await expect(page.locator('#offline-status')).toBeVisible();
  releases.publish();
  const result = await page.evaluate(async () => {
    const post = await fetch('index.html', { method: 'POST', body: 'test' });
    const query = await fetch('favicon.png?probe=1');
    const neighbor = await fetch('/neighbor/data');
    return {
      method: post.headers.get('X-Test-Method'),
      queryVersion: query.headers.get('X-Test-Version'),
      neighborVersion: neighbor.headers.get('X-Test-Version'),
    };
  });
  expect(result).toEqual({ method: 'POST', queryVersion: 'second', neighborVersion: 'second' });
});
