import { normalized } from './geometry.ts';
import type { Point } from './geometry.ts';

interface TouchOptions {
  isFinished: () => boolean;
  onDirection: (direction: Point | null) => void;
  onFire: () => void;
}

export function setupTouchControls({ isFinished, onDirection, onFire }: TouchOptions) {
  const controls = document.querySelector<HTMLElement>('#touch-controls');
  const joystick = document.querySelector<HTMLElement>('#joystick');
  const knob = document.querySelector<HTMLElement>('#joystick-knob');
  const fire = document.querySelector<HTMLButtonElement>('.touch-fire');
  if (!controls || !joystick || !knob || !fire) throw new Error('Touch controls are missing');
  const events = new AbortController();
  let stickOwner: number | null = null;
  let fireOwner: number | null = null;
  function releaseStick(): void {
    const id = stickOwner;
    stickOwner = null;
    joystick!.classList.remove('pressed');
    knob!.style.transform = 'translate(0px, 0px)';
    if (id === null) return;
    onDirection(null);
    if (joystick!.hasPointerCapture(id)) joystick!.releasePointerCapture(id);
  }
  function releaseFire(): void {
    const id = fireOwner;
    fireOwner = null;
    fire!.classList.remove('pressed');
    if (id !== null && fire!.hasPointerCapture(id)) fire!.releasePointerCapture(id);
  }
  function reset(): void { releaseStick(); releaseFire(); }
  const dispose = () => { reset(); events.abort(); };
  if (!window.matchMedia('(pointer: coarse)').matches) return { reset, dispose };

  controls.hidden = false;
  controls.addEventListener('contextmenu', event => event.preventDefault(), { signal: events.signal });
  function steer(event: PointerEvent): void {
    const rect = joystick!.getBoundingClientRect();
    const delta = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
    const length = Math.hypot(delta.x, delta.y);
    const direction = normalized(delta);
    const radius = Math.max(0, (rect.width - knob!.offsetWidth) / 2 - 8);
    const travel = Math.min(length, radius);
    knob!.style.transform = `translate(${direction.x * travel}px, ${direction.y * travel}px)`;
    onDirection(length <= 8 ? { x: 0, y: 0 } : direction);
  }
  joystick.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (stickOwner !== null || isFinished()) return;
    stickOwner = event.pointerId;
    joystick!.setPointerCapture(event.pointerId);
    joystick!.classList.add('pressed');
    steer(event);
  }, { signal: events.signal });
  joystick.addEventListener('pointermove', event => {
    if (event.pointerId !== stickOwner) return;
    if (isFinished()) releaseStick(); else steer(event);
  }, { signal: events.signal });
  fire.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (fireOwner !== null || isFinished()) return;
    fireOwner = event.pointerId;
    fire!.setPointerCapture(event.pointerId);
    fire!.classList.add('pressed');
    onFire();
  }, { signal: events.signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    joystick.addEventListener(type, event => { if (event.pointerId === stickOwner) releaseStick(); }, { signal: events.signal });
    fire.addEventListener(type, event => { if (event.pointerId === fireOwner) releaseFire(); }, { signal: events.signal });
  }
  window.addEventListener('blur', reset, { signal: events.signal });
  return { reset, dispose };
}
