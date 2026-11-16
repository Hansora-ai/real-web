// OAuth discovery for the Hansora Automation MCP server (/automation/mcp). Same login as the Creative server
// (hansora-mcp-oauth-metadata.mjs): Supabase Auth is the authorization server.
const SUPABASE_AUTH_ISSUER = 'https://qmaealblegvcwodlmeht.supabase.co/auth/v1';
const RESOURCES = { '/.well-known/oauth-protected-resource/automation/mcp': 'https://hansora.co/automation/mcp', '/.well-known/oauth-protected-resource/automation/v2/mcp': 'https://hansora.co/automation/v2/mcp', '/.well-known/oauth-protected-resource/automation/app/mcp': 'https://hansora.co/automation/app/mcp' };

export default async function oauthMetadata(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, OPTIONS' } });
  return Response.json({
    resource: RESOURCES[new URL(request.url).pathname.replace(/\/+$/, '')] || RESOURCES['/.well-known/oauth-protected-resource/automation/mcp'],
    authorization_servers: [SUPABASE_AUTH_ISSUER],
    scopes_supported: ['email', 'profile'],
    bearer_methods_supported: ['header'],
    resource_name: 'Hansora Automation MCP',
    resource_documentation: 'https://hansora.co/automation'
  }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
}

// Written out in full: the build copies this object as text into the generated entry point.
export const config = { path: ['/.well-known/oauth-protected-resource/automation/mcp', '/.well-known/oauth-protected-resource/automation/v2/mcp', '/.well-known/oauth-protected-resource/automation/app/mcp'] };
