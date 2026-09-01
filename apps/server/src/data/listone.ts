import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES, type Player, type Role } from '@fanta/shared';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Directorio de datos (listone, players.json, campioncini). Override con env DATA_DIR. */
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(HERE, '../../../../data');
export const DEFAULT_LISTONE_PATH = path.join(DATA_DIR, 'listone-classic.csv');

/**
 * Carga el listone CSV (formato FantaBuzzer: C,T,M,Nome,Squadra,Quotazione,ID,EID).
 * Saltea filas de header (aunque aparezcan repetidas en medio del archivo),
 * filas con rol inválido o ID no numérico, y deduplica por id.
 */
export function loadListone(csvPath: string = DEFAULT_LISTONE_PATH): Player[] {
  const text = readFileSync(csvPath, 'utf8');
  const players: Player[] = [];
  const seen = new Set<number>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 7) continue;

    const [role, second, , name, team, quotStr, idStr] = cols;
    // Header (también los duplicados en medio del archivo): "C,T,M,Nome,..."
    if (role === 'C' && second === 'T') continue;
    if (!role || !ROLES.includes(role as Role)) continue;
    if (!idStr || !/^\d+$/.test(idStr)) continue;

    const id = Number(idStr);
    if (seen.has(id)) continue;
    seen.add(id);

    players.push({
      id,
      name: (name ?? '').trim(),
      team: (team ?? '').trim(),
      role: role as Role,
      quotazione: Number(quotStr) || 0,
    });
  }
  return players;
}

export function playersById(players: readonly Player[]): Map<number, Player> {
  return new Map(players.map((p) => [p.id, p]));
}

/** Normaliza un rol flexible (P/Por/Portiere, D/Dif/Difensore, C/Cen/Centrocampista, A/Att/Attaccante). */
function normalizeRole(raw: string | undefined): Role | null {
  const first = (raw ?? '').trim().charAt(0).toUpperCase();
  return ROLES.includes(first as Role) ? (first as Role) : null;
}

/**
 * Parsea el CSV de un listone propio de sala. Soporta:
 *  - formato clásico FantaBuzzer: C,T,M,Nome,Squadra,Quotazione,ID,EID (usa el ID si es numérico)
 *  - formato genérico: Nome,Squadra,Ruolo,Quotazione (con o sin header; quotazione default 1)
 * Filas sin ID reciben ids NEGATIVOS únicos y estables (-1, -2, … por orden de aparición)
 * para no chocar con los ids de fantacalcio.it.
 */
export function parseCustomListone(csv: string): Player[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Detección de formato: header clásico en cualquier parte, o primera fila con ≥7 columnas e ID numérico.
  const firstCols = split(lines[0]!);
  const isClassic =
    lines.some((l) => /^C\s*[,;]\s*T\s*[,;]\s*M\b/i.test(l)) ||
    (firstCols.length >= 7 && /^\d+$/.test((firstCols[6] ?? '').trim()));

  const players: Player[] = [];
  const seenIds = new Set<number>();
  let nextNegative = -1;

  for (const line of lines) {
    const cols = split(line);
    let name: string | undefined;
    let team: string | undefined;
    let role: Role | null = null;
    let quotStr: string | undefined;
    let id: number | null = null;

    if (isClassic) {
      if (/^C\s*[,;]\s*T\s*[,;]\s*M\b/i.test(line)) continue; // header (incluso repetido)
      if (cols.length < 5) continue;
      role = normalizeRole(cols[0]);
      name = cols[3];
      team = cols[4];
      quotStr = cols[5];
      const idStr = (cols[6] ?? '').trim();
      if (/^\d+$/.test(idStr)) id = Number(idStr);
    } else {
      // Genérico: Nome,Squadra,Ruolo,Quotazione — el header (si está) se detecta por palabras clave.
      if (/\b(nome|calciatore|squadra|ruolo|quotazione)\b/i.test(line) && normalizeRole(cols[2]) === null) {
        continue;
      }
      if (cols.length < 3) continue;
      name = cols[0];
      team = cols[1];
      role = normalizeRole(cols[2]);
      quotStr = cols[3];
    }

    if (!role || !name?.trim()) continue;
    if (id === null) id = nextNegative--;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const quotazione = Number((quotStr ?? '').trim());
    players.push({
      id,
      name: name.trim(),
      team: (team ?? '').trim(),
      role,
      quotazione: Number.isFinite(quotazione) && quotazione > 0 ? quotazione : 1,
    });
  }
  return players;
}

/** Split por coma o punto y coma (lo que domine en la línea). */
function split(line: string): string[] {
  const delim = (line.match(/;/g)?.length ?? 0) > (line.match(/,/g)?.length ?? 0) ? ';' : ',';
  return line.split(delim);
}
