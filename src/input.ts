import type { Command, Motion } from './game.ts';
import { normalized } from './geometry.ts';
import type { Point } from './geometry.ts';

export type KeyCode = 32 | 37 | 38 | 39 | 40;
const physicalKeys: Record<string, KeyCode> = { Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

export function createInput(onCommand: (command: Command) => void) {
  const held = new Set<KeyCode>();
  let joystick: Point | null = null;
  let target: Point | null = null;
  function emit(fire = false, dismissHelp = false): void {
    const motion: Motion = joystick !== null
      ? { kind: 'direction', vector: { ...joystick } }
      : target !== null ? { kind: 'target', point: { ...target } }
        : { kind: 'direction', vector: normalized({ x: Number(held.has(39)) - Number(held.has(37)), y: Number(held.has(40)) - Number(held.has(38)) }) };
    onCommand({ motion, fire, dismissHelp });
  }
  return {
    press(code: KeyCode): void { held.add(code); emit(code === 32, true); },
    release(code: KeyCode): void { held.delete(code); emit(); },
    setJoystick(vector: Point | null): void { joystick = vector === null ? null : normalized(vector); emit(false, vector !== null); },
    setTarget(point: Point | null): void { target = point === null ? null : { ...point }; emit(false, point !== null); },
    fire(): void { emit(true, true); },
    reset(): void { held.clear(); joystick = null; target = null; emit(); },
  };
}

export function setupKeyboard(input: ReturnType<typeof createInput>, root: Document = document): () => void {
  const handle = (event: KeyboardEvent) => {
    const code = physicalKeys[event.code];
    if (code === undefined) return;
    if (event.type === 'keyup') input.release(code);
    if (event.target instanceof Element && event.target.closest('button')) return;
    event.preventDefault();
    if (event.type === 'keydown' && (!event.repeat || code === 32)) input.press(code);
  };
  root.addEventListener('keydown', handle);
  root.addEventListener('keyup', handle);
  return () => {
    root.removeEventListener('keydown', handle);
    root.removeEventListener('keyup', handle);
    input.reset();
  };
}
