import { usesSharedSupportAgent, sharedSupportTools, SHARED_SUPPORT_INSTRUCTIONS } from '../sales-agent/automation-bridge.mjs';
// Brings the business's ElevenLabs agent in line with what the owner saved in Hansora: instructions, business
// actions (tools) and knowledge documents. Used by "Save" (automation-agent-sync) and by knowledge file changes.
import { insertRow, rows, supabaseRequest, updateRows } from './db.mjs';
import { buildAutomationInstructions, firstMessageFor } from './instructions.mjs';
import { automationProviderName, synchronizeAutomationAgent } from './provider.mjs';
import { buildToolDefinitions, loadToolConfigs, toolInstructions } from './tools.mjs';
import { sha256 } from './crypto.mjs';
import { AGENT_SETTINGS_VERSION } from './providers/elevenlabs.mjs';

export async function loadOwnedBusiness(businessId, userId) {
  const select = 'id,owner_user_id,name,category,description,automation_agents(*),automation_business_knowledge(*)';
  const result = rows(await supabaseRequest(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&owner_user_id=eq.${encodeURIComponent(userId)}&select=${encodeURIComponent(select)}&limit=1`))[0];
  if (!result) { const error = new Error('business_not_found'); error.status = 404; throw error; }
  const agent = Array.isArray(result.automation_agents) ? result.automation_agents[0] : result.automation_agents;
  const knowledge = Array.isArray(result.automation_business_knowledge) ? result.automation_business_knowledge[0] : result.automation_business_knowledge;
  if (!agent || !knowledge) { const error = new Error('agent_configuration_incomplete'); error.status = 409; throw error; }
  return { business: result, agent, knowledge };
}

export async function existingProviderResource(businessId, agentId, provider = automationProviderName()) {
  return rows(await supabaseRequest(`/rest/v1/automation_provider_resources?business_id=eq.${encodeURIComponent(businessId)}&agent_id=eq.${encodeURIComponent(agentId)}&provider=eq.${encodeURIComponent(provider)}&resource_type=eq.agent&select=*&limit=1`))[0] || null;
}

export function storedKnowledgeDocuments(resource) {
  const list = resource?.safe_config?.knowledge_documents;
  return Array.isArray(list) ? list.filter(document => document?.id && document?.type) : [];
}

// Everything the AI gets at setup time. Its fingerprint (rules_hash) tells whether the AI still has the latest
// rules: after a Hansora update or a settings change, the next customer message brings the AI up to date.
function agentPlan({ business, agent, knowledge, toolConfigs, documents }) {
  const sharedSupport = usesSharedSupportAgent(business.id);
  const tools = [...buildToolDefinitions({ tools: toolConfigs }), ...(sharedSupport ? sharedSupportTools() : [])];
  const instructions = `${buildAutomationInstructions({ business, agent, knowledge })}\n\n${toolInstructions(tools, toolConfigs)}${sharedSupport ? '\n\n' + SHARED_SUPPORT_INSTRUCTIONS : ''}`;
  const firstMessage = firstMessageFor({ business, agent });
  const hash = sha256(JSON.stringify({ instructions, tools, firstMessage, documents: documents.map(item => item.id), llm: process.env.ELEVENLABS_AGENT_LLM || '', settings: AGENT_SETTINGS_VERSION }));
  return { tools, instructions, firstMessage, hash };
}

async function loadBusinessById(businessId) {
  const select = 'id,owner_user_id,name,category,description,automation_agents(*),automation_business_knowledge(*)';
  const result = rows(await supabaseRequest(`/rest/v1/automation_businesses?id=eq.${encodeURIComponent(businessId)}&select=${encodeURIComponent(select)}&limit=1`))[0];
  const agent = Array.isArray(result?.automation_agents) ? result.automation_agents[0] : result?.automation_agents;
  const knowledge = Array.isArray(result?.automation_business_knowledge) ? result.automation_business_knowledge[0] : result?.automation_business_knowledge;
  return result && agent && knowledge ? { business: result, agent, knowledge } : null;
}

// Called before answering a customer: updates the AI only when its rules are out of date (one quick check otherwise).
export async function ensureAgentUpToDate({ businessId }) {
  const [loaded, toolConfigs] = await Promise.all([loadBusinessById(businessId), loadToolConfigs(businessId)]); if (!loaded) return false;
  const stored = await existingProviderResource(businessId, loaded.agent.id, automationProviderName());
  if (!stored) return false; // never set up: the owner's first Save creates it
  const plan = agentPlan({ ...loaded, toolConfigs, documents: storedKnowledgeDocuments(stored) });
  if (stored.safe_config?.rules_hash === plan.hash) return false;
  await synchronize({ ...loaded, stored, documents: storedKnowledgeDocuments(stored), plan });
  console.log('automation agent updated to the latest rules', { businessId });
  return true;
}

// knowledgeDocuments: pass a new list to replace the stored one; omit it to keep what is stored.
export async function syncBusinessAgent({ businessId, userId, knowledgeDocuments }) {
  const { business, agent, knowledge } = await loadOwnedBusiness(businessId, userId);
  const stored = await existingProviderResource(business.id, agent.id, automationProviderName());
  const documents = knowledgeDocuments || storedKnowledgeDocuments(stored);
  const toolConfigs = await loadToolConfigs(business.id);
  return synchronize({ business, agent, knowledge, stored, documents, plan: agentPlan({ business, agent, knowledge, toolConfigs, documents }) });
}

async function synchronize({ business, agent, knowledge, stored, documents, plan }) {
  const { tools, instructions } = plan;
  const synchronized = await synchronizeAutomationAgent({
    business, agent, knowledge, instructions, tools,
    firstMessage: plan.firstMessage,
    providerResourceId: stored?.provider_resource_id || null,
    existingToolIds: stored?.safe_config?.tool_ids || {},
    knowledgeDocuments: documents
  });
  const saved = {
    business_id: business.id,
    agent_id: agent.id,
    provider: synchronized.provider,
    resource_type: 'agent',
    provider_resource_id: synchronized.resourceId,
    status: 'active',
    safe_config: { text_only: true, primary_language: agent.primary_language, configuration_version: agent.configuration_version, tools: tools.map(tool => tool.name), tool_ids: synchronized.toolIds || {}, knowledge_documents: documents, rules_hash: plan.hash },
    last_synced_at: new Date().toISOString()
  };
  if (stored) await updateRows('automation_provider_resources', `id=eq.${stored.id}`, saved);
  else await insertRow('automation_provider_resources', saved);
  return { provider: synchronized.provider, created: synchronized.created, documents };
}
