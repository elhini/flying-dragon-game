import { bounds, circlesIntersect, fit, fitOutside, intersects, normalized, sizesFor, sweep } from './geometry.ts';
import type { Point, Size } from './geometry.ts';

export interface Sprite extends Point { id: number; type: 1 | 2 | 3 }
export interface Enemy extends Sprite { angle: number; hitting: boolean; hitCooldownMs: number }
export interface Player extends Point {
  health: number;
  angle: number;
  targetAngle: number;
  turnFrom: number;
  turnElapsed: number;
  direction: Point;
}
export interface Fire extends Point {
  id: number;
  velocity: Point;
  ageMs: number;
  fadingMs: number | null;
}
export type Motion = { kind: 'direction'; vector: Point } | { kind: 'target'; point: Point };
export interface GameState {
  viewport: Size;
  player: Player;
  motion: Motion;
  started: boolean;
  items: Sprite[];
  enemies: Enemy[];
  fires: Fire[];
  nextFireId: number;
  collected: number;
  status: 'playing' | 'won' | 'dead';
  helpVisible: boolean;
}
export interface Command { motion: Motion; fire: boolean; dismissHelp: boolean }
export const RULES = { items: 10, enemies: 6, health: 100, damage: 5, damageIntervalMs: 250, playerHitRadiusRatio: 0.25, enemyHitRadiusRatio: 0.35, startClearance: 20, speed: 180, fireSpeed: 500, turnMs: 150, fadeMs: 1000 } as const;

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
      health: RULES.health, angle: 0, targetAngle: 0, turnFrom: 0, turnElapsed: RULES.turnMs, direction: { x: 0, y: -1 },
    },
    motion: { kind: 'direction', vector: { x: 0, y: 0 } }, started: false,
    items: spawn(RULES.items, 30),
    enemies: spawn(RULES.enemies, 70).map(enemy => ({ ...enemy, angle: 0, hitting: false, hitCooldownMs: 0 })),
    fires: [], nextFireId: 1, collected: 0, status: 'playing', helpVisible: true,
  };
  fit(state.player, sizes.player, viewport);
  clearStartingArea(state);
  facePlayer(state);
  return state;
}

function clearStartingArea(state: GameState): void {
  const viewport = state.viewport;
  const sizes = sizesFor(viewport);
  const margin = Math.min(RULES.startClearance, Math.min(viewport.width, viewport.height) * 0.05);
  const start = { x: state.player.x - margin, y: state.player.y - margin, width: sizes.player.width + 2 * margin, height: sizes.player.height + 2 * margin };
  state.items.forEach(item => fitOutside(item, sizes.item, viewport, start));
  state.enemies.forEach(enemy => fitOutside(enemy, sizes.enemy, viewport, start, true));
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
    player.angle = player.targetAngle;
    player.turnElapsed = RULES.turnMs;
  }
  fit(player, size, state.viewport);
}

function motionVector(state: GameState): Point {
  if (state.motion.kind === 'direction') return state.motion.vector;
  const size = sizesFor(state.viewport).player;
  return { x: state.motion.point.x - state.player.x - size.width / 2, y: state.motion.point.y - state.player.y - size.height / 2 };
}

function aim(state: GameState, vector: Point): void {
  const direction = normalized(vector);
  if (!direction.x && !direction.y) return;
  const player = state.player;
  player.direction = direction;
  const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI + 90;
  const difference = ((angle - player.targetAngle + 180) % 360 + 360) % 360 - 180;
  if (Math.abs(difference) > 0.000001) {
    player.turnFrom = player.angle;
    player.targetAngle += difference;
    player.turnElapsed = 0;
  }
}

export function applyCommand(state: GameState, command: Command): void {
  if (state.status !== 'playing') return;
  state.motion = command.motion.kind === 'direction'
    ? { kind: 'direction', vector: normalized(command.motion.vector) }
    : { kind: 'target', point: { ...command.motion.point } };
  if (command.dismissHelp || command.fire) { state.helpVisible = false; state.started = true; }
  aim(state, motionVector(state));
  if (command.fire) {
    const sizes = sizesFor(state.viewport);
    state.fires.push({
      id: state.nextFireId++,
      x: state.player.x + (sizes.player.width - sizes.fire.width) / 2,
      y: state.player.y + (sizes.player.height - sizes.fire.height) / 2,
      velocity: { x: state.player.direction.x * RULES.fireSpeed, y: state.player.direction.y * RULES.fireSpeed },
      ageMs: 0, fadingMs: null,
    });
  }
}

