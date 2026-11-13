export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect extends Point, Size {}

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export function sizesFor(viewport: Size) {
  const vmin = Math.min(viewport.width, viewport.height);
  // Leave space for a clear starting area even in a very small square window.
  const scale = Math.min(1, Math.max(viewport.width, viewport.height) / 480);
  const square = (side: number): Size => ({ width: side * scale, height: side * scale });
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

export function fitOutside(position: Point, size: Size, viewport: Size, area: Rect, reserveTurn = false): void {
  fit(position, size, viewport, reserveTurn);
  const width = reserveTurn ? Math.hypot(size.width, size.height) : size.width;
  const height = reserveTurn ? width : size.height;
  const marginX = (width - size.width) / 2;
  const marginY = (height - size.height) / 2;
  if (!intersects({ x: position.x - marginX, y: position.y - marginY, width, height }, area)) return;
  const gap = Math.min(1, Math.min(viewport.width, viewport.height) / 100);
  // Pick the nearest valid outer strip, without retrying random positions.
  const candidates = [
    { x: area.x - size.width - marginX - gap, y: position.y },
    { x: area.x + area.width + marginX + gap, y: position.y },
    { x: position.x, y: area.y - size.height - marginY - gap },
    { x: position.x, y: area.y + area.height + marginY + gap },
  ].filter(point => point.x >= marginX - 0.000001 && point.y >= marginY - 0.000001 &&
    point.x + size.width + marginX <= viewport.width + 0.000001 && point.y + size.height + marginY <= viewport.height + 0.000001);
  candidates.sort((a, b) => Math.hypot(a.x - position.x, a.y - position.y) - Math.hypot(b.x - position.x, b.y - position.y));
  const point = candidates[0];
  if (!point) throw new Error('No room outside the starting area');
  Object.assign(position, point);
}

export function circlesIntersect(a: Point, radiusA: number, b: Point, radiusB: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= radiusA + radiusB;
}

export function normalized(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0 && Number.isFinite(length)
    ? { x: vector.x / length, y: vector.y / length }
    : { x: 0, y: 0 };
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
