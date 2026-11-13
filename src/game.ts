import { angles, bounds, clamp, facingFor, fit, intersects, sizesFor, sweep, vectors } from './geometry.ts';
import type { Direction, Facing, Point, Size } from './geometry.ts';

export interface Sprite extends Point { id: number; type: 1 | 2 | 3 }
export interface Enemy extends Sprite { angle: number; hitting: boolean }
export interface Player extends Point {
  health: number;
  angle: number;
  targetAngle: number;
  turnFrom: number;
  turnElapsed: number;
  direction: Facing;
}
export interface Fire extends Point {
  id: number;
  velocity: Point;
  ageMs: number;
  fadingMs: number | null;
}
export interface GameState {
  viewport: Size;
  player: Player;
  items: Sprite[];
  enemies: Enemy[];
  fires: Fire[];
  nextFireId: number;
  collected: number;
  status: 'playing' | 'won' | 'dead';
  helpVisible: boolean;
}
export interface Command { directions: readonly Direction[]; fire: boolean }

export const RULES = { items: 10, enemies: 6, health: 100, damage: 5, step: 20, fireSpeed: 500, turnMs: 500, fadeMs: 1000 } as const;

export function createGame(viewport: Size, random: () => number = Math.random): GameState {
  const sizes = sizesFor(viewport);
  const integer = (min: number, max: number) => Math.floor(random() * (Math.floor(max) - min + 1)) + min;
  const spawn = (count: number, side: number): Sprite[] => Array.from({ length: count }, (_, i) => ({
    id: i + 1, type: integer(1, 3) as 1 | 2 | 3,
    x: integer(0, Math.max(0, viewport.width - side)),
    y: integer(30, Math.max(30, viewport.height - side)),
  }));
  const state: GameState = {
    viewport: { ...viewport },
    player: {
      x: Math.round((viewport.width - sizes.player.width) / 2),
      y: Math.round((viewport.height - sizes.player.height) / 2),
      health: RULES.health, angle: 0, targetAngle: 0, turnFrom: 0, turnElapsed: RULES.turnMs, direction: 'top',
    },
    items: spawn(RULES.items, 30),
    enemies: spawn(RULES.enemies, 70).map(enemy => ({ ...enemy, angle: 0, hitting: false })),
    fires: [], nextFireId: 1, collected: 0, status: 'playing', helpVisible: true,
  };
  fit(state.player, sizes.player, viewport);
  state.items.forEach(item => fit(item, sizes.item, viewport));
  state.enemies.forEach(enemy => fit(enemy, sizes.enemy, viewport, true));
  facePlayer(state);
  return state;
}

function facePlayer(state: GameState): void {
  const sizes = sizesFor(state.viewport);
  const x = state.player.x + sizes.player.width / 2;
  const y = state.player.y + sizes.player.height / 2;
  state.enemies.forEach(enemy => {
    enemy.angle = Math.atan2(y - enemy.y - sizes.enemy.height / 2, x - enemy.x - sizes.enemy.width / 2) * 180 / Math.PI - 90;
  });
}

function fitPlayer(state: GameState): void {
  const player = state.player;
  const size = sizesFor(state.viewport).player;
  const marginX = (Math.hypot(size.width, size.height) - size.width) / 2;
  const marginY = (Math.hypot(size.width, size.height) - size.height) / 2;
  if (player.x < marginX || player.x + size.width + marginX > state.viewport.width ||
      player.y < marginY || player.y + size.height + marginY > state.viewport.height) {
    // At an edge, snap turns to avoid rotating outside the field mid-animation.
    player.angle = player.targetAngle;
    player.turnElapsed = RULES.turnMs;
  }
  fit(player, size, state.viewport);
}

