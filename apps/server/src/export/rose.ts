import ExcelJS from 'exceljs';
import {
  ROLES,
  budgetRemaining,
  rosterTarget,
  spent,
  type Player,
  type Role,
  type RoomState,
} from '@fanta/shared';

/** Orden P→D→C→A (como ROLES del shared). */
const ROLE_ORDER: Record<Role, number> = { P: 0, D: 1, C: 2, A: 3 };

/** Escapa un campo CSV solo si hace falta (coma, comillas o salto de línea). */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV compatible con el import REAL de Leghe Fantacalcio (verificado
 * empíricamente): "una riga per calciatore, nel formato squadra,id,costo" —
 * separado por comas, SIN header, una línea por compra, en orden participante →
 * orden de compra. Los jugadores de listone propio (id negativo) no existen en
 * Leghe: se excluyen del archivo, sin comentarios (romperían su parser).
 */
export function buildRoseCsv(state: RoomState): string {
  const lines: string[] = [];
  for (const participant of state.participants) {
    // El parser de Leghe es naif: comas o saltos de línea en el nombre lo romperían.
    const squadra = participant.name.replace(/[,\r\n]+/g, ' ').trim();
    for (const entry of participant.roster) {
      if (entry.playerId < 0) continue;
      lines.push(`${squadra},${entry.playerId},${entry.price}`);
    }
  }
  return lines.length > 0 ? `${lines.join('\r\n')}\r\n` : '';
}

/** Filas del export (sin header): una por compra, orden participante → rol P→D→C→A. */
function roseRows(
  state: RoomState,
  players: ReadonlyMap<number, Player>,
): Array<[string, string, string, string, number]> {
  const rows: Array<[string, string, string, string, number]> = [];
  for (const participant of state.participants) {
    const entries = [...participant.roster].sort((a, b) => {
      const pa = players.get(a.playerId);
      const pb = players.get(b.playerId);
      return (pa ? ROLE_ORDER[pa.role] : 99) - (pb ? ROLE_ORDER[pb.role] : 99);
    });
    for (const entry of entries) {
      const player = players.get(entry.playerId);
      rows.push([
        participant.name,
        player?.name ?? `#${entry.playerId}`,
        player?.role ?? '',
        player?.team ?? '',
        entry.price,
      ]);
    }
  }
  return rows;
}

/**
 * XLSX con dos hojas: "Rose" (misma data que el CSV) y "Resumen"
 * (equipo, gastado, restante con bonus, cupos por rol llenos/target).
 */
export async function buildRoseXlsx(
  state: RoomState,
  players: ReadonlyMap<number, Player>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const rose = wb.addWorksheet('Rose');
  rose.columns = [
    { header: 'Fantasquadra', key: 'squad', width: 24 },
    { header: 'Calciatore', key: 'player', width: 26 },
    { header: 'Ruolo', key: 'role', width: 8 },
    { header: 'Squadra', key: 'team', width: 18 },
    { header: 'Crediti', key: 'price', width: 10 },
  ];
  rose.getRow(1).font = { bold: true };
  for (const row of roseRows(state, players)) rose.addRow(row);

  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Equipo', key: 'team', width: 24 },
    { header: 'Gastado', key: 'spent', width: 10 },
    { header: 'Restante', key: 'left', width: 10 },
    ...ROLES.map((r) => ({ header: r, key: r, width: 8 })),
    { header: 'Plantilla', key: 'total', width: 12 },
  ];
  resumen.getRow(1).font = { bold: true };
  for (const p of state.participants) {
    const byRole: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
    for (const e of p.roster) {
      const player = players.get(e.playerId);
      if (player) byRole[player.role] += 1;
    }
    resumen.addRow([
      p.name,
      spent(p),
      budgetRemaining(p, state.config), // incluye budgetBonus
      ...ROLES.map((r) => `${byRole[r]}/${state.config.slots[r]}`),
      `${p.roster.length}/${rosterTarget(state.config)}`,
    ]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
