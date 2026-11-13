import type { Point } from './geometry.ts';

interface PointerOptions { isFinished: () => boolean; onTarget: (point: Point | null) => void }

export function setupPointerControls({ isFinished, onTarget }: PointerOptions) {
  const surface = document.documentElement;
  const events = new AbortController();
  let owner: number | null = null;
  function reset(): void {
    const id = owner;
    owner = null;
    if (id === null) return;
    onTarget(null);
    if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  }
  function start(event: PointerEvent): void {
    if ((event.pointerType !== 'mouse' && event.pointerType !== 'touch') || event.button !== 0 || !(event.buttons & 1) || owner !== null || isFinished()) return;
    if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, #touch-controls')) return;
    event.preventDefault();
    owner = event.pointerId;
    surface.setPointerCapture(owner);
    onTarget({ x: event.clientX, y: event.clientY });
  }
  document.addEventListener('pointerdown', start, { signal: events.signal });
  document.addEventListener('pointermove', event => {
    // Additional mouse buttons report pointermove rather than pointerdown.
    if (owner === null && event.pointerType === 'mouse') start(event);
    if (event.pointerId !== owner) return;
    if (!(event.buttons & 1) || isFinished()) { reset(); return; }
    onTarget({ x: event.clientX, y: event.clientY });
  }, { signal: events.signal });
  document.addEventListener('pointerup', event => {
    if (event.pointerId === owner && !(event.buttons & 1)) reset();
  }, { signal: events.signal });
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    document.addEventListener(type, event => { if (event.pointerId === owner) reset(); }, { signal: events.signal });
  }
  // Native long-press menus can arrive after pointer ownership has been cleared.
  document.addEventListener('contextmenu', event => event.preventDefault(), { signal: events.signal });
  window.addEventListener('blur', reset, { signal: events.signal });
  return { reset, dispose: () => { reset(); events.abort(); } };
}
