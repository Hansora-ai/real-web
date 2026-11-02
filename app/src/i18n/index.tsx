import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import ru from './ru.json';
import hy from './hy.json';
import { getPref, setPref } from '../lib/prefs';

export type Lang = 'en' | 'ru' | 'hy';
type Key = keyof typeof en;

const dictionaries: Record<Lang, Record<string, string>> = { en, ru, hy };
export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'hy', name: 'Հայերեն' },
];

// The phone's language decides; anything we don't have falls back to English (never Armenian by default).
export function detectLanguage(list: readonly string[] = navigator.languages || [navigator.language]): Lang {
  for (const tag of list) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (base === 'ru' || base === 'hy' || base === 'en') return base;
  }
  return 'en';
}

export function translate(lang: Lang, key: Key, vars?: Record<string, string>): string {
  const text = dictionaries[lang][key] ?? en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '') : text;
}

type I18n = { lang: Lang; setLang: (lang: Lang) => void; t: (key: Key, vars?: Record<string, string>) => string };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLanguage());
  useEffect(() => {
    getPref('lang').then(saved => { if (saved === 'en' || saved === 'ru' || saved === 'hy') setLangState(saved); });
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((next: Lang) => { setLangState(next); void setPref('lang', next); }, []);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
