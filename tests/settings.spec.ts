import { test, expect } from '@playwright/test';
import { expectOfflineReady, holdKey, openGame, position, restartGame, touchInput } from './fixtures.ts';
import type { Page } from '@playwright/test';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Настройки игры' });
const values = (page: Page) => page.locator('#game-settings input[type="range"]').evaluateAll(inputs => inputs.map(input => Number((input as HTMLInputElement).value)));

test('settings are shown before play and slider keys cannot move the dragon', async ({ page }) => {
  await page.goto('./');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Собери все 10 кристаллов и избегай врагов.');
  await expect(dialog(page)).not.toContainText('Выбери, как будем играть');
  await expect(dialog(page)).not.toContainText('Нулевой удар');
  await expect(dialog(page)).not.toContainText('Можно играть без интернета.');
  await expect(page.locator('#game-help')).toHaveCount(0);
  expect(await values(page)).toEqual([6, 60, 5]);
  const before = await position(page);
  const count = page.getByRole('slider', { name: 'Количество врагов' });
  await count.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(count).toHaveValue('5');
  expect(await position(page)).toEqual(before);
  await expect(page.locator('.fire')).toHaveCount(0);
});

test('presets set all three sliders and the selected settings survive an offline reload', async ({ page, context }) => {
  await page.goto('./');
  for (const [name, expected] of [['Спокойный', [0, 0, 0]], ['Лёгкий', [3, 30, 2]], ['Обычный', [6, 60, 5]]] as const) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click();
    expect(await values(page)).toEqual(expected);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Лёгкий', exact: true }).click();
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.locator('.enemy')).toHaveCount(3);
  await expectOfflineReady(page);
  await context.setOffline(true);
  await page.reload();
  await expect(dialog(page)).toBeVisible();
  expect(await values(page)).toEqual([3, 30, 2]);
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(page.locator('.enemy')).toHaveCount(3);
});

test('a peaceful game can be won and restarted without enemies or changing its settings', async ({ page }) => {
  await openGame(page, { items: [{ x: 900, y: 310 }] }, false);
  await page.getByRole('button', { name: 'Спокойный', exact: true }).click();
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(page.locator('.enemy')).toHaveCount(0);
  await holdKey(page, 'ArrowRight', 2000);
  await expect(page.locator('#game-won')).toBeVisible();
  await restartGame(page, 'click', 0);
  await expect(dialog(page)).not.toBeVisible();
  await page.reload();
  expect(await values(page)).toEqual([0, 0, 0]);
  await page.getByRole('button', { name: 'Обычный', exact: true }).click();
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(page.locator('.enemy')).toHaveCount(6);
});

test('zero damage allows the dragon to practise around attacking enemies', async ({ page }) => {
  await openGame(page, { items: [{ x: 1100, y: 600 }], enemies: [{ x: 650, y: 310 }] }, false);
  await page.getByRole('slider', { name: 'Сила удара' }).focus();
  await page.keyboard.press('Home');
  expect(await values(page)).toEqual([6, 60, 0]);
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await holdKey(page, 'ArrowRight', 1600);
  await page.clock.runFor(4000);
  await expect(page.locator('.enemy.hitting')).toHaveCount(6);
  await expect(page.locator('#player-health-scale-text')).toHaveText('100 / 100');
  await expect(page.locator('#game-over')).toBeHidden();
});

for (const unavailable of [false, true]) {
  test(`settings work with ${unavailable ? 'unavailable' : 'corrupt'} storage`, async ({ page }) => {
    await page.addInitScript(unavailable => {
      if (unavailable) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
      else localStorage.setItem('flying-dragon-game:settings', 'invalid JSON');
    }, unavailable);
    await page.goto('./');
    expect(await values(page)).toEqual([6, 60, 5]);
    await page.getByRole('button', { name: 'Спокойный', exact: true }).click();
    await page.getByRole('button', { name: 'Играть', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.locator('.enemy')).toHaveCount(0);
  });
}

test.describe('mobile settings', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('sliders respond to touch and settings fit after rotation', async ({ page }) => {
    await page.goto('./');
    await expect(dialog(page)).toBeVisible();
    const strength = page.getByRole('slider', { name: 'Сила удара' });
    const box = (await strength.boundingBox())!;
    const finger = await touchInput(page);
    await finger.down(1, { x: box.x + box.width - 10, y: box.y + box.height / 2 });
    await finger.move(1, { x: box.x + 12, y: box.y + box.height / 2 });
    await finger.up(1);
    expect(Number(await strength.inputValue())).toBeLessThan(5);
    await expect(dialog(page)).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(dialog(page)).toBeInViewport({ ratio: 1 });
    const panel = (await dialog(page).boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(390);
  });

  // Start in landscape: Chromium's mobile emulation can drop scroll gestures
  // after a viewport resize. Rotation geometry is covered separately above.
  test.describe('landscape settings', () => {
    test.use({ viewport: { width: 844, height: 390 } });
    test('a touch swipe reveals Play and starts a peaceful game', async ({ page }) => {
      await page.goto('./');
      await page.getByRole('button', { name: 'Спокойный', exact: true }).tap();
      const panel = (await dialog(page).boundingBox())!;
      const scrollStart = await dialog(page).evaluate(node => node.scrollTop);
      const finger = await touchInput(page);
      const x = panel.x + panel.width - 12;
      await finger.down(1, { x, y: panel.y + panel.height - 30 });
      for (let step = 1; step <= 8; step++) {
        await finger.move(1, { x, y: panel.y + panel.height - 30 - (panel.height - 60) * step / 8 });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      }
      await finger.up(1);
      await expect.poll(() => dialog(page).evaluate(node => node.scrollTop)).toBeGreaterThan(scrollStart);
      const play = page.getByRole('button', { name: 'Играть', exact: true });
      await expect(play).toBeInViewport({ ratio: 1 });
      await play.tap();
      await expect(dialog(page)).not.toBeVisible();
      await expect(page.locator('.enemy')).toHaveCount(0);
      await expect(page.locator('#joystick')).toBeVisible();
    });
  });
});
