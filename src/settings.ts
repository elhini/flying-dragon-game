export interface GameSettings {
  enemyCount: number;
  enemySpeed: number;
  enemyDamage: number;
}

export const DEFAULT_SETTINGS = { enemyCount: 6, enemySpeed: 60, enemyDamage: 5 } as const;
export const PRESETS = {
  calm: { enemyCount: 0, enemySpeed: 0, enemyDamage: 0 },
  easy: { enemyCount: 3, enemySpeed: 30, enemyDamage: 2 },
  normal: DEFAULT_SETTINGS,
} as const;

export function normalizeSettings(value: unknown): GameSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const number = (key: keyof GameSettings, step = 1) => {
    const raw = source[key];
    return typeof raw === 'number' && Number.isFinite(raw)
      ? Math.max(0, Math.min(DEFAULT_SETTINGS[key], Math.round(raw / step) * step))
      : DEFAULT_SETTINGS[key];
  };
  return { enemyCount: number('enemyCount'), enemySpeed: number('enemySpeed', 10), enemyDamage: number('enemyDamage') };
}
