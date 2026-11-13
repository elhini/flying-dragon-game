import './style.css';
import { advanceGame, applyCommand, createGame, resizeGame } from './game.ts';
import { createInput, setupKeyboard } from './input.ts';
import { setupTouchControls } from './touch-controls.ts';
import { createView, element } from './view.ts';

const viewport = () => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
let state = createGame(viewport());
let previous: number | undefined;
const view = createView();
const input = createInput(command => {
  applyCommand(state, command);
  if (state.status !== 'playing') resetInput();
  view.render(state);
});
const removeKeyboard = setupKeyboard(input);
const touch = setupTouchControls({
  isFinished: () => state.status !== 'playing',
  onKeyDown: code => input.press(code, 'touch'),
  onKeyUp: code => input.release(code, 'touch'),
});
function resetInput(): void { input.reset(); touch.reset(); }

const events = new AbortController();
element<HTMLButtonElement>('#close-game-help').addEventListener('click', event => {
  (event.currentTarget as HTMLButtonElement).blur();
  state.helpVisible = false;
  view.render(state);
}, { signal: events.signal });
document.querySelectorAll<HTMLButtonElement>('.game-restart').forEach(button => {
  button.addEventListener('click', () => {
    resetInput();
    state = createGame(viewport());
    previous = undefined;
    button.blur();
    view.render(state);
  }, { signal: events.signal });
});
window.addEventListener('resize', () => {
  resizeGame(state, viewport());
  view.render(state);
}, { signal: events.signal });
window.addEventListener('blur', resetInput, { signal: events.signal });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetInput();
}, { signal: events.signal });

let frameId = 0;
function frame(now: number): void {
  // Resume a hidden tab without simulating an unbounded backlog of frames.
  if (previous !== undefined && !document.hidden && advanceGame(state, Math.min(now - previous, 100))) {
    view.render(state);
  }
  previous = now;
  frameId = requestAnimationFrame(frame);
}
view.render(state);
frameId = requestAnimationFrame(frame);

// Vite replaces this module during development; release all listeners and timers.
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(frameId);
  events.abort();
  removeKeyboard();
  touch.dispose();
});
