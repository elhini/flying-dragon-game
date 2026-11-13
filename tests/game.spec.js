import { test, expect } from '@playwright/test';

async function openGame(page) {
  // Reproduce the same field without exposing game state to the tests.
  await page.addInitScript(() => {
    let seed = 42;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  });
  await page.goto('./');
  await expect(page.locator('.item')).toHaveCount(10);
  await expect(page.locator('.enemy')).toHaveCount(6);
}

async function objectsOutsideViewport(page) {
  return page.locator('#player, .item, .enemy').evaluateAll(elements =>
    elements.flatMap(element => {
      const r = element.getBoundingClientRect();
      return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1
        ? [{ className: element.className, x: r.x, y: r.y, width: r.width, height: r.height }]
        : [];
    })
  );
}

async function resizeGame(page, size) {
  await page.setViewportSize(size);
  // The browser dispatches resize before the next animation frame. Await it
  // before placing fixtures or pressing keys against the resized field.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Space']) {
  test(`hides the initial hint on physical ${key}`, async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#game-help')).toBeVisible();
    await page.keyboard.press(key);
    expect(await page.locator('#game-help').isVisible()).toBe(false);
  });
}

test('keeps the initial hint for unrelated keys and key releases', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('a');
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('#game-help')).toBeVisible();
});

test.describe('touch hint dismissal', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  for (const name of ['Влево', 'Вверх', 'Вправо', 'Вниз', 'Стрелять']) {
    test(`hides the initial hint on virtual ${name}`, async ({ page }) => {
      await openGame(page);
      await expect(page.locator('#game-help')).toBeVisible();
      await page.getByRole('button', { name, exact: true }).tap();
      expect(await page.locator('#game-help').isVisible()).toBe(false);
    });
  }
});

test('loads game assets from the deployment subdirectory and accepts keyboard input', async ({ page }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  await openGame(page);
  const before = await page.locator('#player').boundingBox();
  await page.keyboard.press('ArrowRight');
  await page.locator('#player').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const after = await page.locator('#player').boundingBox();
  expect(after.x).toBe(before.x + 20);
  await page.keyboard.press('Space');
  await expect(page.locator('.fire')).toHaveCount(1);
  await expect(page.locator('.fire')).toHaveCount(0, { timeout: 6000 });
  expect(failures).toEqual([]);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => /\.(js|css|png)(\?|$)/.test(entry.name))
    .map(entry => new URL(entry.name).pathname));
  expect(resources.length).toBeGreaterThan(3);
  expect(resources.every(path => path.startsWith(new URL(page.url()).pathname))).toBe(true);
});

test('keeps the current game and all objects visible after shrinking and growing', async ({ page }) => {
  await openGame(page);
  const ids = await page.locator('.item, .enemy').evaluateAll(elements =>
    elements.map(element => `${element.className}:${element.dataset.id}:${element.dataset.type}`));
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 240, height: 240 }]) {
    await resizeGame(page, size);
    await expect.poll(() => objectsOutsideViewport(page)).toEqual([]);
    expect(await page.locator('.item, .enemy').evaluateAll(elements =>
      elements.map(element => `${element.className}:${element.dataset.id}:${element.dataset.type}`))).toEqual(ids);
    await expect(page.locator('#player-health-scale-text')).toHaveText('100 / 100');
  }
});

test('keeps a diagonally rotated player visible in a short window', async ({ page }) => {
  await openGame(page);
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowUp');
  await resizeGame(page, { width: 640, height: 180 });
  await expect.poll(() => objectsOutsideViewport(page)).toEqual([]);
});

test('movement stays inside the new right edge after resize', async ({ page }) => {
  await openGame(page);
  await page.locator('.enemy').evaluateAll(elements => elements.forEach(element => element.remove()));
  await resizeGame(page, { width: 390, height: 844 });
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  const player = await page.locator('#player').boundingBox();
  expect(player.x).toBeGreaterThanOrEqual(0);
  expect(player.x + player.width).toBeGreaterThan(370);
  expect(player.x + player.width).toBeLessThanOrEqual(391);
});

