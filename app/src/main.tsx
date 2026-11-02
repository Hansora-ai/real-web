import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setupIonicReact } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@fontsource-variable/inter';
import './theme/tokens.css';
import './theme/app.css';

import App from './App';
import { I18nProvider } from './i18n';
import { AuthProvider } from './lib/auth';
import { applyTheme, loadTheme } from './lib/theme';

// iPhone gets iOS styling, Android gets Android styling, automatically.
setupIonicReact({ swipeBackEnabled: true });

loadTheme().then(choice => {
  applyTheme(choice);
  if (Capacitor.isNativePlatform()) {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    void StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => undefined);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
