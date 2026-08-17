const CONSENT_REQUIRED_COUNTRIES = new Set([
  // European Union
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI',
  'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',

  // Additional EEA countries
  'IS', 'LI', 'NO',

  // United Kingdom
  'GB'
]);

export default async function (_request, context) {
  const country = String(
    context.geo?.country?.code || ''
  ).toUpperCase();

  return new Response(
    JSON.stringify({
      country: country || 'UNKNOWN',
      consentRequired: CONSENT_REQUIRED_COUNTRIES.has(country)
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store'
      }
    }
  );
}
