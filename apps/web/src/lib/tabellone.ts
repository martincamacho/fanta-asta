/** Tabellone final como imagen PNG, renderizado client-side en canvas
 *  (estilo fantacalcio: navy, azul primary, naranja para la plata). */
import { budgetRemaining, spent, type Player, type Role, type RoomState } from '@fanta/shared';

const ROLE_FILL: Record<Role, string> = {
  P: 'hsl(41 100% 49%)',
  D: 'hsl(96 70% 42%)',
  C: 'hsl(217 93% 52%)',
  A: 'hsl(350 98% 65%)',
};

const CARD_W = 360;
const CARD_HEADER = 78;
const ROW_H = 26;
const GAP = 20;
const MARGIN = 36;
const TITLE_H = 96;

export function downloadTabellone(state: RoomState, players: ReadonlyMap<number, Player>): void {
  const teams = state.participants;
  if (teams.length === 0) return;
  const cols = Math.min(4, Math.max(1, teams.length <= 4 ? teams.length : Math.ceil(teams.length / 2)));
  const rows = Math.ceil(teams.length / cols);
  const maxRoster = Math.max(1, ...teams.map((t) => t.roster.length));
  const cardH = CARD_HEADER + maxRoster * ROW_H + 16;

  const width = MARGIN * 2 + cols * CARD_W + (cols - 1) * GAP;
  const height = TITLE_H + MARGIN + rows * cardH + (rows - 1) * GAP + MARGIN;

  const canvas = document.createElement('canvas');
  const scale = 2; // nitidez
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  // fondo navy nocturno
  ctx.fillStyle = 'hsl(230 28% 9%)';
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.2, -80, 0, width * 0.2, -80, width * 0.7);
  glow.addColorStop(0, 'hsl(217 93% 52% / 0.16)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // título
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = "bold 44px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  ctx.fillText('FANTA', MARGIN, 58);
  const w1 = ctx.measureText('FANTA ').width;
  ctx.fillStyle = 'hsl(19 95% 64%)';
  ctx.fillText('ASTA', MARGIN + w1, 58);
  ctx.fillStyle = 'hsl(228 20% 70%)';
  ctx.font = "16px 'Space Grotesk', system-ui, sans-serif";
  ctx.fillText(
    `${state.config.leagueName} · sala ${state.code} · ${new Date().toLocaleDateString('es-AR')}`,
    MARGIN,
    84,
  );

  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  teams.forEach((team, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (CARD_W + GAP);
    const y = TITLE_H + row * (cardH + GAP);

    // card
    ctx.fillStyle = 'hsl(230 25% 17%)';
    roundRect(x, y, CARD_W, cardH, 14);
    ctx.fill();
    ctx.strokeStyle = 'hsl(228 40% 95% / 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // header del equipo
    ctx.fillStyle = '#ffffff';
    ctx.font = "bold 24px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.fillText(truncate(ctx, team.name, CARD_W - 130), x + 16, y + 32);
    ctx.fillStyle = 'hsl(19 95% 64%)';
    ctx.font = "bold 24px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.textAlign = 'right';
    ctx.fillText(`${budgetRemaining(team, state.config)} cr`, x + CARD_W - 16, y + 32);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'hsl(228 20% 70%)';
    ctx.font = "13px 'Space Grotesk', system-ui, sans-serif";
    const bonus = team.budgetBonus !== 0
      ? ` · bonus ${team.budgetBonus > 0 ? '+' : '−'}${Math.abs(team.budgetBonus)}`
      : '';
    ctx.fillText(`${team.roster.length} jugadores · gastó ${spent(team)}${bonus}`, x + 16, y + 54);
    ctx.strokeStyle = 'hsl(228 40% 95% / 0.12)';
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 64);
    ctx.lineTo(x + CARD_W - 12, y + 64);
    ctx.stroke();

    // roster
    team.roster.forEach((entry, j) => {
      const ry = y + CARD_HEADER + j * ROW_H;
      const pl = players.get(entry.playerId);
      const role = pl?.role ?? 'C';
      ctx.fillStyle = ROLE_FILL[role];
      roundRect(x + 16, ry, 18, 18, 4);
      ctx.fill();
      ctx.fillStyle = 'hsl(230 28% 9%)';
      ctx.font = "bold 12px 'Space Grotesk', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText(role, x + 25, ry + 14);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'hsl(228 40% 95%)';
      ctx.font = "14px 'Space Grotesk', system-ui, sans-serif";
      ctx.fillText(truncate(ctx, pl?.name ?? `#${entry.playerId}`, CARD_W - 120), x + 44, ry + 14);
      ctx.fillStyle = 'hsl(19 95% 64%)';
      ctx.textAlign = 'right';
      ctx.font = "bold 15px 'Space Grotesk', system-ui, sans-serif";
      ctx.fillText(String(entry.price), x + CARD_W - 16, ry + 14);
      ctx.textAlign = 'left';
    });
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fanta-asta-${state.code}-tabellone.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}
