import { Preferences } from '@capacitor/preferences';

// Small settings that stay on this phone (language, theme, chosen AI employee).
const PREFIX = 'hansora.app.';

export async function getPref(key: string): Promise<string | null> {
  try { return (await Preferences.get({ key: PREFIX + key })).value; } catch { return null; }
}

export async function setPref(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await Preferences.remove({ key: PREFIX + key });
    else await Preferences.set({ key: PREFIX + key, value });
  } catch { /* storage unavailable: the app still works, the choice just isn't remembered */ }
}
