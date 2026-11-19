import { DEFAULT_SETTINGS, normalizeSettings, PRESETS } from './settings.ts';
import type { GameSettings } from './settings.ts';
import { element } from './view.ts';

const storageKey = 'flying-dragon-game:settings';

export function loadSettings(): GameSettings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function setupSettings(onStart: (settings: GameSettings) => void) {
  const dialog = element<HTMLDialogElement>('#game-settings');
  const form = element<HTMLFormElement>('#game-settings form');
  const updateButton = element<HTMLButtonElement>('#update-game');
  const fields = {
    enemyCount: element<HTMLInputElement>('#enemy-count'),
    enemySpeed: element<HTMLInputElement>('#enemy-speed'),
    enemyDamage: element<HTMLInputElement>('#enemy-damage'),
  };
  const presets = dialog.querySelectorAll<HTMLButtonElement>('[data-preset]');
  const events = new AbortController();
  const read = (): GameSettings => normalizeSettings(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.valueAsNumber])));
  function render(settings: GameSettings): void {
    const labels = {
      enemyCount: String(settings.enemyCount),
      enemySpeed: `${Math.round(settings.enemySpeed / DEFAULT_SETTINGS.enemySpeed * 100)}%`,
      enemyDamage: `${Math.round(settings.enemyDamage / DEFAULT_SETTINGS.enemyDamage * 100)}%`,
    };
    for (const key of Object.keys(fields) as (keyof GameSettings)[]) {
      fields[key].value = String(settings[key]);
      fields[key].setAttribute('aria-valuetext', labels[key]);
      element(`#${fields[key].id}-value`).textContent = labels[key];
    }
    for (const button of presets) {
      const preset = PRESETS[button.dataset.preset as keyof typeof PRESETS];
      button.setAttribute('aria-pressed', String(Object.keys(fields).every(key => preset[key as keyof GameSettings] === settings[key as keyof GameSettings])));
    }
  }
  form.addEventListener('input', () => render(read()), { signal: events.signal });
  for (const button of presets) button.addEventListener('click', () => {
    render(PRESETS[button.dataset.preset as keyof typeof PRESETS]);
  }, { signal: events.signal });
  // A new game always starts explicitly with the Play button.
  dialog.addEventListener('cancel', event => event.preventDefault(), { signal: events.signal });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const settings = read();
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); }
    catch { /* Storage restrictions must not prevent playing. */ }
    dialog.close();
    document.body.append(updateButton);
    onStart(settings);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, { signal: events.signal });
  return {
    open(settings: GameSettings): void {
      render(settings);
      // A modal makes outside elements inert; keep the update action in its top layer.
      dialog.append(updateButton);
      if (!dialog.open) dialog.showModal();
    },
    dispose(): void { events.abort(); dialog.close(); document.body.append(updateButton); },
  };
}
