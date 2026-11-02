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
  ios: { contentInset: 'always', scheme: 'Hansora' },
  android: { adjustMarginsForEdgeToEdge: 'auto' },
  plugins: {
    // Server calls go through the phone's native HTTP, so hansora.co needs no changes.
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#08090c' },
  },
};

export default config;
