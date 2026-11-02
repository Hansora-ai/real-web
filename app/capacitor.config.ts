import type { CapacitorConfig } from '@capacitor/cli';

// The bundle ID can never change after the first store release.
const config: CapacitorConfig = {
  appId: 'co.hansora.app',
  appName: 'Hansora',
  webDir: 'dist',
  backgroundColor: '#08090b',
  ios: { contentInset: 'never', scheme: 'Hansora' },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#08090b' },
  },
};

export default config;
