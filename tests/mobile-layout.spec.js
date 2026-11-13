import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.item')).toHaveCount(10);
  await page.getByRole('button', { name: 'Закрыть подсказку' }).click();
});

function contextMenuCancelled(locator) {
  return locator.evaluate(element => !element.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  ));
}

function controlGeometry(page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    buttons: [...document.querySelectorAll('#touch-controls button')].map(button => {
      const r = button.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  }));
}

test('cancels control context menus without disabling them on the rest of the page', async ({ page }) => {
  for (const button of await page.locator('#touch-controls button').all()) {
    expect(await contextMenuCancelled(button)).toBe(true);
  }
  expect(await contextMenuCancelled(page.locator('body'))).toBe(false);
});

for (const outcome of ['death', 'victory']) {
  test(`keeps mobile controls in place after ${outcome} near the field edge`, async ({ page }) => {
    await page.evaluate(outcome => {
      const player = document.querySelector('#player');
      const left = document.documentElement.clientWidth - player.offsetWidth - 4;
      const top = document.documentElement.clientHeight - player.offsetHeight - 4;
      Object.assign(player.style, { left: `${left}px`, top: `${top}px`, transform: 'rotate(90deg)' });
      document.querySelectorAll('.item').forEach(element => Object.assign(element.style,
        outcome === 'victory' ? { left: `${left + 80}px`, top: `${top + 80}px` } : { left: '0px', top: '0px' }));
      document.querySelectorAll('.enemy').forEach(element => Object.assign(element.style,
        outcome === 'death' ? { left: `${left + 60}px`, top: `${top + 60}px` } : { left: '0px', top: '0px' }));
    }, outcome);
    const before = await controlGeometry(page);
    for (let i = 0; i < (outcome === 'death' ? 4 : 1); i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator(outcome === 'death' ? '#game-over' : '#game-won')).toBeVisible();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await controlGeometry(page)).toEqual(before);
    expect(await contextMenuCancelled(page.getByRole('button', { name: 'Стрелять', exact: true }))).toBe(true);
  });
}
