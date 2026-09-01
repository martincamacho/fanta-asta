import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PlayerProfile } from '@fanta/shared';
import { DATA_DIR } from './listone.js';

export const DEFAULT_PROFILES_PATH = path.join(DATA_DIR, 'players.json');

/**
 * Carga las fichas extendidas de data/players.json (clave: id como string).
 * Si el archivo no existe, devuelve un mapa vacío (el endpoint responde 404 siempre)
 * y avisa por el callback `warn`.
 */
export function loadProfiles(
  jsonPath: string = DEFAULT_PROFILES_PATH,
  warn: (msg: string) => void = console.warn,
): Map<number, PlayerProfile> {
  const profiles = new Map<number, PlayerProfile>();
  if (!existsSync(jsonPath)) {
    warn(`players.json no encontrado en ${jsonPath}: /api/players/:id/profile responderá 404`);
    return profiles;
  }
  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, PlayerProfile>;
    for (const [key, profile] of Object.entries(raw)) {
      const id = Number(key);
      if (Number.isInteger(id) && profile && typeof profile === 'object') {
        profiles.set(id, profile);
      }
    }
  } catch (err) {
    warn(`players.json ilegible (${String(err)}): /api/players/:id/profile responderá 404`);
  }
  return profiles;
}
