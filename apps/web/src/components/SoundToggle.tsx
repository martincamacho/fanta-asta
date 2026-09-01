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
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? 'Silenciar sonidos' : 'Activar sonidos'}
      title={enabled ? 'Silenciar' : 'Activar sonido'}
      className={`rounded-lg border chalk-line px-2.5 py-1 text-base leading-none transition hover:bg-pitch-700 ${
        enabled ? '' : 'opacity-50'
      } ${className}`}
    >
      {enabled ? '🔊' : '🔇'}
    </button>
  );
}
