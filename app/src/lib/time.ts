import type { useI18n } from '../i18n';

type T = ReturnType<typeof useI18n>['t'];

export function relativeTime(value: string | number, t: T): string {
  const at = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.minutes', { n: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { n: String(hours) });
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
