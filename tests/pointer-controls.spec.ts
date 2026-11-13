import { test, expect } from '@playwright/test';
import { openGame, position, touchInput } from './fixtures.ts';

test.beforeEach(async ({ page }) => { await openGame(page); });

test('hover alone does not move the dragon or dismiss help', async ({ page }) => {
  const before = await position(page);
  await page.mouse.move(950, 480);
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(before);
  await expect(page.locator('#game-help')).toBeVisible();
  await expect(page.locator('#touch-controls')).toBeHidden();
});
test('left drag flies at an arbitrary angle and release stops movement', async ({ page }) => {
  const before = await position(page);
  await page.mouse.move(940, 480);
  await page.mouse.down();
  await page.clock.runFor(500);
  await page.mouse.up();
  const after = await position(page);
  expect((after.y - before.y) / (after.x - before.x)).toBeCloseTo(0.4, 2);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeCloseTo(90, -1);
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(after);
  await expect(page.locator('#game-help')).toBeHidden();
});
test('dragging updates the target while the left button stays held', async ({ page }) => {
  await page.mouse.move(950, 400);
  await page.mouse.down();
  await page.clock.runFor(300);
  const before = await position(page);
  await page.mouse.move(400, 100);
  await page.clock.runFor(300);
  const after = await position(page);
  expect(after.x).toBeLessThan(before.x);
  expect(after.y).toBeLessThan(before.y);
  await page.mouse.up();
});
test('arriving at the cursor stops without overshoot', async ({ page }) => {
  await page.mouse.move(680, 380);
  await page.mouse.down();
  await page.clock.runFor(1000);
  const arrived = await position(page);
  expect(arrived.x).toBeCloseTo(580, 3);
  expect(arrived.y).toBeCloseTo(280, 3);
  await page.clock.runFor(1000);
  expect(await position(page)).toEqual(arrived);
  await page.mouse.up();
});
test('right mouse button and interface buttons do not initiate flight', async ({ page }) => {
  const before = await position(page);
  await page.mouse.move(950, 400);
  await page.mouse.down({ button: 'right' });
  await page.clock.runFor(500);
  await page.mouse.up({ button: 'right' });
  expect(await position(page)).toEqual(before);
  await page.getByRole('button', { name: 'Закрыть подсказку' }).click();
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(before);
});
test('blur stops mouse flight and clears held physical keys', async ({ page }) => {
  await page.keyboard.down('ArrowUp');
  await page.mouse.move(950, 400);
  await page.mouse.down();
  await page.clock.runFor(200);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const before = await position(page);
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(before);
  await page.mouse.up();
  await page.keyboard.up('ArrowUp');
});
test('releasing left while right stays pressed stops flight', async ({ page }) => {
  await page.mouse.move(950, 400);
  await page.mouse.down();
  await page.mouse.down({ button: 'right' });
  await page.clock.runFor(200);
  await page.mouse.up({ button: 'left' });
  const before = await position(page);
  await page.clock.runFor(500);
  expect(await position(page)).toEqual(before);
  await page.mouse.up({ button: 'right' });
});
test('left flight can start while another mouse button is already held', async ({ page }) => {
  const before = await position(page);
  await page.mouse.move(950, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.down({ button: 'left' });
  await page.clock.runFor(300);
  expect((await position(page)).x).toBeGreaterThan(before.x + 40);
  await page.mouse.up({ button: 'left' });
  await page.mouse.up({ button: 'right' });
});
test('mouse release restores held keyboard fallback and Space can fire while flying', async ({ page }) => {
  await page.keyboard.down('ArrowLeft');
  await page.mouse.move(950, 400);
  await page.mouse.down();
  await page.keyboard.press('Space');
  await expect(page.locator('.fire')).toHaveCount(1);
  await page.clock.runFor(200);
  const before = await position(page);
  await page.mouse.up();
  await page.clock.runFor(200);
  expect((await position(page)).x).toBeLessThan(before.x);
  await page.keyboard.up('ArrowLeft');
});

test.describe('touch flight on the field', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('a held finger flies towards its position and release stops flight', async ({ page }) => {
    const touch = await touchInput(page);
    const before = await position(page);
    await touch.down(1, { x: 330, y: 220 });
    await page.clock.runFor(500);
    const after = await position(page);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    await expect(page.locator('#game-help')).toBeHidden();
    await touch.up(1);
    await page.clock.runFor(500);
    expect(await position(page)).toEqual(after);
  });
  test('a field touch and a second finger on fire work together', async ({ page }) => {
    const touch = await touchInput(page);
    await touch.down(1, { x: 330, y: 220 });
    const button = (await page.locator('.touch-fire').boundingBox())!;
    await touch.down(2, { x: button.x + button.width / 2, y: button.y + button.height / 2 });
    await expect(page.locator('.fire')).toHaveCount(1);
    const before = await position(page);
    await touch.up(2);
    await page.clock.runFor(300);
    expect((await position(page)).x).toBeGreaterThan(before.x);
    await touch.up(1);
  });
  test('moving the held finger updates the destination without starting a browser gesture', async ({ page }) => {
    const touch = await touchInput(page);
    await touch.down(1, { x: 330, y: 220 });
    await page.clock.runFor(200);
    const before = await position(page);
    const target = { x: 60, y: 160 };
    const received = await page.evaluateHandle(target => {
      const state = { moved: false };
      const events = new AbortController();
      document.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' && Math.abs(event.clientX - target.x) < 1 && Math.abs(event.clientY - target.y) < 1) {
          state.moved = true;
          events.abort();
        }
      }, { signal: events.signal });
      return state;
    }, target);
    await touch.move(1, target);
    await expect.poll(() => received.evaluate(state => state.moved)).toBe(true);
    await received.dispose();
    await page.clock.runFor(300);
    const after = await position(page);
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeLessThan(before.y);
    await touch.up(1);
  });
  test('cancel releases field touch ownership and stops flight', async ({ page }) => {
    const touch = await touchInput(page);
    await touch.down(1, { x: 330, y: 220 });
    await page.clock.runFor(200);
    await touch.cancel();
    const before = await position(page);
    await page.clock.runFor(500);
    expect(await position(page)).toEqual(before);
  });
  test('field context menus stay suppressed after arrival and touch cancellation', async ({ page }) => {
    const touch = await touchInput(page);
    const cancelled = () => page.locator('body').evaluate(element => !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await touch.down(1, { x: 245, y: 422 });
    await page.clock.runFor(1000);
    expect((await position(page)).x).toBeCloseTo(145, 3);
    expect(await cancelled()).toBe(true);
    await touch.cancel();
    expect(await cancelled()).toBe(true);
  });
  test('a native long press after arrival does not start selection or open a menu', async ({ page }) => {
    const received = await page.evaluateHandle(() => {
      const state = { menus: [] as boolean[], selections: 0 };
      document.addEventListener('contextmenu', event => state.menus.push(event.defaultPrevented));
      document.addEventListener('selectstart', () => state.selections++);
      return state;
    });
    await page.clock.resume();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeTapGesture', { x: 245, y: 422, duration: 1500, gestureSourceType: 'touch' });
    expect((await position(page)).x).toBeCloseTo(145, 3);
    // Native long presses do not emit contextmenu on every headless platform.
    expect(await received.evaluate(state => state.menus)).not.toContain(false);
    expect(await received.evaluate(state => state.selections)).toBe(0);
    await received.dispose();
  });
});
