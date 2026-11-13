import type { Command } from './game.ts';
import type { Direction } from './geometry.ts';

export type KeyCode = 32 | 37 | 38 | 39 | 40;
type Source = 'keyboard' | 'touch';
const directionKeys: readonly [KeyCode, Direction][] = [[37, 'left'], [38, 'top'], [39, 'right'], [40, 'bottom']];
const physicalKeys: Record<string, KeyCode> = { Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

export function isGameKey(code: number): code is KeyCode {
  return code === 32 || code === 37 || code === 38 || code === 39 || code === 40;
}

export function createInput(onCommand: (command: Command) => void) {
  const held: Record<Source, Set<KeyCode>> = { keyboard: new Set(), touch: new Set() };
  return {
    press(code: KeyCode, source: Source): void {
      held[source].add(code);
      const directions = directionKeys.filter(([key]) => held.keyboard.has(key) || held.touch.has(key)).map(([, direction]) => direction);
      onCommand({ directions, fire: code === 32 });
    },
    release(code: KeyCode, source: Source): void { held[source].delete(code); },
    reset(): void { held.keyboard.clear(); held.touch.clear(); },
  };
}

export function setupKeyboard(input: ReturnType<typeof createInput>, root: Document = document): () => void {
  const handle = (event: KeyboardEvent) => {
    const code = physicalKeys[event.code];
    if (code === undefined) return;
    if (event.type === 'keyup') input.release(code, 'keyboard');
    if (event.target instanceof Element && event.target.closest('button')) return;
    event.preventDefault();
    if (event.type === 'keydown') input.press(code, 'keyboard');
  };
  root.addEventListener('keydown', handle);
  root.addEventListener('keyup', handle);
  return () => {
    root.removeEventListener('keydown', handle);
    root.removeEventListener('keyup', handle);
    input.reset();
  };
}
