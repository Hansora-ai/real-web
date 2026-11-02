import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// APP_BASE lets the browser preview live under a sub-path (e.g. /app-preview/) on Netlify deploy previews.
export default defineConfig({
  base: process.env.APP_BASE || './',
  plugins: [react()],
  server: { port: 5174 },
  build: { target: 'es2022' },
});