export function applyCommand(state: GameState, command: Command): void {
  if (state.status !== 'playing') return;
  state.helpVisible = false;
  const player = state.player;
  const sizes = sizesFor(state.viewport);
  if (command.directions.length) {
    for (const direction of command.directions) {
      const vector = vectors[direction];
      player.x = clamp(player.x + vector.x * RULES.step, 0, state.viewport.width - sizes.player.width);
      player.y = clamp(player.y + vector.y * RULES.step, 0, state.viewport.height - sizes.player.height);
    }
    const direction = facingFor(command.directions);
    if (direction) {
      player.direction = direction;
      const difference = ((angles[direction] - player.targetAngle + 180) % 360 + 360) % 360 - 180;
      if (difference) {
        player.turnFrom = player.angle;
        player.targetAngle += difference;
        player.turnElapsed = 0;
      }
    }
    fitPlayer(state);
    const playerBounds = bounds(player, sizes.player);
    state.items = state.items.filter(item => !intersects(playerBounds, bounds(item, sizes.item)));
    state.collected = RULES.items - state.items.length;
    state.enemies.forEach(enemy => {
      enemy.hitting = intersects(playerBounds, bounds(enemy, sizes.enemy));
      if (enemy.hitting) player.health = Math.max(0, player.health - RULES.damage);
    });
    if (player.health === 0) state.status = 'dead';
    else if (!state.items.length) state.status = 'won';
    if (state.status !== 'playing') state.fires = [];
  }
  if (command.fire && state.status === 'playing') {
    const direction = vectors[player.direction];
    state.fires.push({
      id: state.nextFireId++,
      x: player.x + (sizes.player.width - sizes.fire.width) / 2,
      y: player.y + (sizes.player.height - sizes.fire.height) / 2,
      velocity: { x: direction.x * RULES.fireSpeed, y: direction.y * RULES.fireSpeed },
      ageMs: 0, fadingMs: null,
    });
  }
  facePlayer(state);
}

export function advanceGame(state: GameState, elapsedMs: number): boolean {
  if (state.status !== 'playing' || !Number.isFinite(elapsedMs) || elapsedMs <= 0 ||
      (!state.fires.length && state.player.turnElapsed >= RULES.turnMs)) return false;
  const player = state.player;
  if (player.turnElapsed < RULES.turnMs) {
    player.turnElapsed = Math.min(RULES.turnMs, player.turnElapsed + elapsedMs);
    player.angle = player.turnFrom + (player.targetAngle - player.turnFrom) * player.turnElapsed / RULES.turnMs;
  }
  const sizes = sizesFor(state.viewport);
  for (const fire of state.fires) {
    fire.ageMs += elapsedMs;
    if (fire.fadingMs !== null) {
      fire.fadingMs += elapsedMs;
      continue;
    }
    const end = { x: fire.x + fire.velocity.x * elapsedMs / 1000, y: fire.y + fire.velocity.y * elapsedMs / 1000 };
    let nearest: { enemy: Enemy; time: number } | undefined;
    for (const enemy of state.enemies) {
      const time = sweep(fire, end, sizes.fire, bounds(enemy, sizes.enemy));
      if (time !== null && (!nearest || time < nearest.time)) nearest = { enemy, time };
    }
    if (nearest) {
      state.enemies = state.enemies.filter(enemy => enemy !== nearest.enemy);
      fire.x += (end.x - fire.x) * nearest.time;
      fire.y += (end.y - fire.y) * nearest.time;
      fire.fadingMs = 0;
    } else {
      Object.assign(fire, end);
      if (!intersects(bounds(fire, sizes.fire), { x: 0, y: 0, ...state.viewport })) fire.fadingMs = 0;
    }
  }
  state.fires = state.fires.filter(fire => fire.fadingMs === null || fire.fadingMs < RULES.fadeMs);
  return true;
}

export function resizeGame(state: GameState, viewport: Size): void {
  const previous = state.viewport;
  const sizes = sizesFor(viewport);
  const entities = [state.player, ...state.items, ...state.enemies];
  entities.forEach(entity => {
    entity.x *= viewport.width / previous.width;
    entity.y *= viewport.height / previous.height;
  });
  state.viewport = { ...viewport };
  state.player.angle = state.player.targetAngle;
  state.player.turnElapsed = RULES.turnMs;
  fitPlayer(state);
  state.items.forEach(item => fit(item, sizes.item, viewport));
  state.enemies.forEach(enemy => fit(enemy, sizes.enemy, viewport, true));
  facePlayer(state);
}
