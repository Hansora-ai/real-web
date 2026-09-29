import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { insertRow, rows, supabaseRequest, updateRows } from '../../lib/automation/db.mjs';
import { buildAutomationInstructions, firstMessageFor } from '../../lib/automation/instructions.mjs';
import { automationProviderName, synchronizeAutomationAgent } from '../../lib/automation/provider.mjs';
import { buildToolDefinitions, loadToolConfigs, toolInstructions } from '../../lib/automation/tools.mjs';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(statusCode, body) { return { statusCode, headers: HEADERS, body: JSON.stringify(body) }; }
function parseBody(event) {
  if (Buffer.byteLength(event.body || '', 'utf8') > 4096) { const error = new Error('request_too_large'); error.status = 413; throw error; }
  try { return JSON.parse(event.body || '{}'); } catch (_) { const error = new Error('invalid_json'); error.status = 400; throw error; }
}

async function loadOwnedBusiness(businessId, userId) {
  const select = 'id,owner_user_id,name,description,automation_agents(*),automation_business_knowledge(*)';
  const result = rows(await supabaseRequest(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&owner_user_id=eq.${encodeURIComponent(userId)}&select=${encodeURIComponent(select)}&limit=1`))[0];
  if (!result) { const error = new Error('business_not_found'); error.status = 404; throw error; }
  const agent = Array.isArray(result.automation_agents) ? result.automation_agents[0] : result.automation_agents;
  const knowledge = Array.isArray(result.automation_business_knowledge) ? result.automation_business_knowledge[0] : result.automation_business_knowledge;
  if (!agent || !knowledge) { const error = new Error('agent_configuration_incomplete'); error.status = 409; throw error; }
  return { business: result, agent, knowledge };
}

async function existingProviderResource(businessId, agentId, provider) {
  return rows(await supabaseRequest(`/rest/v1/automation_provider_resources?business_id=eq.${encodeURIComponent(businessId)}&agent_id=eq.${encodeURIComponent(agentId)}&provider=eq.${encodeURIComponent(provider)}&resource_type=eq.agent&select=*&limit=1`))[0] || null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    const body = parseBody(event);
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const { business, agent, knowledge } = await loadOwnedBusiness(body.business_id, user.id);
    const provider = automationProviderName();
    const stored = await existingProviderResource(business.id, agent.id, provider);
    const toolConfigs = await loadToolConfigs(business.id);
    const tools = buildToolDefinitions({ tools: toolConfigs });
    const instructions = `${buildAutomationInstructions({ business, agent, knowledge })}\n\n${toolInstructions(tools, toolConfigs)}`;
    const synchronized = await synchronizeAutomationAgent({
      business, agent, knowledge, instructions, tools,
      firstMessage: firstMessageFor({ business, agent }),
      providerResourceId: stored?.provider_resource_id || null
    });
    const saved = {
      business_id: business.id,
      agent_id: agent.id,
      provider: synchronized.provider,
      resource_type: 'agent',
      provider_resource_id: synchronized.resourceId,
      status: 'active',
      safe_config: { text_only: true, primary_language: agent.primary_language, configuration_version: agent.configuration_version, tools: tools.map(tool => tool.name) },
      last_synced_at: new Date().toISOString()
    };
    if (stored) await updateRows('automation_provider_resources', `id=eq.${stored.id}`, saved);
    else await insertRow('automation_provider_resources', saved);
    return json(200, { ok: true, provider: synchronized.provider, created: synchronized.created, status: 'active' });
  } catch (error) {
    console.error('automation-agent-sync error', { message: error?.message, status: error?.status, providerStatus: error?.providerStatus });
    const status = Number(error?.status) || 500;
    const allowed = new Set(['invalid_json','request_too_large','business_not_found','agent_configuration_incomplete','elevenlabs_not_configured','automation_provider_not_supported']);
    return json(status, { error: allowed.has(error?.message) ? error.message : status >= 500 ? 'automation_sync_unavailable' : 'automation_sync_failed' });
  }
}
