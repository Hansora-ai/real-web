import { useState, type FormEvent } from 'react';
import { IonContent, IonIcon, IonPage, IonSpinner, useIonToast } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { chevronBack, logoApple, mailOutline } from 'ionicons/icons';
import { useAuth, type OAuthProvider } from '../lib/auth';
import { useI18n } from '../i18n';
import { SITE_URL } from '../lib/config';
import { GoogleMark } from '../components/GoogleMark';

type Mode = 'start' | 'signIn' | 'signUp';

function friendlyError(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  const message = String((error as { message?: string })?.message || '');
  if (/invalid login credentials/i.test(message)) return t('login.wrongCredentials');
  if (/failed to fetch|network/i.test(message)) return t('common.offline');
  return message || t('common.error');
}

export function openSite(path: string) {
  const url = `${SITE_URL}${path}`;
  if (Capacitor.isNativePlatform()) void Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

export default function Login() {
  const { t } = useI18n();
  const auth = useAuth();
  const [toast] = useIonToast();
  const [mode, setMode] = useState<Mode>('start');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'' | OAuthProvider | 'email' | 'reset'>('');
  const [notice, setNotice] = useState('');

  const say = (message: string) => toast({ message, duration: 3500, position: 'top' });

  async function provider(name: OAuthProvider) {
    setBusy(name);
    try { await auth.signInWithProvider(name); }
    catch (error) { say(friendlyError(error, t)); }
    finally { setBusy(''); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'signUp' && password.length < 6) return say(t('login.passwordShort'));
    setBusy('email');
    setNotice('');
    try {
      if (mode === 'signIn') await auth.signInWithPassword(email.trim(), password);
      else if ((await auth.signUpWithPassword(email.trim(), password)) === 'confirm_email') {
        setNotice(t('login.confirmEmail', { email: email.trim() }));
        setMode('signIn');
      }
    } catch (error) { say(friendlyError(error, t)); }
    finally { setBusy(''); }
  }

  async function reset() {
    if (!email.trim()) return say(t('login.enterEmailFirst'));
    setBusy('reset');
    try { await auth.sendPasswordReset(email.trim()); setNotice(t('login.resetSent', { email: email.trim() })); }
    catch (error) { say(friendlyError(error, t)); }
    finally { setBusy(''); }
  }

  const [termsBefore, rest = ''] = t('login.terms').split('{terms}');
  const [termsMiddle, termsAfter = ''] = rest.split('{privacy}');

  return (
    <IonPage>
      <IonContent fullscreen className="login" scrollY>
        <div className="login-glow" aria-hidden="true" />
        <div className="login-wrap">
          {mode !== 'start' && (
            <button className="login-back" type="button" onClick={() => { setMode('start'); setNotice(''); }} aria-label={t('login.back')}>
              <IonIcon icon={chevronBack} />
            </button>
          )}

          <header className={`login-hero${mode === 'start' ? '' : ' compact'}`}>
            <div className="login-logo"><img src="logo.png" alt="" width="72" height="72" /></div>
            <h1>{t('login.title')}</h1>
            {mode === 'start' && <p>{t('login.subtitle')}</p>}
          </header>

          {mode === 'start' ? (
            <div className="login-actions">
              <button className="h-btn h-btn-light" type="button" disabled={!!busy} onClick={() => provider('google')}>
                {busy === 'google' ? <IonSpinner name="crescent" /> : <GoogleMark />}<span>{t('login.google')}</span>
              </button>
              <button className="h-btn h-btn-light" type="button" disabled={!!busy} onClick={() => provider('apple')}>
                {busy === 'apple' ? <IonSpinner name="crescent" /> : <IonIcon icon={logoApple} />}<span>{t('login.apple')}</span>
              </button>
              <div className="login-or"><span>{t('login.or')}</span></div>
              <button className="h-btn h-btn-ghost" type="button" disabled={!!busy} onClick={() => setMode('signIn')}>
                <IonIcon icon={mailOutline} /><span>{t('login.email')}</span>
              </button>
              <p className="login-note">{t('login.sameWay')}</p>
            </div>
          ) : (
            <form className="login-form" onSubmit={submit} noValidate>
              <div className="h-segment" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'signIn'} className={mode === 'signIn' ? 'on' : ''} onClick={() => setMode('signIn')}>{t('login.signIn')}</button>
                <button type="button" role="tab" aria-selected={mode === 'signUp'} className={mode === 'signUp' ? 'on' : ''} onClick={() => setMode('signUp')}>{t('login.createAccount')}</button>
              </div>
              <label className="h-field">
                <span>{t('login.emailLabel')}</span>
                <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required value={email} onChange={e => setEmail(e.target.value)} />
              </label>
              <label className="h-field">
                <span>{t('login.passwordLabel')}</span>
                <input type="password" autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'} enterKeyHint="go" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
              </label>
              {notice && <p className="login-notice" role="status">{notice}</p>}
              <button className="h-btn h-btn-primary" type="submit" disabled={!!busy || !email || !password}>
                {busy === 'email' ? <IonSpinner name="crescent" /> : <span>{mode === 'signIn' ? t('login.signIn') : t('login.createAccount')}</span>}
              </button>
              {mode === 'signIn' && (
                <button className="h-link" type="button" disabled={!!busy} onClick={reset}>{busy === 'reset' ? t('common.loading') : t('login.forgot')}</button>
              )}
            </form>
          )}

          <p className="login-terms">
            {termsBefore}
            <button type="button" className="h-inline-link" onClick={() => openSite('/termsofuse.html')}>{t('login.termsLink')}</button>
            {termsMiddle}
            <button type="button" className="h-inline-link" onClick={() => openSite('/policy.html')}>{t('login.privacyLink')}</button>
            {termsAfter}
          </p>
        </div>
      </IonContent>
    </IonPage>
  );
}
