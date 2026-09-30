// Brings the business's ElevenLabs agent in line with what the owner saved in Hansora: instructions, business
// actions (tools) and knowledge documents. Used by "Save" (automation-agent-sync) and by knowledge file changes.
import { insertRow, rows, supabaseRequest, updateRows } from './db.mjs';
import { buildAutomationInstructions, firstMessageFor } from './instructions.mjs';
import { automationProviderName, synchronizeAutomationAgent } from './provider.mjs';
import { buildToolDefinitions, loadToolConfigs, toolInstructions } from './tools.mjs';

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

// knowledgeDocuments: pass a new list to replace the stored one; omit it to keep what is stored.
export async function syncBusinessAgent({ businessId, userId, knowledgeDocuments }) {
  const { business, agent, knowledge } = await loadOwnedBusiness(businessId, userId);
  const provider = automationProviderName();
  const stored = await existingProviderResource(business.id, agent.id, provider);
  const documents = knowledgeDocuments || storedKnowledgeDocuments(stored);
  const toolConfigs = await loadToolConfigs(business.id);
  const tools = buildToolDefinitions({ tools: toolConfigs });
  const instructions = `${buildAutomationInstructions({ business, agent, knowledge })}\n\n${toolInstructions(tools, toolConfigs)}`;
  const synchronized = await synchronizeAutomationAgent({
    business, agent, knowledge, instructions, tools,
    firstMessage: firstMessageFor({ business, agent }),
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
    safe_config: { text_only: true, primary_language: agent.primary_language, configuration_version: agent.configuration_version, tools: tools.map(tool => tool.name), tool_ids: synchronized.toolIds || {}, knowledge_documents: documents },
    last_synced_at: new Date().toISOString()
  };
  if (stored) await updateRows('automation_provider_resources', `id=eq.${stored.id}`, saved);
  else await insertRow('automation_provider_resources', saved);
  return { provider: synchronized.provider, created: synchronized.created, documents };
}
