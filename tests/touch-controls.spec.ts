import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGame } from './fixtures.ts';

test.use({ viewport: { width: 900, height: 900 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await openGame(page);
  await expect(page.locator('.item')).toHaveCount(10);
  await page.getByRole('button', { name: 'Закрыть подсказку' }).click();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
});

function position(page: Page) {
  return page.locator('#player').evaluate(element => ({
    x: parseFloat(element.style.left), y: parseFloat(element.style.top),
  }));
}

async function touchInput(page: Page) {
  const session = await page.context().newCDPSession(page);
  const points = new Map<number, { id: number; x: number; y: number }>();
  return {
    async down(name: string, id: number, offset = 0) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      if (!box) throw new Error('Touch button is missing');
      points.set(id, { id, x: box.x + box.width / 2 + offset, y: box.y + box.height / 2 });
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...points.values()] });
    },
    async up(id: number) {
      const point = points.get(id);
      if (!point) throw new Error('Touch point is missing');
      points.delete(id);
      // Lift only this point; other fingers stay on their buttons.
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
    },
    async cancel() {
      points.clear();
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    },
  };
}

test('holding one direction moves once per repeat tick and stops on release', async ({ page }) => {
  const touch = await touchInput(page);
  const before = await position(page);
  await touch.down('Вправо', 1);
  expect(await position(page)).toEqual({ x: before.x + 20, y: before.y });
  await page.clock.runFor(440);
  expect(await position(page)).toEqual({ x: before.x + 100, y: before.y });
  await touch.up(1);
  await page.clock.runFor(440);
  expect(await position(page)).toEqual({ x: before.x + 100, y: before.y });
});

test('holding two directions uses one shared repeat rate', async ({ page }) => {
  const touch = await touchInput(page);
  await touch.down('Вправо', 1);
  await touch.down('Вверх', 2);
  const before = await position(page);
  await page.clock.runFor(440); // Four repeat ticks, 20 px per axis on each tick.
  expect(await position(page)).toEqual({ x: before.x + 80, y: before.y - 80 });
  await touch.up(2);
  const remaining = await position(page);
  await page.clock.runFor(220);
  expect(await position(page)).toEqual({ x: remaining.x + 40, y: remaining.y });
  await touch.up(1);
});

test('releasing a second finger on the same button keeps its owner active', async ({ page }) => {
  const touch = await touchInput(page);
  await touch.down('Вправо', 1, -5);
  await touch.down('Вправо', 2, 5);
  await touch.up(2);
  const before = await position(page);
  await page.clock.runFor(220);
  expect(await position(page)).toEqual({ x: before.x + 40, y: before.y });
  await expect(page.getByRole('button', { name: 'Вправо', exact: true })).toHaveClass(/pressed/);
  await touch.up(1);
  const released = await position(page);
  await page.clock.runFor(220);
  expect(await position(page)).toEqual(released);
});

test('cancelling a touch stops repeated movement', async ({ page }) => {
  const touch = await touchInput(page);
  await touch.down('Вправо', 1);
  await touch.cancel();
  const before = await position(page);
  await page.clock.runFor(440);
  expect(await position(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Вправо', exact: true })).not.toHaveClass(/pressed/);
});

test('firing and releasing fire leave the held direction repeating', async ({ page }) => {
  const touch = await touchInput(page);
  await touch.down('Вправо', 1);
  await touch.down('Стрелять', 2);
  await expect(page.locator('.fire')).toHaveCount(1);
  const before = await position(page);
  await page.clock.runFor(220);
  expect(await position(page)).toEqual({ x: before.x + 40, y: before.y });
  await touch.up(2);
  const afterFire = await position(page);
  await page.clock.runFor(220);
  expect(await position(page)).toEqual({ x: afterFire.x + 40, y: afterFire.y });
  await touch.up(1);
});

test('losing focus releases physical and virtual keys', async ({ page }) => {
  const touch = await touchInput(page);
  await page.keyboard.down('ArrowRight');
  await touch.down('Вверх', 1);
  const before = await position(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(440);
  await page.keyboard.press('Space');
  expect(await position(page)).toEqual(before);
  await expect(page.locator('#touch-controls .pressed')).toHaveCount(0);
  await expect(page.locator('.fire')).toHaveCount(1);
  await page.keyboard.up('ArrowRight');
  await touch.up(1);
});

test('releasing touch preserves a matching physical key', async ({ page }) => {
  const touch = await touchInput(page);
  await page.keyboard.down('ArrowRight');
  await touch.down('Вправо', 1);
  await touch.up(1);
  const before = await position(page);
  await page.keyboard.press('ArrowUp');
  expect(await position(page)).toEqual({ x: before.x + 20, y: before.y - 20 });
  await page.keyboard.up('ArrowRight');
});
