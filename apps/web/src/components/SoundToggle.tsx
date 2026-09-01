import { useT } from '../i18n';

/** Toggle 🔊/🔇 del banditore audible. */
export function SoundToggle({
  enabled,
  onToggle,
  className = '',
}: {
  enabled: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? t('sound.muteAria') : t('sound.unmuteAria')}
      title={enabled ? t('sound.muteTip') : t('sound.unmuteTip')}
      className={`rounded-lg border chalk-line px-2.5 py-1 text-base leading-none transition hover:bg-pitch-700 ${
        enabled ? '' : 'opacity-50'
      } ${className}`}
    >
      {enabled ? '🔊' : '🔇'}
    </button>
  );
}
