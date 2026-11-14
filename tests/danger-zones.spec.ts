import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { holdKey, openGame, restartGame } from './fixtures.ts';

async function circle(node: Locator) {
  return node.evaluate(element => {
    const style = getComputedStyle(element, '::after');
    const transform = new DOMMatrixReadOnly(style.transform);
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    return {
      content: style.content,
      width, height,
      centerX: parseFloat(style.left) + transform.e + width / 2,
      centerY: parseFloat(style.top) + transform.f + height / 2,
      animation: style.animationName,
    };
  });
}

test('contact reveals both exact danger circles and opacity pulses without resizing', async ({ page }) => {
  await openGame(page, { enemies: [{ x: 960, y: 300 }, ...Array.from({ length: 5 }, () => ({ x: 1100, y: 600 }))] });
  const player = page.locator('#player');
  const enemy = page.locator('.enemy').first();
  expect((await circle(player)).content).toBe('none');
  expect((await circle(enemy)).content).toBe('none');
  await holdKey(page, 'ArrowRight', 1300);
  await expect(player).toHaveClass(/hitting/);
  await expect(enemy).toHaveClass(/hitting/);
  for (const [node, diameter] of [[player, 200], [enemy, 70]] as const) {
    const ring = await circle(node);
    expect(ring.content).not.toBe('none');
    expect(ring.width).toBe(diameter);
    expect(ring.height).toBe(diameter);
    expect(ring.centerX).toBe(diameter / 2);
    expect(ring.centerY).toBe(diameter / 2);
    const samples = await node.evaluate(element => {
      const animation = element.getAnimations({ subtree: true }).find(animation => animation instanceof CSSAnimation)!;
      animation.pause();
      const sample = (time: number) => {
        animation.currentTime = time;
        const style = getComputedStyle(element, '::after');
        return { opacity: parseFloat(style.opacity), width: style.width, height: style.height, transform: style.transform };
      };
      return [sample(0), sample(350)];
    });
    expect(samples[1]!.opacity).toBeGreaterThan(samples[0]!.opacity);
    expect(samples[1]!.width).toBe(samples[0]!.width);
    expect(samples[1]!.height).toBe(samples[0]!.height);
    expect(samples[1]!.transform).toBe(samples[0]!.transform);
  }
  await holdKey(page, 'ArrowLeft', 600);
  expect((await circle(player)).content).toBe('none');
  expect((await circle(enemy)).content).toBe('none');
});

test('danger circles follow the scaled sprites while the dragon turns', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 240 });
  await openGame(page, { enemies: [{ x: 190, y: 100 }, ...Array.from({ length: 5 }, () => ({ x: 0, y: 30 }))] });
  await holdKey(page, 'ArrowRight', 200);
  for (const [node, diameter] of [[page.locator('#player'), 84], [page.locator('.enemy').first(), 35]] as const) {
    const ring = await circle(node);
    expect(ring.content).not.toBe('none');
    expect(ring.width).toBe(diameter);
    expect(ring.height).toBe(diameter);
    expect(ring.centerX).toBe(diameter / 2);
    expect(ring.centerY).toBe(diameter / 2);
  }
});

test('death keeps the same danger diameters and restart clears the circles', async ({ page }) => {
  await openGame(page, { items: [{ x: 1100, y: 600 }], enemies: [{ x: 650, y: 310 }] });
  await holdKey(page, 'ArrowRight', 1600);
  await expect(page.locator('#player')).toHaveClass(/dead/);
  const player = await circle(page.locator('#player'));
  const enemy = await circle(page.locator('.enemy.hitting').first());
  expect(player.width).toBe(200);
  expect(player.height).toBe(200);
  expect(enemy.width).toBe(70);
  expect(enemy.height).toBe(70);
  await restartGame(page, 'click');
  expect((await circle(page.locator('#player'))).content).toBe('none');
  await expect(page.locator('.enemy.hitting')).toHaveCount(0);
});
