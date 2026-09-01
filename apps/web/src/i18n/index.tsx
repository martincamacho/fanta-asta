import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { messages, type Lang, type MessageKey } from './messages';

export type { Lang, MessageKey };

export const LANGS: readonly Lang[] = ['it', 'en', 'es'] as const;

/** Locale Intl por idioma (fechas/números). */
export const LOCALES: Record<Lang, string> = {
  it: 'it-IT',
  en: 'en-GB',
  es: 'es-AR',
};

const STORAGE_KEY = 'fanta:lang';

function isLang(v: unknown): v is Lang {
  return v === 'it' || v === 'en' || v === 'es';
}

/** localStorage > navigator.language (it/en/es) > 'it'. */
export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* sin storage */
  }
  try {
    const nav = navigator.language?.slice(0, 2).toLowerCase();
    if (isLang(nav)) return nav;
  } catch {
    /* sin navigator */
  }
  return 'it';
}

export type Params = Record<string, string | number>;
export type TFunc = (key: MessageKey, params?: Params) => string;

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

/** Idioma actual para código no-React (tabellone, mock). Lo sincroniza el provider. */
let currentLang: Lang = detectLang();

export function getLang(): Lang {
  return currentLang;
}

export function getLocale(): string {
  return LOCALES[currentLang];
}

/** t() para código fuera de React. */
export function translate(key: MessageKey, params?: Params): string {
  return format(messages[currentLang][key], params);
}

/** Mensaje de error localizado por código; si el código no está mapeado, el message del server. */
export function errorText(
  t: TFunc,
  payload: { code: string; message?: string } | null | undefined,
): string {
  if (!payload) return '';
  const key = `err.${payload.code}`;
  if (key in messages.it) return t(key as MessageKey);
  return payload.message ?? payload.code;
}

interface I18nContextValue {
  lang: Lang;
  locale: string;
  t: TFunc;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  useEffect(() => {
    currentLang = lang;
    try {
      document.documentElement.lang = lang;
      document.title = messages[lang]['app.title'];
    } catch {
      /* entorno sin DOM */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* sin storage */
    }
  }, []);

  const t = useCallback<TFunc>((key, params) => format(messages[lang][key], params), [lang]);

  const value = useMemo(
    () => ({ lang, locale: LOCALES[lang], t, setLang }),
    [lang, t, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT() fuera de <I18nProvider>');
  return ctx;
}