test('can still collect a gem at the left edge after resize', async ({ page }) => {
  await openGame(page);
  await resizeGame(page, { width: 640, height: 480 });
  // Isolate an edge collectible; collisions still use real keyboard input.
  await page.evaluate(() => {
    document.querySelectorAll('.enemy').forEach(element => element.remove());
    const player = document.querySelector('#player');
    Object.assign(player.style, { left: '200px', top: '100px' });
    document.querySelectorAll('.item').forEach((element, i) => {
      Object.assign(element.style, { left: i === 0 ? '0px' : '600px', top: i === 0 ? '150px' : '420px' });
    });
  });
  await page.keyboard.press('ArrowLeft');
  await page.locator('#player').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.item[data-id="1"]')).toHaveCount(0);
  await expect(page.locator('#items-scale-text')).toHaveText('1 / 10');
});

test('detects enemy damage at current positions after resize', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('ArrowLeft');
  await resizeGame(page, { width: 640, height: 480 });
  await page.evaluate(() => {
    Object.assign(document.querySelector('#player').style, { left: '100px', top: '100px', transform: 'rotate(0deg)' });
    document.querySelectorAll('.item').forEach(element => Object.assign(element.style, { left: '600px', top: '420px' }));
    document.querySelectorAll('.enemy').forEach((element, i) => {
      Object.assign(element.style, { left: i === 0 ? '310px' : '500px', top: i === 0 ? '150px' : '350px' });
    });
  });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#player-health-scale-text')).toHaveText('95 / 100');
});

test('a fireball destroys an enemy at its current position after resize', async ({ page }) => {
  await openGame(page);
  await resizeGame(page, { width: 640, height: 480 });
  await page.evaluate(() => {
    Object.assign(document.querySelector('#player').style, { left: '100px', top: '150px' });
    document.querySelectorAll('.enemy').forEach((element, i) => {
      Object.assign(element.style, { left: i === 0 ? '165px' : '500px', top: i === 0 ? '50px' : '350px' });
    });
  });
  await page.keyboard.press('Space');
  await expect(page.locator('.enemy')).toHaveCount(5);
});

for (const closeHelp of [false, true]) {
  test(`shows the victory message with the initial hint ${closeHelp ? 'closed' : 'open'}`, async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#game-won')).toBeHidden();
    if (closeHelp) await page.getByRole('button', { name: 'Закрыть подсказку' }).click();
    await page.evaluate(() => {
      Object.assign(document.querySelector('#player').style, { left: '100px', top: '100px' });
      document.querySelectorAll('.item').forEach(element =>
        Object.assign(element.style, { left: '310px', top: '150px' }));
      document.querySelectorAll('.enemy').forEach(element =>
        Object.assign(element.style, { left: '1100px', top: '600px' }));
    });
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#items-scale-text')).toHaveText('10 / 10');
    await expect(page.locator('#game-won')).toBeVisible();
    await expect(page.locator('#game-won')).toHaveText('Ты победил, поздравляю! Обнови страницу, чтобы начать заново');
    await expect(page.locator('#game-help')).toBeHidden();
    await expect(page.locator('#game-over')).toBeHidden();
    const position = await page.locator('#player').evaluate(element => ({ left: element.style.left, top: element.style.top }));
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    expect(await page.locator('#player').evaluate(element => ({ left: element.style.left, top: element.style.top }))).toEqual(position);
    await expect(page.locator('.fire')).toHaveCount(0);
  });

  test(`shows the death message with the initial hint ${closeHelp ? 'closed' : 'open'}`, async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#game-over')).toBeHidden();
    if (closeHelp) {
      // Closing the focused button with Space must not also fire a projectile.
      await page.getByRole('button', { name: 'Закрыть подсказку' }).focus();
      await page.keyboard.press('Space');
      await expect(page.locator('#game-help')).toBeHidden();
      await expect(page.locator('.fire')).toHaveCount(0);
    }
    // Four moves through six overlapping enemies exhaust the real health counter.
    await page.evaluate(() => {
      Object.assign(document.querySelector('#player').style, { left: '100px', top: '100px' });
      document.querySelectorAll('.item').forEach(element =>
        Object.assign(element.style, { left: '1000px', top: '600px' }));
      document.querySelectorAll('.enemy').forEach(element =>
        Object.assign(element.style, { left: '250px', top: '150px' }));
    });
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('#player-health-scale-text')).toHaveText('0 / 100');
    await expect(page.locator('#game-over')).toBeVisible();
    await expect(page.locator('#game-over')).toHaveText('Твой дракон погиб. Обнови страницу, чтобы начать заново');
    await expect(page.locator('#game-help')).toBeHidden();
  });
}
