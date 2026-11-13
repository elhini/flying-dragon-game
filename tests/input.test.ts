import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInput } from '../src/input.ts';
import type { Command } from '../src/game.ts';

function fixture() {
  const commands: Command[] = [];
  return { commands, input: createInput(command => commands.push(command)) };
}
test('keyboard fallback combines and normalizes held arrows', () => {
  const { input, commands } = fixture();
  input.press(39);
  input.press(38);
  const motion = commands.at(-1)!.motion;
  assert.equal(motion.kind, 'direction');
  if (motion.kind === 'direction') {
    assert.ok(Math.abs(motion.vector.x - Math.SQRT1_2) < 0.000001);
    assert.ok(Math.abs(motion.vector.y + Math.SQRT1_2) < 0.000001);
  }
  input.release(38);
  assert.deepEqual(commands.at(-1)!.motion, { kind: 'direction', vector: { x: 1, y: 0 } });
});
test('mouse targets take precedence until release then fall back to held arrows', () => {
  const { input, commands } = fixture();
  input.press(39);
  input.setTarget({ x: 300, y: 400 });
  assert.deepEqual(commands.at(-1)!.motion, { kind: 'target', point: { x: 300, y: 400 } });
  input.setTarget(null);
  assert.deepEqual(commands.at(-1)!.motion, { kind: 'direction', vector: { x: 1, y: 0 } });
});
test('joystick owns continuous direction without releasing physical keys', () => {
  const { input, commands } = fixture();
  input.press(39);
  input.setJoystick({ x: 3, y: 4 });
  assert.deepEqual(commands.at(-1)!.motion, { kind: 'direction', vector: { x: 0.6, y: 0.8 } });
  input.setJoystick({ x: 0, y: 0 });
  assert.deepEqual(commands.at(-1)!.motion, { kind: 'direction', vector: { x: 0, y: 0 } });
  input.setJoystick(null);
  assert.deepEqual(commands.at(-1)!.motion, { kind: 'direction', vector: { x: 1, y: 0 } });
});
test('firing keeps the active movement source intact', () => {
  const { input, commands } = fixture();
  input.setJoystick({ x: 3, y: -4 });
  input.fire();
  assert.equal(commands.at(-1)!.fire, true);
  assert.deepEqual(commands.at(-1)!.motion, { kind: 'direction', vector: { x: 0.6, y: -0.8 } });
});
test('reset clears every source and release alone does not dismiss initial help', () => {
  const { input, commands } = fixture();
  input.release(39);
  assert.equal(commands.at(-1)!.dismissHelp, false);
  input.press(39);
  input.setJoystick({ x: 1, y: 0 });
  input.setTarget({ x: 100, y: 200 });
  input.reset();
  assert.deepEqual(commands.at(-1), { motion: { kind: 'direction', vector: { x: 0, y: 0 } }, fire: false, dismissHelp: false });
});
