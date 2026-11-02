// The same public Supabase project and key the website uses (public/automation-client.js). Not a secret.
export const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';

// The live website: Netlify functions, legal pages and password reset live there.
export const SITE_URL = 'https://hansora.co';

// Where Google/Apple sign-in returns to inside the installed app. Must be listed in Supabase → Auth → Redirect URLs.
export const NATIVE_AUTH_REDIRECT = 'co.hansora.app://auth/callback';

// Stored credits are shown ×10 with ⚡, exactly like the website (CREDIT_DISPLAY_MULTIPLIER in public/header.js).
export const CREDIT_DISPLAY_MULTIPLIER = 10;
