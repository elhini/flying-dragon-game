import { test, expect } from '@playwright/test';
import { openGame, position, touchInput } from './fixtures.ts';

test.use({ viewport: { width: 900, height: 900 }, hasTouch: true, isMobile: true });
test.beforeEach(async ({ page }) => { await openGame(page); });

async function center(page: import('@playwright/test').Page, selector = '#joystick') {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
test('joystick replaces four buttons and dismisses help on touch', async ({ page }) => {
  await expect(page.locator('#joystick')).toBeVisible();
  await expect(page.locator('.touch-up, .touch-left, .touch-right, .touch-down')).toHaveCount(0);
  await expect(page.locator('#game-controls-help')).toContainText('джойстиком');
  const touch = await touchInput(page);
  await touch.down(1, await center(page));
  await expect(page.locator('#game-help')).toBeHidden();
  await touch.up(1);
});
test('joystick supports an arbitrary angle and release stops flight', async ({ page }) => {
  const touch = await touchInput(page);
  const origin = await center(page);
  const before = await position(page);
  await touch.down(1, origin);
  await touch.move(1, { x: origin.x + 36, y: origin.y - 18 });
  await page.clock.runFor(500);
  const after = await position(page);
  expect((after.y - before.y) / (after.x - before.x)).toBeCloseTo(-0.5, 2);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeCloseTo(90, -1);
  await touch.up(1);
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(after);
  await expect(page.locator('#joystick')).not.toHaveClass(/pressed/);
  await expect(page.locator('#joystick-knob')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
});
test('small center movements stay in the deadzone', async ({ page }) => {
  const touch = await touchInput(page);
  const origin = await center(page);
  const before = await position(page);
  await touch.down(1, origin);
  await touch.move(1, { x: origin.x + 3, y: origin.y + 3 });
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(before);
  await touch.up(1);
});
test('changing joystick angle continuously changes flight direction', async ({ page }) => {
  const touch = await touchInput(page);
  const origin = await center(page);
  await touch.down(1, origin);
  await touch.move(1, { x: origin.x + 40, y: origin.y });
  await page.clock.runFor(300);
  const before = await position(page);
  const previousTransform = await page.locator('#joystick-knob').evaluate(element => element.style.transform);
  await touch.move(1, { x: origin.x + 10, y: origin.y - 40 });
  await expect.poll(() => page.locator('#joystick-knob').evaluate(element => element.style.transform)).not.toBe(previousTransform);
  await page.clock.runFor(300);
  const after = await position(page);
  expect((after.y - before.y) / (after.x - before.x)).toBeCloseTo(-4, 1);
  await touch.up(1);
});
test('a second finger on the joystick cannot replace or release its owner', async ({ page }) => {
  const touch = await touchInput(page);
  const origin = await center(page);
  await touch.down(1, origin);
  await touch.move(1, { x: origin.x + 40, y: origin.y });
  await touch.down(2, { x: origin.x, y: origin.y - 30 });
  await touch.up(2);
  const before = await position(page);
  await page.clock.runFor(300);
  expect((await position(page)).x - before.x).toBeCloseTo(54, -1);
  await expect(page.locator('#joystick')).toHaveClass(/pressed/);
  await touch.up(1);
});
test('firing with a second finger preserves movement and its angle', async ({ page }) => {
  const touch = await touchInput(page);
  const origin = await center(page);
  await touch.down(1, origin);
  await touch.move(1, { x: origin.x + 40, y: origin.y - 20 });
  await touch.down(2, await center(page, '.touch-fire'));
  await expect(page.locator('.fire')).toHaveCount(1);
  const before = await position(page);
  await page.clock.runFor(300);
  expect((await position(page)).x).toBeGreaterThan(before.x + 40);
  await touch.up(2);
  const released = await position(page);
  await page.clock.runFor(300);
  expect((await position(page)).x).toBeGreaterThan(released.x + 40);
  await touch.up(1);
});
for (const reason of ['cancel', 'blur', 'lostcapture']) {
  test(`${reason} releases the joystick and stops movement`, async ({ page }) => {
    const touch = await touchInput(page);
    const origin = await center(page);
    // Record the real pointer ID in the test context to release its capture.
    const pointer = await page.locator('#joystick').evaluateHandle(element => {
      const state = { id: 0 };
      element.addEventListener('pointerdown', event => { state.id = (event as PointerEvent).pointerId; }, { once: true });
      return state;
    });
    await touch.down(1, origin);
    const owner = await pointer.evaluate(state => state.id);
    expect(owner).toBeGreaterThan(0);
    await pointer.dispose();
    await touch.move(1, { x: origin.x + 40, y: origin.y });
    await page.clock.runFor(200);
    if (reason === 'cancel') await touch.cancel();
    else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else {
      await page.locator('#joystick').evaluate((element, id) => element.releasePointerCapture(id), owner);
      // Capture changes are processed before the next native pointer event.
      await touch.move(1, { x: origin.x + 41, y: origin.y });
    }
    await expect(page.locator('#joystick')).not.toHaveClass(/pressed/);
    await page.clock.runFor(20);
    const before = await position(page);
    await page.clock.runFor(500);
    expect(await position(page)).toEqual(before);
    await expect(page.locator('#joystick')).not.toHaveClass(/pressed/);
    if (reason !== 'cancel') await touch.up(1);
  });
}
test('joystick release restores a physical key still held down', async ({ page }) => {
  const touch = await touchInput(page);
  const origin = await center(page);
  await page.keyboard.down('ArrowLeft');
  await touch.down(1, origin);
  await touch.move(1, { x: origin.x + 40, y: origin.y });
  await page.clock.runFor(200);
  const before = await position(page);
  await touch.up(1);
  await page.clock.runFor(200);
  expect((await position(page)).x).toBeLessThan(before.x - 30);
  await page.keyboard.up('ArrowLeft');
});
