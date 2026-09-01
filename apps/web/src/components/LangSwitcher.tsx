import { LANGS, useT } from '../i18n';

/** Selector de idioma IT/EN/ES — cambio instantáneo, sin recargar. */
export function LangSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useT();
  return (
    <span
      role="group"
      aria-label={t('lang.label')}
      className={`inline-flex items-center rounded-lg border chalk-line ${compact ? '' : 'gap-0.5 p-0.5'}`}
    >
      {!compact && <span className="px-1 text-xs" aria-hidden="true">🌐</span>}
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider transition ${
            lang === l ? 'bg-gold text-pitch-950' : 'text-chalk-dim hover:text-chalk'
          }`}
        >
          {l}
        </button>
      ))}
    </span>
  );
}
