import type { CapacitorConfig } from '@capacitor/cli';

// The bundle ID can never change after the first store release.
const config: CapacitorConfig = {
  appId: 'co.hansora.app',
  appName: 'Hansora',
  webDir: 'dist',
  backgroundColor: '#08090b',
  ios: { contentInset: 'never', scheme: 'Hansora' },
  plugins: {
    // Requests to hansora.co go through the phone's native HTTP, so the website's server needs no changes.
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#08090b' },
  },
};

export default config;
