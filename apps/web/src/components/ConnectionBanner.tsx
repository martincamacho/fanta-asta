import { useStore } from '../store';
import { useT } from '../i18n';

/** Banner global: visible cuando el socket se cayó y está reconectando. */
export function ConnectionBanner() {
  const connection = useStore((s) => s.connection);
  const { t } = useT();
  if (connection !== 'reconnecting') return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-danger/90 px-4 py-2 text-sm font-semibold text-pitch-950"
    >
      <span className="inline-block h-2 w-2 animate-pulse-danger rounded-full bg-pitch-950" />
      {t('conn.reconnecting')}
    </div>
  );
}
