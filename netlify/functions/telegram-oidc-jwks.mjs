const TELEGRAM_JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';

export default async function () {
  try {
    const response = await fetch(TELEGRAM_JWKS_URL, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Telegram JWKS returned HTTP ${response.status}`);
    }

    const telegramJwks = await response.json();
    const keys = Array.isArray(telegramJwks?.keys)
      ? telegramJwks.keys.filter(
          (key) => key?.kty === 'RSA' && key?.alg === 'RS256'
        )
      : [];

    if (keys.length === 0) {
      throw new Error('Telegram JWKS did not contain an RS256 key');
    }

    return new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=3600',
      },
    });
  } catch (error) {
    console.error('Unable to provide Telegram RS256 JWKS', error);

    return new Response(
      JSON.stringify({ error: 'Unable to load Telegram signing keys' }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
