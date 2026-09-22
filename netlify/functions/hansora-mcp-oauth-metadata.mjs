const SUPABASE_AUTH_ISSUER = 'https://qmaealblegvcwodlmeht.supabase.co/auth/v1';
const RESOURCE = 'https://hansora.co/mcp';

export default async function oauthMetadata(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, OPTIONS' } });
  return Response.json({
    resource: RESOURCE,
    authorization_servers: [SUPABASE_AUTH_ISSUER],
    scopes_supported: ['email', 'profile'],
    bearer_methods_supported: ['header'],
    resource_name: 'Hansora AI MCP',
    resource_documentation: 'https://hansora.co/mcp-setup.html'
  }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
}

export const config = { path: '/.well-known/oauth-protected-resource/mcp' };
