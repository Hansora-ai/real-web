const discoveryDocument = {
  issuer: 'https://oauth.telegram.org',
  authorization_endpoint: 'https://oauth.telegram.org/auth',
  token_endpoint: 'https://oauth.telegram.org/token',
  jwks_uri:
    'https://hansora.co/.netlify/functions/telegram-oidc-jwks',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  subject_types_supported: ['public'],
  token_endpoint_auth_methods_supported: [
    'client_secret_basic',
    'client_secret_post',
  ],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'profile', 'phone', 'telegram:bot_access'],
  claims_supported: [
    'aud',
    'sub',
    'iss',
    'iat',
    'exp',
    'id',
    'name',
    'given_name',
    'family_name',
    'preferred_username',
    'picture',
    'phone_number',
    'phone_number_verified',
  ],
  code_challenge_methods_supported: ['plain', 'S256'],
};

export default async function () {
  return new Response(JSON.stringify(discoveryDocument), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
