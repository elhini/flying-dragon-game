import { isGameKey } from './input.ts';
import type { KeyCode } from './input.ts';

interface TouchOptions {
  isFinished: () => boolean;
  onKeyDown: (code: KeyCode) => void;
  onKeyUp: (code: KeyCode) => void;
}

export function setupTouchControls({ isFinished, onKeyDown, onKeyUp }: TouchOptions) {
  const controls = document.querySelector<HTMLElement>('#touch-controls');
  const activePointers = new Map<HTMLButtonElement, { code: KeyCode; pointerId: number; release: () => void }>();
  let movementInterval: ReturnType<typeof setInterval> | null = null;
  const reset = () => {
    for (const { release } of [...activePointers.values()]) release();
  };
  const listeners = new AbortController();
  const dispose = () => { reset(); listeners.abort(); };
  if (!controls) throw new Error('Touch controls are missing');
  if (!window.matchMedia('(pointer: coarse)').matches) {
    return { reset, dispose };
  }

  controls.hidden = false;
  controls.addEventListener('contextmenu', event => event.preventDefault(), { signal: listeners.signal });
  const updateMovementLoop = () => {
    const direction = [...activePointers.values()].find(active => active.code !== 32);
    if (!direction) {
      if (movementInterval !== null) clearInterval(movementInterval);
      movementInterval = null;
    } else if (movementInterval === null) {
      // One keyboard event moves along every held direction once per tick.
      movementInterval = setInterval(() => {
        if (isFinished()) {
          reset();
          return;
        }
        const active = [...activePointers.values()].find(pointer => pointer.code !== 32);
        if (active) onKeyDown(active.code);
      }, 110);
    }
  };

  controls.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => {
    const code = Number(button.dataset.key);
    if (!isGameKey(code)) throw new Error('Invalid touch control key');
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (activePointers.has(button) || isFinished()) return;
      button.setPointerCapture(event.pointerId);
      const release = () => {
        const active = activePointers.get(button);
        if (!active) return;
        activePointers.delete(button);
        button.classList.remove('pressed');
        onKeyUp(code);
        updateMovementLoop();
      };
      activePointers.set(button, { code, pointerId: event.pointerId, release });
      button.classList.add('pressed');
      onKeyDown(code);
      updateMovementLoop();
    }, { signal: listeners.signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, (event: Event) => {
        const active = activePointers.get(button);
        if (event instanceof PointerEvent && active?.pointerId === event.pointerId) active.release();
      }, { signal: listeners.signal });
    }
  });

  window.addEventListener('blur', reset, { signal: listeners.signal });
  return { reset, dispose };
}
