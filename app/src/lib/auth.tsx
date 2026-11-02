import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';
import { getOrCreateProfile, type Profile } from './account';
import { NATIVE_AUTH_REDIRECT, SITE_URL } from './config';
import { setPref } from './prefs';

export type OAuthProvider = 'google' | 'apple';

type AuthState = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<'signed_in' | 'verify_code' | 'may_exist'>;
  verifySignupCode: (email: string, code: string) => Promise<void>;
  resendSignupCode: (email: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithProvider: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Google does not allow its login inside an app's own web view, so on the phone we open the system
// browser and come back through the co.hansora.app:// link.
async function nativeOAuth(provider: OAuthProvider) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (data?.url) await Browser.open({ url: data.url, presentationStyle: 'popover' });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session); setReady(true); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setReady(true); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  // Returning from Google/Apple in the system browser.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapApp.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(NATIVE_AUTH_REDIRECT)) return;
      const code = new URL(url).searchParams.get('code');
      try { await Browser.close(); } catch { /* already closed */ }
      if (code) await supabase.auth.exchangeCodeForSession(code);
    });
    return () => { void listener.then(handle => handle.remove()); };
  }, []);

  const userId = session?.user?.id;
  const refreshProfile = useCallback(async () => {
    if (!session?.user) { setProfile(null); return; }
    setProfile(await getOrCreateProfile(session.user));
  }, [session?.user]);

  useEffect(() => {
    if (!userId) { setProfile(null); return; }
    refreshProfile().catch(() => { /* shown as a retry on the Account screen */ });
  }, [userId, refreshProfile]);

  const value = useMemo<AuthState>(() => ({
    ready,
    session,
    profile,
    refreshProfile,
    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    // Same as the website's sign-up (public/header.js): a 6-digit code is emailed, then verified here.
    async signUpWithPassword(email, password) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { hansora_auth_provider: 'email' } } });
      if (error) throw error;
      // Supabase hides whether an email is taken: an existing account comes back with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'may_exist';
      return data.session ? 'signed_in' : 'verify_code';
    },
    async verifySignupCode(email, code) {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw error;
    },
    async resendSignupCode(email) {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
    },
    async sendPasswordReset(email) {
      // Same reset page as the website.
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${SITE_URL}/profile.html?password_recovery=1` });
      if (error) throw error;
    },
    async signInWithProvider(provider) {
      if (Capacitor.isNativePlatform()) return nativeOAuth(provider);
      const redirectTo = window.location.href.split('#')[0];
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) throw error;
    },
    async signOut() {
      await supabase.auth.signOut({ scope: 'local' });
      await setPref('business', null);
    },
  }), [ready, session, profile, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth outside AuthProvider');
  return value;
}
