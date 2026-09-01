import { useStore } from '../store';
import { participantName } from '../lib/format';
import { RoleBadge } from './RoleBadge';

/** Feed "Assegnazioni": historial de ventas/asignaciones de la sesión (v1: en memoria). */
export function AssignmentsPanel({ className = '' }: { className?: string }) {
  const assignments = useStore((s) => s.assignments);
  const players = useStore((s) => s.players);
  const state = useStore((s) => s.state);
  if (assignments.length === 0) return null;

  return (
    <details className={`rounded-2xl border chalk-line bg-pitch-800/80 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="font-display text-xl font-bold uppercase text-chalk">Assegnazioni</span>
        <span className="tabular rounded bg-pitch-700 px-2 py-0.5 text-xs font-bold text-chalk-dim">
          {assignments.length}
        </span>
      </summary>
      <ul className="max-h-64 space-y-1 overflow-y-auto border-t chalk-line px-4 py-3">
        {[...assignments].reverse().map((a, i) => {
          const player = players.get(a.playerId);
          return (
            <li key={`${a.at}-${a.playerId}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="tabular shrink-0 text-xs text-chalk-faint">
                {new Date(a.at).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              {player && <RoleBadge role={player.role} size="sm" />}
              <span className="min-w-0 flex-1 truncate text-chalk">
                {player?.name ?? `#${a.playerId}`}
                <span className="text-chalk-faint"> → </span>
                <span className="text-chalk-dim">{participantName(state, a.participantId)}</span>
                {a.manual && (
                  <span className="ml-1 rounded bg-role-p/15 px-1 text-[10px] font-bold uppercase text-role-p">
                    manual
                  </span>
                )}
              </span>
              <span className="tabular shrink-0 font-display text-base font-bold text-gold">
                {a.price}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
