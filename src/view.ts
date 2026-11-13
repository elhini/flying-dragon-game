import { RULES } from './game.ts';
import type { GameState, Sprite } from './game.ts';
import { sizesFor } from './geometry.ts';
import type { Point, Size } from './geometry.ts';

export function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing game element: ${selector}`);
  return found;
}

function place(node: HTMLElement, point: Point, size: Size): void {
  Object.assign(node.style, { left: `${point.x}px`, top: `${point.y}px`, width: `${size.width}px`, height: `${size.height}px` });
}

export function createView() {
  const player = element('#player');
  const field = element('#field');
  const help = element('#game-help');
  const won = element('#game-won');
  const dead = element('#game-over');
  const itemsText = element('#items-scale-text');
  const itemsFill = element('#items-scale-fill');
  const healthText = element('#player-health-scale-text');
  const healthFill = element('#player-health-scale-fill');
  const items = new Map<number, HTMLDivElement>();
  const enemies = new Map<number, HTMLDivElement>();
  const fires = new Map<number, HTMLDivElement>();

  function sync<T extends { id: number }>(cache: Map<number, HTMLDivElement>, entities: readonly T[], className: string, update: (node: HTMLDivElement, entity: T) => void): void {
    const ids = new Set(entities.map(entity => entity.id));
    for (const [id, node] of cache) {
      if (!ids.has(id)) { node.remove(); cache.delete(id); }
    }
    for (const entity of entities) {
      let node = cache.get(entity.id);
      if (!node) {
        node = document.createElement('div');
        node.className = className;
        node.dataset.id = String(entity.id);
        field.append(node);
        cache.set(entity.id, node);
      }
      update(node, entity);
    }
  }

  const sprite = (node: HTMLDivElement, entity: Sprite, size: Size) => {
    place(node, entity, size);
    node.dataset.type = String(entity.type);
  };

  return {
    render(state: GameState): void {
      const sizes = sizesFor(state.viewport);
      place(player, state.player, sizes.player);
      player.style.transform = `rotate(${state.player.angle}deg)`;
      player.classList.toggle('finished', state.status !== 'playing');
      player.classList.toggle('dead', state.status === 'dead');
      player.classList.toggle('won', state.status === 'won');
      help.hidden = !state.helpVisible;
      won.hidden = state.status !== 'won';
      dead.hidden = state.status !== 'dead';
      itemsText.textContent = `${state.collected} / ${RULES.items}`;
      itemsFill.style.width = `${100 * state.collected / RULES.items}%`;
      healthText.textContent = `${state.player.health} / ${RULES.health}`;
      healthFill.style.width = `${100 * state.player.health / RULES.health}%`;
      sync(items, state.items, 'item', (node, item) => sprite(node, item, sizes.item));
      sync(enemies, state.enemies, 'enemy', (node, enemy) => {
        sprite(node, enemy, sizes.enemy);
        node.style.transform = `rotate(${enemy.angle}deg)`;
        node.classList.toggle('hitting', enemy.hitting);
      });
      sync(fires, state.fires, 'fire', (node, fire) => {
        place(node, fire, sizes.fire);
        const fade = fire.fadingMs === null ? 0 : fire.fadingMs / RULES.fadeMs;
        node.style.opacity = String(fire.fadingMs === null ? Math.min(1, fire.ageMs / 200) : 1 - fade);
        node.style.transform = `scale(${1 + fade})`;
      });
    },
  };
}
