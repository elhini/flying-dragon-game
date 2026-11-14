import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceGame, applyCommand, createGame, resizeGame } from '../src/game.ts';
import type { GameState } from '../src/game.ts';
import { bounds, intersects, sizesFor } from '../src/geometry.ts';

function fixture() {
  const state = createGame({ width: 1280, height: 720 }, () => 0.9);
  Object.assign(state.player, { x: 100, y: 100, angle: 0, targetAngle: 0 });
  state.items.forEach(item => Object.assign(item, { x: 1000, y: 600 }));
  state.enemies.forEach(enemy => Object.assign(enemy, { x: 1100, y: 600, angle: 0 }));
  return state;
}
function steer(state: GameState, x: number, y: number, fire = false) {
  applyCommand(state, { motion: { kind: 'direction', vector: { x, y } }, fire, dismissHelp: true });
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`); }

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

test('the initial area is empty even when random repeatedly chooses the center', () => {
  for (const [width, height, margin] of [[1280, 720, 20], [390, 844, 19.5], [240, 240, 12], [80, 60, 3], [120, 900, 6], [337, 49, 2.45]] as const) {
    let calls = 0;
    const state = createGame({ width, height }, () => {
      if (++calls > 1000) throw new Error('Spawn must not keep retrying the same random position');
      return 0.5;
    });
    const sizes = sizesFor(state.viewport);
    const safe = { x: state.player.x - margin, y: state.player.y - margin, width: sizes.player.width + 2 * margin, height: sizes.player.height + 2 * margin };
    assert.equal(state.items.length, 10);
    assert.equal(state.enemies.length, 6);
    for (const [entities, size] of [[state.items, sizes.item], [state.enemies, sizes.enemy]] as const) {
      for (const entity of entities) {
        const rect = bounds(entity, size);
        assert.equal(intersects(rect, safe), false, `${width}x${height}: occupied starting area`);
        assert.ok(rect.x >= -0.001 && rect.y >= -0.001);
        assert.ok(rect.x + rect.width <= width + 0.001 && rect.y + rect.height <= height + 0.001);
      }
    }
  }
});

test('rotating before the first interaction keeps the starting area empty', () => {
  const state = createGame({ width: 390, height: 844 }, () => 0.5);
  resizeGame(state, { width: 844, height: 390 });
  steer(state, 0, 0, true);
  advanceGame(state, 1);
  assert.equal(state.status, 'playing');
  assert.equal(state.collected, 0);
  assert.equal(state.player.health, 100);
});

test('200px player and 70px enemy damage circles touch at 135px, scaling with small screens', () => {
  for (const [viewport, enemyX, enemyY] of [
    [{ width: 1280, height: 720 }, 300, 165],
    // At 240x240 the sprites are 84px and 35px; contact is at 59.5px.
    [{ width: 240, height: 240 }, 184, 124.5],
  ] as const) {
    for (const angle of [0, 45, 90, 147]) {
      const state = fixture();
      state.viewport = { ...viewport };
      Object.assign(state.player, { angle, targetAngle: angle });
      Object.assign(state.enemies[0]!, { x: enemyX + 0.01, y: enemyY });
      steer(state, 0, 0);
      advanceGame(state, 1);
      assert.equal(state.player.health, 100);
      assert.equal(state.enemies[0]!.hitting, false);
      state.enemies[0]!.x = enemyX;
      advanceGame(state, 1);
      assert.equal(state.player.health, 95);
      assert.equal(state.enemies[0]!.hitting, true);
    }
  }
});

test('steering accepts an arbitrary angle and advances continuously at 180px/s', () => {
  const state = fixture();
  steer(state, 3, 4);
  assert.equal(state.player.x, 100);
  assert.equal(state.helpVisible, false);
  advanceGame(state, 1000);
  close(state.player.x, 208);
  close(state.player.y, 244);
  close(state.player.targetAngle, 143.130102354156);
});

test('diagonal and arbitrary directions have the same speed as cardinal movement', () => {
  for (const [x, y] of [[1, 0], [1, 1], [3, 4]]) {
    const state = fixture();
    steer(state, x!, y!);
    advanceGame(state, 1000);
    close(Math.hypot(state.player.x - 100, state.player.y - 100), 180);
  }
});

test('movement distance is independent of frame rate', () => {
  for (const frames of [1, 30, 60, 144]) {
    const state = fixture();
    steer(state, 1, 0);
    for (let i = 0; i < frames; i++) advanceGame(state, 1000 / frames);
    close(state.player.x, 280);
  }
});

test('a mouse target is reached without overshoot or oscillation', () => {
  const state = fixture();
  applyCommand(state, { motion: { kind: 'target', point: { x: 250, y: 230 } }, fire: false, dismissHelp: true });
  advanceGame(state, 1000);
  close(state.player.x, 150);
  close(state.player.y, 130);
  advanceGame(state, 1000);
  close(state.player.x, 150);
  close(state.player.y, 130);
});

test('release and repeated input events cannot add movement steps', () => {
  const state = fixture();
  for (let i = 0; i < 50; i++) steer(state, 1, 0);
  close(state.player.x, 100);
  advanceGame(state, 100);
  close(state.player.x, 118);
  steer(state, 0, 0);
  advanceGame(state, 1000);
  close(state.player.x, 118);
});

test('initial help gives protection until the first gameplay interaction', () => {
  const state = fixture();
  state.enemies.forEach(enemy => Object.assign(enemy, { x: 150, y: 150 }));
  advanceGame(state, 5000);
  assert.equal(state.player.health, 100);
  applyCommand(state, { motion: { kind: 'direction', vector: { x: 0, y: 0 } }, fire: false, dismissHelp: false });
  advanceGame(state, 1000);
  assert.equal(state.player.health, 100);
  steer(state, 0, 0);
  advanceGame(state, 1);
  assert.equal(state.player.health, 70);
});

test('collecting gems updates the model and finishes only at ten', () => {
  const state = fixture();
  Object.assign(state.items[0]!, { x: 310, y: 150 });
  steer(state, 1, 0);
  advanceGame(state, 100);
  assert.equal(state.items.length, 9);
  assert.equal(state.collected, 1);
  assert.equal(state.status, 'playing');
  state.items.forEach(item => Object.assign(item, { x: 250, y: 150 }));
  advanceGame(state, 1);
  assert.equal(state.collected, 10);
  assert.equal(state.status, 'won');
});

test('contact damage has a 250ms interval independent of event frequency', () => {
  const state = fixture();
  Object.assign(state.enemies[0]!, { x: 150, y: 150 });
  steer(state, 0, 0);
  advanceGame(state, 1);
  assert.equal(state.player.health, 95);
  for (let i = 0; i < 50; i++) steer(state, 0, 0);
  advanceGame(state, 100);
  assert.equal(state.player.health, 95);
  advanceGame(state, 150);
  assert.equal(state.player.health, 90);
  state.enemies[0]!.x = 1000;
  advanceGame(state, 1000);
  assert.equal(state.player.health, 90);
  assert.equal(state.enemies[0]!.hitting, false);
});

test('contact damage is stable at different frame rates', () => {
  for (const frames of [1, 30, 60, 144]) {
    const state = fixture();
    Object.assign(state.enemies[0]!, { x: 150, y: 150 });
    steer(state, 0, 0);
    for (let i = 0; i < frames; i++) advanceGame(state, 1000 / frames);
    assert.equal(state.player.health, 80);
  }
});

test('death takes precedence over collecting the final gems', () => {
  const state = fixture();
  state.player.health = 5;
  state.items.forEach(item => Object.assign(item, { x: 150, y: 150 }));
  state.enemies.forEach(enemy => Object.assign(enemy, { x: 150, y: 150 }));
  steer(state, 0, 0);
  advanceGame(state, 1);
  assert.equal(state.player.health, 0);
  assert.equal(state.status, 'dead');
  assert.equal(state.fires.length, 0);
});

for (const status of ['dead', 'won'] as const) {
  test(`commands cannot change a ${status} game`, () => {
    const state = fixture();
    state.status = status;
    const before = structuredClone(state);
    steer(state, 1, 0, true);
    advanceGame(state, 1000);
    assert.deepEqual(state, before);
  });
}

test('fire uses the full heading vector and the same speed at any angle', () => {
  const state = fixture();
  steer(state, 3, -4, true);
  const fire = state.fires[0]!;
  assert.equal(fire.x, 175);
  assert.equal(fire.y, 175);
  close(fire.velocity.x, 300);
  close(fire.velocity.y, -400);
  advanceGame(state, 100);
  close(fire.x, 205);
  close(fire.y, 135);
});

test('fire keeps the last heading after movement stops', () => {
  const state = fixture();
  steer(state, 3, -4);
  steer(state, 0, 0, true);
  close(state.fires[0]!.velocity.x, 300);
  close(state.fires[0]!.velocity.y, -400);
});

test('a projectile hits the nearest enemy and cannot tunnel through it', () => {
  const state = fixture();
  Object.assign(state.enemies[0]!, { x: 175, y: 0 });
  Object.assign(state.enemies[1]!, { x: 175, y: 75 });
  steer(state, 0, 0, true);
  advanceGame(state, 400);
  assert.ok(state.enemies.some(enemy => enemy.id === 1));
  assert.ok(!state.enemies.some(enemy => enemy.id === 2));
  advanceGame(state, 1200);
  assert.equal(state.fires.length, 0);
});

test('fire expires after leaving the viewport and fading', () => {
  const state = fixture();
  steer(state, 0, 0, true);
  advanceGame(state, 2500);
  assert.equal(state.fires.length, 0);
});

test('resize preserves progress, identities and clamps rotated objects', () => {
  const state = fixture();
  state.player.health = 65;
  state.collected = 1;
  state.items.shift();
  const ids = [...state.items, ...state.enemies].map(entity => entity.id);
  steer(state, 3, -7);
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

test('arbitrary turns and movement near edges stay on the field', () => {
  const state = fixture();
  state.enemies = [];
  state.player.x = 0;
  for (const [x, y] of [[-3, -7], [5, -3], [7, 1], [3, 7], [-4, 5], [-7, 2]]) {
    steer(state, x!, y!);
    for (let i = 0; i < 60; i++) {
      advanceGame(state, 16);
      const rect = bounds(state.player, sizesFor(state.viewport).player);
      assert.ok(rect.x >= -0.001 && rect.y >= -0.001);
      assert.ok(rect.x + rect.width <= state.viewport.width + 0.001);
      assert.ok(rect.y + rect.height <= state.viewport.height + 0.001);
    }
  }
});
