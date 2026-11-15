// OAuth discovery for the Hansora Automation MCP server (/automation/mcp). Same login as the Creative server
// (hansora-mcp-oauth-metadata.mjs): Supabase Auth is the authorization server.
const SUPABASE_AUTH_ISSUER = 'https://qmaealblegvcwodlmeht.supabase.co/auth/v1';
const RESOURCE = 'https://hansora.co/automation/mcp';

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
    resource_name: 'Hansora Automation MCP',
    resource_documentation: 'https://hansora.co/automation'
  }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
}

export const config = { path: '/.well-known/oauth-protected-resource/automation/mcp' };
