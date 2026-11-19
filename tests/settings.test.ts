import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceGame, applyCommand, createGame } from '../src/game.ts';

const viewport = { width: 1600, height: 1200 };
function start(state: ReturnType<typeof createGame>) {
  applyCommand(state, { motion: { kind: 'direction', vector: { x: 0, y: 0 } }, fire: false, start: true });
}

test('configured enemy counts include a peaceful game while keeping ten gems', () => {
  for (const enemyCount of [0, 2, 6]) {
    const state = createGame(viewport, () => 0.9, { enemyCount, enemySpeed: 20, enemyDamage: 1 });
    assert.equal(state.enemies.length, enemyCount);
    assert.equal(state.items.length, 10);
  }
});

test('enemy speed can be reduced independently down to stationary enemies', () => {
  for (const enemySpeed of [0, 20, 60]) {
    const state = createGame(viewport, () => 0.9, { enemyCount: 1, enemySpeed, enemyDamage: 5 });
    Object.assign(state.player, { x: 700, y: 500 });
    Object.assign(state.enemies[0]!, { x: 1165, y: 565 });
    start(state);
    advanceGame(state, 1000);
    assert.ok(Math.abs(state.enemies[0]!.x - (1165 - enemySpeed)) < 0.00001);
  }
});

test('enemy damage can be reduced independently down to zero', () => {
  for (const enemyDamage of [0, 1, 5]) {
    const state = createGame(viewport, () => 0.9, { enemyCount: 1, enemySpeed: 0, enemyDamage });
    Object.assign(state.player, { x: 700, y: 500 });
    Object.assign(state.enemies[0]!, { x: 900, y: 565 });
    start(state);
    advanceGame(state, 1000);
    assert.equal(state.player.health, 100 - 4 * enemyDamage);
    assert.equal(state.enemies[0]!.hitting, true);
  }
});

test('a peaceful game is won by collecting the gems', () => {
  const state = createGame(viewport, () => 0.9, { enemyCount: 0, enemySpeed: 0, enemyDamage: 0 });
  state.items.forEach(item => Object.assign(item, state.player));
  start(state);
  advanceGame(state, 1);
  assert.equal(state.status, 'won');
  assert.equal(state.collected, 10);
});

test('each game owns a snapshot of validated settings', () => {
  const settings = { enemyCount: 2, enemySpeed: 20, enemyDamage: 1 };
  const state = createGame(viewport, () => 0.9, settings);
  settings.enemyDamage = 5;
  assert.deepEqual(state.settings, { enemyCount: 2, enemySpeed: 20, enemyDamage: 1 });
  const invalid = createGame(viewport, () => 0.9, { enemyCount: 999, enemySpeed: -10, enemyDamage: NaN });
  assert.deepEqual(invalid.settings, { enemyCount: 6, enemySpeed: 0, enemyDamage: 5 });
  const fractional = createGame(viewport, () => 0.9, { enemyCount: 1.7, enemySpeed: 25, enemyDamage: 2.8 });
  assert.deepEqual(fractional.settings, { enemyCount: 2, enemySpeed: 30, enemyDamage: 3 });
});
