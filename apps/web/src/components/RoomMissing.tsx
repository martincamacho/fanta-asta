import { Link } from 'react-router-dom';
import { useT } from '../i18n';

export function RoomMissing({ code }: { code?: string }) {
  const { t } = useT();
  return (
    <div className="pitch-bg flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-display text-6xl font-bold uppercase tracking-wide text-chalk-dim">
        {t('missing.title')}
      </p>
      <p className="max-w-sm text-chalk-dim">
        {t('missing.text', { code: code?.toUpperCase() ?? '—' })}
      </p>
      <Link
        to="/"
        className="rounded-lg border chalk-line bg-pitch-800 px-6 py-3 font-display text-xl font-semibold uppercase tracking-wider text-chalk hover:bg-pitch-700"
      >
        {t('missing.back')}
      </Link>
    </div>
  );
}

/** Sala ligada a una liga de la que el usuario logueado no es miembro (403 del ticket). */
export function NotLeagueMember({ leagueName }: { leagueName?: string }) {
  const { t } = useT();
  return (
    <div className="pitch-bg flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-display text-6xl font-bold uppercase tracking-wide text-chalk-dim">
        {t('notMember.title')}
      </p>
      <p className="max-w-sm text-chalk-dim">
        {t('notMember.text', { league: leagueName ?? t('notMember.otherLeague') })}
      </p>
      <Link
        to="/ligas"
        className="rounded-lg border chalk-line bg-pitch-800 px-6 py-3 font-display text-xl font-semibold uppercase tracking-wider text-chalk hover:bg-pitch-700"
      >
        {t('notMember.go')}
      </Link>
    </div>
  );
}
