import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

interface Position { x: number; y: number }
export interface FieldLayout { items?: Position[]; enemies?: Position[] }

export async function openGame(page: Page, layout: FieldLayout = {}): Promise<void> {
  await page.clock.install();
  // Control initial generation, not DOM coordinates or a production test hook.
  await page.addInitScript(layout => {
    let sequence: number[] | undefined;
    let i = 0;
    const positionValue = (value: number, min: number, max: number) =>
      (Math.max(min, Math.min(value, max)) - min + 0.5) / (max - min + 1);
    Math.random = () => {
      // On mobile the viewport meta tag must be parsed before measuring it.
      if (!sequence) {
        sequence = [];
        for (const [count, side, positions] of [
          [10, 30, layout.items ?? [{ x: 0, y: 30 }]],
          [6, 70, layout.enemies ?? [{ x: 0, y: innerHeight - 80 }]],
        ] as const) {
          for (let i = 0; i < count; i++) {
            const position = positions[i % positions.length]!;
            sequence.push((i % 3 + 0.5) / 3, positionValue(position.x, 0, Math.max(0, innerWidth - side)),
              positionValue(position.y, 30, Math.max(30, innerHeight - side)));
          }
        }
      }
      return sequence[i++ % sequence.length]!;
    };
  }, layout);
  await page.goto('./');
  await expect(page.locator('.item')).toHaveCount(10);
  await expect(page.locator('.enemy')).toHaveCount(6);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

export async function holdKey(page: Page, key: string, milliseconds: number): Promise<void> {
  await page.keyboard.down(key);
  await page.clock.runFor(milliseconds);
  await page.keyboard.up(key);
}

export function position(page: Page) {
  return page.locator('#player').evaluate(player => ({ x: parseFloat(player.style.left), y: parseFloat(player.style.top) }));
}

export async function touchInput(page: Page) {
  const session = await page.context().newCDPSession(page);
  const points = new Map<number, { id: number; x: number; y: number }>();
  return {
    async down(id: number, point: Position) {
      points.set(id, { id, ...point });
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...points.values()] });
    },
    async move(id: number, point: Position) {
      if (!points.has(id)) throw new Error('Touch point is missing');
      points.set(id, { id, ...point });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...points.values()] });
    },
    async up(id: number) {
      const point = points.get(id);
      if (!point) throw new Error('Touch point is missing');
      points.delete(id);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
    },
    async cancel() {
      points.clear();
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    },
  };
}

export async function expectFreshGame(page: Page): Promise<void> {
  await expect(page.locator('.item')).toHaveCount(10);
  await expect(page.locator('.enemy')).toHaveCount(6);
  await expect(page.locator('.fire')).toHaveCount(0);
  await expect(page.locator('#player')).not.toHaveClass(/finished|dead|won/);
  await expect(page.locator('#items-scale-text')).toHaveText('0 / 10');
  await expect(page.locator('#player-health-scale-text')).toHaveText('100 / 100');
  await expect(page.locator('#game-help')).toBeVisible();
  await expect(page.locator('#game-won')).toBeHidden();
  await expect(page.locator('#game-over')).toBeHidden();
}

export async function restartGame(page: Page, method: 'click' | 'tap' | 'Enter' | 'Space'): Promise<void> {
  const originalDocument = await page.evaluateHandle(() => document);
  const button = page.getByRole('button', { name: 'Ещё раз', exact: true });
  if (method === 'Enter' || method === 'Space') {
    await button.focus();
    await page.keyboard.press(method);
  } else if (method === 'tap') {
    await button.tap();
  } else {
    await button.click();
  }
  await expectFreshGame(page);
  expect(await originalDocument.evaluate(original => original === document)).toBe(true);
  await originalDocument.dispose();
  await expect(page.locator('.game-restart:focus')).toHaveCount(0);
}
