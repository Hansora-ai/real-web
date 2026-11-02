import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

// On the phone, the login is kept in the app's own storage (not the web view's), so it survives app updates.
const nativeStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => { await Preferences.set({ key, value }); },
  removeItem: async (key: string) => { await Preferences.remove({ key }); },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !Capacitor.isNativePlatform(),
    storage: Capacitor.isNativePlatform() ? nativeStorage : undefined,
  },
});