function contacts(state: GameState, elapsedMs: number): boolean {
  const sizes = sizesFor(state.viewport);
  const playerBounds = bounds(state.player, sizes.player);
  const remaining = state.items.filter(item => !intersects(playerBounds, bounds(item, sizes.item)));
  let changed = remaining.length !== state.items.length;
  state.items = remaining;
  state.collected = RULES.items - state.items.length;
  state.enemies.forEach(enemy => {
    enemy.hitCooldownMs = Math.max(0, enemy.hitCooldownMs - elapsedMs);
    const hitting = circlesIntersect(
      { x: state.player.x + sizes.player.width / 2, y: state.player.y + sizes.player.height / 2 },
      sizes.player.width * RULES.playerHitRadiusRatio,
      { x: enemy.x + sizes.enemy.width / 2, y: enemy.y + sizes.enemy.height / 2 },
      sizes.enemy.width * RULES.enemyHitRadiusRatio,
    );
    if (hitting !== enemy.hitting) changed = true;
    enemy.hitting = hitting;
    if (hitting && enemy.hitCooldownMs < 0.000001) {
      state.player.health = Math.max(0, state.player.health - RULES.damage);
      enemy.hitCooldownMs = RULES.damageIntervalMs;
      changed = true;
    }
  });
  if (!state.player.health) state.status = 'dead';
  else if (!state.items.length) state.status = 'won';
  if (state.status !== 'playing') {
    state.fires = [];
    state.motion = { kind: 'direction', vector: { x: 0, y: 0 } };
    return true;
  }
  return changed;
}

function advanceFires(state: GameState, elapsedMs: number): boolean {
  const changed = state.fires.length > 0;
  const sizes = sizesFor(state.viewport);
  for (const fire of state.fires) {
    fire.ageMs += elapsedMs;
    if (fire.fadingMs !== null) { fire.fadingMs += elapsedMs; continue; }
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
  return changed;
}

function step(state: GameState, elapsedMs: number): boolean {
  const player = state.player;
  const before = { x: player.x, y: player.y, angle: player.angle };
  const vector = motionVector(state);
  const distance = Math.hypot(vector.x, vector.y);
  aim(state, vector);
  if (distance > 0.000001) {
    const travel = Math.min(RULES.speed * elapsedMs / 1000, state.motion.kind === 'target' ? distance : Infinity);
    const direction = normalized(vector);
    player.x += direction.x * travel;
    player.y += direction.y * travel;
  }
  if (player.turnElapsed < RULES.turnMs) {
    player.turnElapsed = Math.min(RULES.turnMs, player.turnElapsed + elapsedMs);
    player.angle = player.turnFrom + (player.targetAngle - player.turnFrom) * player.turnElapsed / RULES.turnMs;
  }
  fitPlayer(state);
  const moved = player.x !== before.x || player.y !== before.y;
  if (moved) facePlayer(state);
  const contactChanged = contacts(state, elapsedMs);
  const fireChanged = state.status === 'playing' && advanceFires(state, elapsedMs);
  return moved || player.angle !== before.angle || contactChanged || fireChanged;
}

export function advanceGame(state: GameState, elapsedMs: number): boolean {
  if (state.status !== 'playing' || !state.started || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return false;
  let remaining = elapsedMs;
  let changed = false;
  // Bounded physics steps keep movement and contact timing stable at low FPS.
  while (remaining > 0.000001 && state.status === 'playing') {
    const delta = Math.min(remaining, 1000 / 120);
    changed = step(state, delta) || changed;
    remaining -= delta;
  }
  return changed;
}

export function resizeGame(state: GameState, viewport: Size): void {
  const previous = state.viewport;
  const sizes = sizesFor(viewport);
  [state.player, ...state.items, ...state.enemies].forEach(entity => {
    entity.x *= viewport.width / previous.width;
    entity.y *= viewport.height / previous.height;
  });
  state.viewport = { ...viewport };
  if (!state.started) {
    state.player.x = Math.round((viewport.width - sizes.player.width) / 2);
    state.player.y = Math.round((viewport.height - sizes.player.height) / 2);
  }
  state.player.angle = state.player.targetAngle;
  state.player.turnElapsed = RULES.turnMs;
  fitPlayer(state);
  state.items.forEach(item => fit(item, sizes.item, viewport));
  state.enemies.forEach(enemy => fit(enemy, sizes.enemy, viewport, true));
  if (!state.started) clearStartingArea(state);
  facePlayer(state);
}
