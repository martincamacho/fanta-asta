import { useEffect } from 'react';
import type { Player } from '@fanta/shared';
import { useProfile } from '../lib/profile';
import { useT } from '../i18n';
import { PlayerImg } from './PlayerImg';
import { RoleBadge } from './RoleBadge';
import { StatBadges } from './StatBadges';

/** Scheda del jugador estilo fantacalcio.it: card + badges MV/FM/FVM + datos + descripción. */
export function PlayerSheet({ player, onClose }: { player: Player; onClose: () => void }) {
  const profile = useProfile(player.id);
  const { t } = useT();

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: Array<[string, string | null]> = [
    [t('sheet.height'), profile?.height ?? null],
    [t('sheet.birth'), profile?.birthDate ?? null],
    [t('sheet.foot'), profile?.foot ?? null],
    [t('sheet.nationality'), profile?.nationality ?? null],
  ];
  const hasData = rows.some(([, v]) => v !== null);

  return (
    <div
      className="theme-light fixed inset-0 z-50 flex items-center justify-center bg-navy/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('admin.fichaOf', { name: player.name })}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-pitch-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* franja navy superior, como la scheda oficial */}
        <div className="theme-dark flex items-start gap-4 bg-navy p-5">
          <PlayerImg player={player} className="w-24 shrink-0 bg-white/10" />
          <div className="min-w-0 flex-1">
            <RoleBadge role={player.role} size="sm" full />
            <h2 className="mt-1 truncate font-display text-4xl font-bold uppercase leading-none text-white">
              {player.name}
            </h2>
            <p className="mt-1 text-sm text-chalk-dim">
              {player.team} · {t(`role.${player.role}`)} · {t('buzzer.quot')}{' '}
              <span className="tabular font-semibold text-white">{player.quotazione}</span>
            </p>
            <div className="mt-3">
              <StatBadges profile={profile} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('sheet.closeAria')}
            className="rounded-lg px-2 py-1 text-lg text-white/70 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[50dvh] overflow-y-auto p-5">
          {hasData ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {rows.map(([label, value]) =>
                value !== null ? (
                  <div key={label}>
                    <dt className="text-[11px] font-semibold uppercase tracking-widest text-chalk-faint">
                      {label}
                    </dt>
                    <dd className="text-sm font-semibold text-chalk">{value}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : (
            <p className="text-sm text-chalk-faint">
              {profile === null ? t('sheet.noProfile') : null}
            </p>
          )}
          {profile?.description && (
            <p className="mt-4 border-t chalk-line pt-3 text-sm leading-relaxed text-chalk-dim">
              {profile.description}
            </p>
          )}
          {profile?.url && (
            <a
              href={profile.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-semibold text-gold underline decoration-dotted"
            >
              {t('sheet.seeOn')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
