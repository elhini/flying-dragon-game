import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInput } from '../src/input.ts';
import type { Command } from '../src/game.ts';

test('releasing touch does not release the same key held on the keyboard', () => {
  const commands: Command[] = [];
  const input = createInput(command => commands.push(command));
  input.press(39, 'keyboard');
  input.press(39, 'touch');
  input.release(39, 'touch');
  input.press(38, 'keyboard');
  assert.deepEqual(commands.at(-1), { directions: ['top', 'right'], fire: false });
});

test('reset clears held keys so returning to the game cannot resume movement', () => {
  const commands: Command[] = [];
  const input = createInput(command => commands.push(command));
  input.press(39, 'touch');
  input.reset();
  input.press(32, 'keyboard');
  assert.deepEqual(commands.at(-1), { directions: [], fire: true });
});
