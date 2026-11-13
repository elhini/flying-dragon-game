export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect extends Point, Size {}
export type Direction = 'top' | 'left' | 'right' | 'bottom';
export type Facing = Direction | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export function sizesFor(viewport: Size) {
  const vmin = Math.min(viewport.width, viewport.height);
  const square = (side: number): Size => ({ width: side, height: side });
  return {
    player: square(Math.min(200, 0.7 * vmin)),
    item: square(Math.min(30, 0.2 * vmin)),
    enemy: square(Math.min(70, 0.5 * vmin)),
    fire: square(50),
  };
}

export function bounds(position: Point & { angle?: number }, size: Size): Rect {
  const angle = (position.angle ?? 0) * Math.PI / 180;
  const width = Math.abs(size.width * Math.cos(angle)) + Math.abs(size.height * Math.sin(angle));
  const height = Math.abs(size.width * Math.sin(angle)) + Math.abs(size.height * Math.cos(angle));
  return { x: position.x + (size.width - width) / 2, y: position.y + (size.height - height) / 2, width, height };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x &&
    a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function fit(position: Point & { angle?: number }, size: Size, viewport: Size, reserveTurn = false): void {
  const rect = reserveTurn
    ? { width: Math.hypot(size.width, size.height), height: Math.hypot(size.width, size.height) }
    : bounds(position, size);
  const marginX = Math.max(0, (rect.width - size.width) / 2);
  const marginY = Math.max(0, (rect.height - size.height) / 2);
  position.x = clamp(position.x, marginX, viewport.width - size.width - marginX);
  position.y = clamp(position.y, marginY, viewport.height - size.height - marginY);
}

export const vectors: Record<Facing, Point> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  'top-left': { x: -1, y: -1 }, 'top-right': { x: 1, y: -1 },
  'bottom-left': { x: -1, y: 1 }, 'bottom-right': { x: 1, y: 1 },
};

export const angles: Record<Facing, number> = {
  top: 0, bottom: 180, left: -90, right: 90,
  'top-left': -45, 'top-right': 45, 'bottom-left': -135, 'bottom-right': 135,
};

export function facingFor(directions: readonly Direction[]): Facing | undefined {
  const x = Number(directions.includes('right')) - Number(directions.includes('left'));
  const y = Number(directions.includes('bottom')) - Number(directions.includes('top'));
  return (Object.keys(vectors) as Facing[]).find(key => vectors[key].x === x && vectors[key].y === y);
}

// Sweep a moving box against a stationary one, returning time of first contact.
// A single slow frame must not allow a projectile to jump through an enemy.
export function sweep(start: Point, end: Point, size: Size, target: Rect): number | null {
  let first = 0;
  let last = 1;
  for (const [axis, length] of [['x', 'width'], ['y', 'height']] as const) {
    const delta = end[axis] - start[axis];
    const min = target[axis] - size[length];
    const max = target[axis] + target[length];
    if (delta === 0) {
      if (start[axis] < min || start[axis] > max) return null;
    } else {
      const a = (min - start[axis]) / delta;
      const b = (max - start[axis]) / delta;
      first = Math.max(first, Math.min(a, b));
      last = Math.min(last, Math.max(a, b));
      if (first > last) return null;
    }
  }
  return first;
}
