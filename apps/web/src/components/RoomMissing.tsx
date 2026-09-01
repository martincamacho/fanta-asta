import { Link } from 'react-router-dom';

export function RoomMissing({ code }: { code?: string }) {
  return (
    <div className="pitch-bg flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-display text-6xl font-bold uppercase tracking-wide text-chalk-dim">
        Fuera de juego
      </p>
      <p className="max-w-sm text-chalk-dim">
        La sala {code ? <span className="font-semibold text-chalk">{code.toUpperCase()}</span> : null} no
        existe o ya terminó. Revisá el código con el banditore.
      </p>
      <Link
        to="/"
        className="rounded-lg border chalk-line bg-pitch-800 px-6 py-3 font-display text-xl font-semibold uppercase tracking-wider text-chalk hover:bg-pitch-700"
      >
        Volver al inicio
      </Link>
    </div>
  );
}

/** Sala ligada a una liga de la que el usuario logueado no es miembro (403 del ticket). */
export function NotLeagueMember({ leagueName }: { leagueName?: string }) {
  return (
    <div className="pitch-bg flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-display text-6xl font-bold uppercase tracking-wide text-chalk-dim">
        No sos miembro
      </p>
      <p className="max-w-sm text-chalk-dim">
        Esta asta pertenece a la liga{' '}
        {leagueName ? <span className="font-semibold text-chalk">{leagueName}</span> : 'de otro grupo'}{' '}
        y solo pueden entrar sus miembros. Pedile una invitación al admin.
      </p>
      <Link
        to="/ligas"
        className="rounded-lg border chalk-line bg-pitch-800 px-6 py-3 font-display text-xl font-semibold uppercase tracking-wider text-chalk hover:bg-pitch-700"
      >
        Ir a mis ligas
      </Link>
    </div>
  );
}
