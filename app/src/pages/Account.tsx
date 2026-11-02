import { useEffect, useState } from 'react';
import {
  IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonPage, IonRefresher,
  IonRefresherContent, IonSkeletonText, IonTitle, IonToolbar, useIonActionSheet, useIonAlert,
  type RefresherEventDetail,
} from '@ionic/react';
import {
  briefcaseOutline, contrastOutline, documentTextOutline, flash, helpBuoyOutline, languageOutline,
  logOutOutline, shieldCheckmarkOutline,
} from 'ionicons/icons';
import { useAuth } from '../lib/auth';
import { useI18n, LANGUAGES } from '../i18n';
import { formatCredits } from '../lib/credits';
import { useBusiness } from '../automation/business';
import { loadTheme, saveTheme, type ThemeChoice } from '../lib/theme';
import { openSite } from './Login';

const APP_VERSION = '0.1.0';

export default function Account() {
  const { t, lang, setLang } = useI18n();
  const auth = useAuth();
  const [sheet] = useIonActionSheet();
  const [alert] = useIonAlert();
  const { employees, businessId, choose, reload } = useBusiness();
  const [theme, setTheme] = useState<ThemeChoice>('dark');

  useEffect(() => { void loadTheme().then(setTheme); }, []);

  async function refresh(event: CustomEvent<RefresherEventDetail>) {
    await Promise.all([reload(), auth.refreshProfile().catch(() => undefined)]);
    event.detail.complete();
  }

  const current = employees?.find(item => item.id === businessId);

  function chooseEmployee() {
    if (!employees?.length) {
      void alert({ header: t('account.aiEmployee'), message: t('account.noAiEmployeeBody'), buttons: [t('common.done')] });
      return;
    }
    void sheet({
      header: t('account.chooseAiEmployee'),
      buttons: [
        ...employees.map(item => ({
          text: `${item.id === businessId ? '✓ ' : ''}${item.name}${item.instagram ? ` · ${item.instagram}` : ''}`,
          handler: () => choose(item.id),
        })),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
  }

  function chooseLanguage() {
    void sheet({
      header: t('account.language'),
      buttons: [
        ...LANGUAGES.map(item => ({ text: `${item.code === lang ? '✓ ' : ''}${item.name}`, handler: () => setLang(item.code) })),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
  }

  function chooseTheme() {
    const options: ThemeChoice[] = ['dark', 'light', 'system'];
    void sheet({
      header: t('account.appearance'),
      buttons: [
        ...options.map(option => ({
          text: `${option === theme ? '✓ ' : ''}${t(`account.theme.${option}`)}`,
          handler: () => { setTheme(option); void saveTheme(option); },
        })),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
  }

  function signOut() {
    void alert({
      header: t('account.signOut'),
      message: t('account.signOutConfirm'),
      buttons: [{ text: t('common.cancel'), role: 'cancel' }, { text: t('account.signOut'), role: 'destructive', handler: () => { void auth.signOut(); } }],
    });
  }

  const email = auth.session?.user?.email || '';
  const credits = auth.profile ? formatCredits(auth.profile.credits) : null;

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar><IonTitle>{t('account.title')}</IonTitle></IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="grouped">
        <IonRefresher slot="fixed" onIonRefresh={refresh}><IonRefresherContent /></IonRefresher>
        <IonHeader collapse="condense">
          <IonToolbar><IonTitle size="large">{t('account.title')}</IonTitle></IonToolbar>
        </IonHeader>

        <section className="credits-card" aria-label={t('account.credits')}>
          <div className="credits-top">
            <span className="credits-label"><IonIcon icon={flash} />{t('account.credits')}</span>
            {email && <span className="credits-email">{email}</span>}
          </div>
          <div className="credits-value">{credits ?? <IonSkeletonText animated style={{ width: 96, height: 34 }} />}</div>
          <p>{t('account.creditsHint')}</p>
        </section>

        <IonList inset>
          <IonItem button detail onClick={chooseEmployee}>
            <IonIcon slot="start" icon={briefcaseOutline} aria-hidden="true" />
            <IonLabel className="row"><span>{t('account.aiEmployee')}</span><span className="row-value">{employees === null ? <IonSkeletonText animated style={{ width: 80 }} /> : current?.name || t('account.noAiEmployee')}</span></IonLabel>
          </IonItem>
        </IonList>

        <IonListHeader className="group-title">{t('account.section.preferences')}</IonListHeader>
        <IonList inset>
          <IonItem button detail onClick={chooseLanguage}>
            <IonIcon slot="start" icon={languageOutline} aria-hidden="true" />
            <IonLabel className="row"><span>{t('account.language')}</span><span className="row-value">{LANGUAGES.find(item => item.code === lang)?.name}</span></IonLabel>
          </IonItem>
          <IonItem button detail onClick={chooseTheme} lines="none">
            <IonIcon slot="start" icon={contrastOutline} aria-hidden="true" />
            <IonLabel className="row"><span>{t('account.appearance')}</span><span className="row-value">{t(`account.theme.${theme}`)}</span></IonLabel>
          </IonItem>
        </IonList>

        <IonListHeader className="group-title">{t('account.section.about')}</IonListHeader>
        <IonList inset>
          <IonItem button detail onClick={() => openSite('/termsofuse.html')}>
            <IonIcon slot="start" icon={documentTextOutline} aria-hidden="true" />
            <IonLabel>{t('account.terms')}</IonLabel>
          </IonItem>
          <IonItem button detail onClick={() => openSite('/policy.html')}>
            <IonIcon slot="start" icon={shieldCheckmarkOutline} aria-hidden="true" />
            <IonLabel>{t('account.privacy')}</IonLabel>
          </IonItem>
          <IonItem button detail onClick={() => openSite('/contact.html')}>
            <IonIcon slot="start" icon={helpBuoyOutline} aria-hidden="true" />
            <IonLabel>{t('account.support')}</IonLabel>
          </IonItem>
          <IonItem lines="none">
            <IonLabel className="row"><span>{t('account.version')}</span><span className="row-value">{APP_VERSION}</span></IonLabel>
          </IonItem>
        </IonList>

        <IonList inset>
          <IonItem button onClick={signOut} lines="none" className="danger-row">
            <IonIcon slot="start" icon={logOutOutline} aria-hidden="true" />
            <IonLabel>{t('account.signOut')}</IonLabel>
          </IonItem>
        </IonList>
        <div className="safe-bottom" />
      </IonContent>
    </IonPage>
  );
}
