import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceGame, applyCommand, createGame, resizeGame } from '../src/game.ts';
import { bounds, sizesFor } from '../src/geometry.ts';

function fixture() {
  const state = createGame({ width: 1280, height: 720 }, () => 0.9);
  Object.assign(state.player, { x: 100, y: 100, angle: 0, targetAngle: 0 });
  state.items.forEach(item => Object.assign(item, { x: 1000, y: 600 }));
  state.enemies.forEach(enemy => Object.assign(enemy, { x: 1100, y: 600, angle: 0 }));
  return state;
}

test('creation is deterministic and independent of DOM', () => {
  const state = createGame({ width: 1280, height: 720 }, () => 0.5);
  assert.deepEqual(state, createGame({ width: 1280, height: 720 }, () => 0.5));
  assert.equal(state.items.length, 10);
  assert.equal(state.enemies.length, 6);
  assert.equal(state.player.health, 100);
  assert.equal(state.player.x, 540);
  assert.equal(state.player.y, 260);
  assert.equal(state.status, 'playing');
});

test('movement steps 20 pixels per held axis and hides help', () => {
  const state = fixture();
  applyCommand(state, { directions: ['right', 'top'], fire: false });
  assert.equal(state.player.x, 120);
  assert.equal(state.player.y, 80);
  assert.equal(state.helpVisible, false);
  assert.equal(state.player.direction, 'top-right');
});

test('collecting gems updates the model and finishes only at ten', () => {
  const state = fixture();
  Object.assign(state.items[0]!, { x: 310, y: 150 });
  applyCommand(state, { directions: ['right'], fire: false });
  assert.equal(state.items.length, 9);
  assert.equal(state.collected, 1);
  assert.equal(state.status, 'playing');
  state.items.forEach(item => Object.assign(item, { x: 250, y: 150 }));
  applyCommand(state, { directions: ['right'], fire: false });
  assert.equal(state.collected, 10);
  assert.equal(state.status, 'won');
});

test('each overlapping enemy deals five damage per movement command', () => {
  const state = fixture();
  Object.assign(state.enemies[0]!, { x: 250, y: 150 });
  applyCommand(state, { directions: ['right'], fire: false });
  assert.equal(state.player.health, 95);
  assert.equal(state.enemies[0]!.hitting, true);
  state.enemies[0]!.x = 1000;
  applyCommand(state, { directions: ['right'], fire: false });
  assert.equal(state.player.health, 95);
  assert.equal(state.enemies[0]!.hitting, false);
});

test('death takes precedence over collecting the final gems', () => {
  const state = fixture();
  state.player.health = 5;
  state.items.forEach(item => Object.assign(item, { x: 250, y: 150 }));
  state.enemies.forEach(enemy => Object.assign(enemy, { x: 250, y: 150 }));
  applyCommand(state, { directions: ['right'], fire: true });
  assert.equal(state.player.health, 0);
  assert.equal(state.status, 'dead');
  assert.equal(state.fires.length, 0);
});

for (const status of ['dead', 'won'] as const) {
  test(`commands cannot change a ${status} game`, () => {
    const state = fixture();
    state.status = status;
    const before = structuredClone(state);
    applyCommand(state, { directions: ['right'], fire: true });
    advanceGame(state, 1000);
    assert.deepEqual(state, before);
  });
}

test('fire starts at the player center and travels 500 pixels per second', () => {
  const state = fixture();
  applyCommand(state, { directions: [], fire: true });
  assert.equal(state.helpVisible, false);
  assert.equal(state.fires.length, 1);
  assert.equal(state.fires[0]!.x, 175);
  assert.equal(state.fires[0]!.y, 175);
  advanceGame(state, 100);
  assert.equal(state.fires[0]!.y, 125);
  assert.equal(state.player.health, 100);
});

test('a projectile hits an enemy even when a frame crosses it entirely', () => {
  const state = fixture();
  Object.assign(state.enemies[0]!, { x: 175, y: 0 });
  applyCommand(state, { directions: [], fire: true });
  advanceGame(state, 1000);
  assert.equal(state.enemies.length, 5);
  assert.notEqual(state.fires[0]!.fadingMs, null);
  advanceGame(state, 1000);
  assert.equal(state.fires.length, 0);
});

test('fire hits the nearest enemy along its path, not array order', () => {
  const state = fixture();
  Object.assign(state.enemies[0]!, { x: 175, y: 0 });
  Object.assign(state.enemies[1]!, { x: 175, y: 80 });
  applyCommand(state, { directions: [], fire: true });
  advanceGame(state, 1000);
  assert.ok(state.enemies.some(enemy => enemy.id === 1));
  assert.ok(!state.enemies.some(enemy => enemy.id === 2));
});

test('fire expires after leaving the viewport and fading', () => {
  const state = fixture();
  applyCommand(state, { directions: [], fire: true });
  advanceGame(state, 2000);
  advanceGame(state, 1000);
  assert.equal(state.fires.length, 0);
});

test('resize preserves progress, identities and clamps rotated objects', () => {
  const state = fixture();
  state.player.health = 65;
  state.collected = 1;
  state.items.shift();
  const ids = [...state.items, ...state.enemies].map(entity => entity.id);
  applyCommand(state, { directions: ['right', 'top'], fire: false });
  for (const viewport of [{ width: 640, height: 180 }, { width: 80, height: 60 }, { width: 1280, height: 720 }]) {
    resizeGame(state, viewport);
    const sizes = sizesFor(viewport);
    for (const [entities, size] of [[state.items, sizes.item], [state.enemies, sizes.enemy], [[state.player], sizes.player]] as const) {
      for (const entity of entities) {
        const rect = bounds(entity, size);
        assert.ok(rect.x >= -0.001 && rect.y >= -0.001);
        assert.ok(rect.x + rect.width <= viewport.width + 0.001);
        assert.ok(rect.y + rect.height <= viewport.height + 0.001);
      }
    }
  }
  assert.deepEqual([...state.items, ...state.enemies].map(entity => entity.id), ids);
  assert.equal(state.player.health, 65);
  assert.equal(state.collected, 1);
});

test('player can reach an edge collectible after resize', () => {
  const state = fixture();
  resizeGame(state, { width: 640, height: 480 });
  Object.assign(state.player, { x: 200, y: 100 });
  Object.assign(state.items[0]!, { x: 0, y: 150 });
  for (let i = 0; i < 30; i++) applyCommand(state, { directions: ['left'], fire: false });
  assert.equal(state.collected, 1);
  assert.ok(state.player.x >= 0);
});

test('a turn near an edge keeps every intermediate frame on the field', () => {
  const state = fixture();
  state.enemies = [];
  state.player.x = 0;
  for (const direction of ['top', 'right', 'bottom', 'left'] as const) {
    applyCommand(state, { directions: [direction], fire: false });
    for (let i = 0; i < 30; i++) {
      advanceGame(state, 16);
      const rect = bounds(state.player, sizesFor(state.viewport).player);
      assert.ok(rect.x >= -0.001 && rect.y >= -0.001);
      assert.ok(rect.x + rect.width <= state.viewport.width + 0.001);
      assert.ok(rect.y + rect.height <= state.viewport.height + 0.001);
    }
  }
});
