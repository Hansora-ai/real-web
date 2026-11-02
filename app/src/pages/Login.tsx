import { useState, type FormEvent } from 'react';
import { IonContent, IonIcon, IonPage, IonSpinner, useIonToast } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { chevronBack, eyeOffOutline, eyeOutline, logoApple } from 'ionicons/icons';
import { useAuth, type OAuthProvider } from '../lib/auth';
import { useI18n } from '../i18n';
import { SITE_URL } from '../lib/config';
import { GoogleMark } from '../components/GoogleMark';

type Mode = 'signIn' | 'signUp' | 'verify';
type Busy = '' | OAuthProvider | 'email' | 'reset' | 'resend';

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function friendlyError(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  const message = String((error as { message?: string })?.message || '');
  if (/invalid login credentials/i.test(message)) return t('login.wrongCredentials');
  if (/email not confirmed/i.test(message)) return t('login.emailNotConfirmed');
  if (/token has expired|invalid.*(otp|token)|otp.*(expired|invalid)/i.test(message)) return t('login.codeInvalid');
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
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<Busy>('');
  const [notice, setNotice] = useState('');

  const say = (message: string) => { void toast({ message, duration: 3500, position: 'top', color: 'dark' }); };
  const switchMode = (next: Mode) => { setMode(next); setNotice(''); setRepeat(''); setCode(''); };

  async function run(kind: Busy, task: () => Promise<void>) {
    setBusy(kind);
    try { await task(); } catch (error) { say(friendlyError(error, t)); } finally { setBusy(''); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (mode === 'verify') {
      if (!/^\d{6}$/.test(code.trim())) return say(t('login.codeInvalid'));
      return void run('email', () => auth.verifySignupCode(address, code.trim()));
    }
    if (!validEmail(address)) return say(t('login.invalidEmail'));
    if (mode === 'signIn') return void run('email', () => auth.signInWithPassword(address, password));
    if (password.length < 6) return say(t('login.passwordShort'));
    if (password !== repeat) return say(t('login.passwordsDiffer'));
    void run('email', async () => {
      const result = await auth.signUpWithPassword(address, password);
      if (result === 'may_exist') setNotice(t('login.emailMayExist'));
      if (result === 'verify_code') { setMode('verify'); setNotice(t('login.codeSent', { email: address })); }
    });
  }

  const [termsBefore, rest = ''] = t('login.terms').split('{terms}');
  const [termsMiddle, termsAfter = ''] = rest.split('{privacy}');
  const disabled = !!busy;

  return (
    <IonPage>
      <IonContent fullscreen className="login">
        <div className="login-glow" aria-hidden="true" />
        <div className="login-wrap">
          <header className="login-hero">
            {mode === 'verify' ? (
              <button className="login-back" type="button" onClick={() => switchMode('signUp')} aria-label={t('login.back')}>
                <IonIcon icon={chevronBack} />
              </button>
            ) : (
              <img className="login-logo" src="logo.png" alt="" width="44" height="44" />
            )}
            <h1>{mode === 'verify' ? t('login.verifyTitle') : mode === 'signUp' ? t('login.createTitle') : t('login.welcome')}</h1>
            <p>{mode === 'verify' ? t('login.codeSent', { email: email.trim() }) : t('login.subtitle')}</p>
          </header>

          <form className="login-form" onSubmit={submit} noValidate>
            {mode !== 'verify' && (
              <div className="h-segment" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'signIn'} className={mode === 'signIn' ? 'on' : ''} onClick={() => switchMode('signIn')}>{t('login.signIn')}</button>
                <button type="button" role="tab" aria-selected={mode === 'signUp'} className={mode === 'signUp' ? 'on' : ''} onClick={() => switchMode('signUp')}>{t('login.createAccount')}</button>
              </div>
            )}

            {mode === 'verify' ? (
              <label className="h-field">
                <span>{t('login.codeLabel')}</span>
                <input className="code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} enterKeyHint="go" placeholder="••••••"
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </label>
            ) : (
              <>
                <label className="h-field">
                  <span>{t('login.emailLabel')}</span>
                  <input type="email" inputMode="email" autoComplete={mode === 'signUp' ? 'email' : 'username'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    enterKeyHint="next" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                </label>
                <label className="h-field">
                  <span>{t('login.passwordLabel')}</span>
                  <div className="h-input-wrap">
                    <input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                      enterKeyHint={mode === 'signUp' ? 'next' : 'go'} value={password} onChange={e => setPassword(e.target.value)} />
                    <button type="button" className="h-eye" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}>
                      <IonIcon icon={showPassword ? eyeOffOutline : eyeOutline} />
                    </button>
                  </div>
                </label>
                {mode === 'signUp' && (
                  <label className="h-field">
                    <span>{t('login.repeatPassword')}</span>
                    <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" enterKeyHint="go" value={repeat} onChange={e => setRepeat(e.target.value)} />
                  </label>
                )}
              </>
            )}

            {notice && mode !== 'verify' && <p className="login-notice" role="status">{notice}</p>}

            <button className="h-btn h-btn-primary" type="submit" disabled={disabled}>
              {busy === 'email' ? <IonSpinner name="crescent" /> : <span>{mode === 'signIn' ? t('login.signIn') : mode === 'signUp' ? t('login.createAccount') : t('login.verify')}</span>}
            </button>

            {mode === 'signIn' && (
              <button className="h-link" type="button" disabled={disabled}
                onClick={() => validEmail(email) ? void run('reset', async () => { await auth.sendPasswordReset(email.trim()); setNotice(t('login.resetSent', { email: email.trim() })); }) : say(t('login.enterEmailFirst'))}>
                {busy === 'reset' ? t('common.loading') : t('login.forgot')}
              </button>
            )}
            {mode === 'verify' && (
              <button className="h-link" type="button" disabled={disabled}
                onClick={() => void run('resend', async () => { await auth.resendSignupCode(email.trim()); say(t('login.codeResent')); })}>
                {busy === 'resend' ? t('common.loading') : t('login.resendCode')}
              </button>
            )}
          </form>

          {mode !== 'verify' && (
            <div className="login-social">
              <div className="login-or"><span>{t('login.orContinue')}</span></div>
              <div className="social-row">
                <button className="h-btn h-btn-light social" type="button" disabled={disabled} onClick={() => void run('google', () => auth.signInWithProvider('google'))} aria-label={t('login.google')}>
                  {busy === 'google' ? <IonSpinner name="crescent" /> : <GoogleMark />}<span>Google</span>
                </button>
                <button className="h-btn h-btn-light social" type="button" disabled={disabled} onClick={() => void run('apple', () => auth.signInWithProvider('apple'))} aria-label={t('login.apple')}>
                  {busy === 'apple' ? <IonSpinner name="crescent" /> : <IonIcon icon={logoApple} />}<span>Apple</span>
                </button>
              </div>
              <p className="login-note">{t('login.sameWay')}</p>
            </div>
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
