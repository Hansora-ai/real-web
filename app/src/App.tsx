import { IonApp, IonIcon, IonLabel, IonRouterOutlet, IonSpinner, IonTabBar, IonTabButton, IonTabs } from '@ionic/react';
import { IonReactHashRouter, IonReactRouter } from '@ionic/react-router';
import { Capacitor } from '@capacitor/core';
import { Navigate, Route } from 'react-router-dom';
import { chatbubbles, personCircle, receipt, sparkles } from 'ionicons/icons';
import { BusinessProvider } from './automation/business';
import { useAuth } from './lib/auth';
import { useI18n } from './i18n';
import Login from './pages/Login';
import Account from './pages/Account';
import Create from './pages/Create';
import Inbox from './pages/Inbox';
import Chat from './pages/Chat';
import Orders from './pages/Orders';

// Inside the installed app normal paths work; the browser preview on Netlify uses #/paths so reloads never 404.
const Router = Capacitor.isNativePlatform() ? IonReactRouter : IonReactHashRouter;

function Tabs() {
  const { t } = useI18n();
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/inbox/:id" element={<Chat />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/create" element={<Create />} />
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
        <BusinessProvider><Router><Tabs /></Router></BusinessProvider>
      ) : (
        <Login />
      )}
    </IonApp>
  );
}
