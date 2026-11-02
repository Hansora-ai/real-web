import { IonApp, IonIcon, IonLabel, IonRouterOutlet, IonSpinner, IonTabBar, IonTabButton, IonTabs } from '@ionic/react';
import { IonReactHashRouter, IonReactRouter } from '@ionic/react-router';
import { Capacitor } from '@capacitor/core';
import { Navigate, Route } from 'react-router-dom';
import { chatbubbles, personCircle, receipt, sparkles } from 'ionicons/icons';
import { useAuth } from './lib/auth';
import { useI18n } from './i18n';
import Login from './pages/Login';
import Account from './pages/Account';
import StepPreview from './components/StepPreview';

// Inside the installed app normal paths work; the browser preview on Netlify uses #/paths so reloads never 404.
const Router = Capacitor.isNativePlatform() ? IonReactRouter : IonReactHashRouter;

function Tabs() {
  const { t } = useI18n();
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route path="/inbox" element={<StepPreview title={t('tabs.inbox')} heading={t('preview.inbox.title')} body={t('preview.inbox.body')} icon={chatbubbles} />} />
        <Route path="/orders" element={<StepPreview title={t('tabs.orders')} heading={t('preview.orders.title')} body={t('preview.orders.body')} icon={receipt} />} />
        <Route path="/create" element={<StepPreview title={t('tabs.create')} heading={t('preview.create.title')} body={t('preview.create.body')} icon={sparkles} />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </IonRouterOutlet>
      <IonTabBar slot="bottom" translucent>
        <IonTabButton tab="inbox" href="/inbox"><IonIcon icon={chatbubbles} aria-hidden="true" /><IonLabel>{t('tabs.inbox')}</IonLabel></IonTabButton>
        <IonTabButton tab="orders" href="/orders"><IonIcon icon={receipt} aria-hidden="true" /><IonLabel>{t('tabs.orders')}</IonLabel></IonTabButton>
        <IonTabButton tab="create" href="/create"><IonIcon icon={sparkles} aria-hidden="true" /><IonLabel>{t('tabs.create')}</IonLabel></IonTabButton>
        <IonTabButton tab="account" href="/account"><IonIcon icon={personCircle} aria-hidden="true" /><IonLabel>{t('tabs.account')}</IonLabel></IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
}

export default function App() {
  const { ready, session } = useAuth();
  return (
    <IonApp>
      {!ready ? (
        <div className="boot"><img src="logo.png" alt="Hansora" width="64" height="64" /><IonSpinner name="crescent" /></div>
      ) : session ? (
        <Router><Tabs /></Router>
      ) : (
        <Login />
      )}
    </IonApp>
  );
}
