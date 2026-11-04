import type { CapacitorConfig } from '@capacitor/cli';

// The app's own files are in web/: a separate copy of the website's pages, design and functions, changed for the app.
// The app never opens hansora.co pages; it only calls the same server (login, credits, generations, chats).
// App-only parts: web/app/app-shim.js and web/app/app.css.
// The bundle ID can never change after the first store release.
const config: CapacitorConfig = {
  appId: 'co.hansora.app',
  appName: 'Hansora',
  webDir: 'web',
  backgroundColor: '#08090c',
  appendUserAgent: 'HansoraApp',
  ios: { contentInset: 'never', scheme: 'Hansora' },
  android: { adjustMarginsForEdgeToEdge: 'auto' },
  plugins: {
    // Server calls go through the phone's native HTTP, so hansora.co needs no changes.
    CapacitorHttp: { enabled: true },
    // Logo + "Hansora AI" stays until the first page is ready (app-shim.js hides it), at most 6 seconds.
    SplashScreen: { launchShowDuration: 6000, launchAutoHide: true, launchFadeOutDuration: 250, backgroundColor: '#08090c', showSpinner: false },
    // White time and battery on Hansora's dark background.
    StatusBar: { style: 'DARK', backgroundColor: '#08090c', overlaysWebView: false },
  },
};

export default config;
