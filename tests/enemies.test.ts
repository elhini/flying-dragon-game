import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceGame, applyCommand, createGame, resizeGame } from '../src/game.ts';
import { bounds, sizesFor } from '../src/geometry.ts';

function fixture() {
  const state = createGame({ width: 1600, height: 1200 }, () => 0.9);
  Object.assign(state.player, { x: 700, y: 500 });
  state.items.forEach(item => Object.assign(item, { x: 0, y: 30 }));
  state.enemies = state.enemies.slice(0, 1);
  Object.assign(state.enemies[0]!, { x: 1165, y: 565 });
  return state;
}
function start(state: ReturnType<typeof createGame>): void {
  applyCommand(state, { motion: { kind: 'direction', vector: { x: 0, y: 0 } }, fire: false, dismissHelp: true });
}
function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
}

test('enemies wait for the first gameplay action even after the help is closed', () => {
  const state = fixture();
  state.helpVisible = false;
  const before = structuredClone(state.enemies);
  advanceGame(state, 5000);
  assert.deepEqual(state.enemies, before);
  start(state);
  assert.equal(advanceGame(state, 100), true);
  assert.ok(state.enemies[0]!.x < before[0]!.x);
});

test('enemies pursue at 60px/s in any direction and turn toward the dragon', () => {
  for (const [x, y, angle] of [[1, 0, 90], [0, 1, -180], [0.6, 0.8, -216.869897645844], [-0.6, 0.8, -143.130102354156]] as const) {
    const state = fixture();
    const enemy = state.enemies[0]!;
    Object.assign(enemy, { x: 800 + 400 * x - 35, y: 600 + 400 * y - 35 });
    const before = { x: enemy.x, y: enemy.y };
    start(state);
    advanceGame(state, 1000);
    close(enemy.x, before.x - 60 * x);
    close(enemy.y, before.y - 60 * y);
    // Compare headings modulo a full turn.
    close(((enemy.angle - angle + 180) % 360 + 360) % 360 - 180, 0);
    assert.equal(state.player.health, 100);
  }
});

test('enemies stop at attack range and remain still between hits', () => {
  const state = fixture();
  const enemy = state.enemies[0]!;
  enemy.x = 905; // Centers are 140px apart; attack range is 135px.
  start(state);
  advanceGame(state, 100);
  close(enemy.x, 900);
  assert.equal(enemy.hitting, true);
  assert.equal(state.player.health, 95);
  const stopped = { x: enemy.x, y: enemy.y };
  advanceGame(state, 100);
  assert.deepEqual({ x: enemy.x, y: enemy.y }, stopped);
  assert.equal(state.player.health, 95);
  advanceGame(state, 150);
  assert.deepEqual({ x: enemy.x, y: enemy.y }, stopped);
  assert.equal(state.player.health, 90);
});

test('enemies resume pursuit and change direction when the dragon leaves attack range', () => {
  const state = fixture();
  const enemy = state.enemies[0]!;
  enemy.x = 900;
  start(state);
  advanceGame(state, 100);
  assert.equal(enemy.hitting, true);
  const stopped = { x: enemy.x, y: enemy.y };
  state.player.y = 100;
  advanceGame(state, 100);
  assert.ok(enemy.x < stopped.x);
  assert.ok(enemy.y < stopped.y);
  close(Math.hypot(enemy.x - stopped.x, enemy.y - stopped.y), 6);
  assert.equal(enemy.hitting, false);
  assert.equal(state.player.health, 95);
});

test('enemy movement and repeated attacks stay stable across frame rates', () => {
  for (const frames of [1, 30, 60, 144]) {
    const state = fixture();
    state.enemies[0]!.x = 905;
    start(state);
    for (let i = 0; i < frames; i++) advanceGame(state, 1000 / frames);
    close(state.enemies[0]!.x, 900);
    assert.equal(state.player.health, 80);
    assert.equal(state.enemies[0]!.hitting, true);
  }
});

test('pursuit stops at the scaled attack radius after a viewport resize', () => {
  const state = fixture();
  resizeGame(state, { width: 240, height: 240 });
  Object.assign(state.player, { x: 78, y: 78 });
  Object.assign(state.enemies[0]!, { x: 190, y: 100 });
  start(state);
  advanceGame(state, 1000);
  const enemy = state.enemies[0]!;
  close(Math.hypot(enemy.x + 17.5 - 120, enemy.y + 17.5 - 120), 59.5);
  assert.equal(enemy.hitting, true);
  const rect = bounds(enemy, sizesFor(state.viewport).enemy);
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 240 && rect.y + rect.height <= 240);
});

test('enemies cannot keep pursuing after death or victory', () => {
  for (const status of ['dead', 'won'] as const) {
    const state = fixture();
    start(state);
    state.status = status;
    const before = structuredClone(state);
    assert.equal(advanceGame(state, 1000), false);
    assert.deepEqual(state, before);
  }
});
