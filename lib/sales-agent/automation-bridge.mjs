import { TOOL_DEFINITIONS, executeTool } from './tools.mjs';
import { REPLY_JSON_SCHEMA } from './reply.mjs';

export const HANSORA_SUPPORT_BUSINESS_ID = '14aeca3a-d3b4-4d9a-b876-e23954dd1826';
export function supportBusinessId() {
  return process.env.SALES_AGENT_AUTOMATION_BUSINESS_ID || HANSORA_SUPPORT_BUSINESS_ID;
}
export function usesSharedSupportAgent(businessId) {
  return String(process.env.SALES_AGENT_PROVIDER || '').trim().toLowerCase() === 'elevenlabs' && businessId === supportBusinessId();
}
export const SUPPORT_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map(tool => tool.name));
export const WEBSITE_REPLY_TOOL = {
  name: 'submit_sales_reply',
  description: 'Website channel only: submit the final reply and validated website navigation buttons after required data tools return. Never call on Instagram, WhatsApp, phone or test chats.',
  parameters: REPLY_JSON_SCHEMA
};
export function sharedSupportTools() {
  return [...TOOL_DEFINITIONS.map(({ name, description, parameters }) => ({ name, description, parameters })), WEBSITE_REPLY_TOOL];
}
export const SHARED_SUPPORT_INSTRUCTIONS = `CHANNEL AND SUPPORT TOOLS
Keep the saved business knowledge, personality and language rules on every channel.
Use get_available_features for product features; get_available_models and get_model_details for model facts; get_model_current_price before exact generation costs; get_credit_packages for current package prices.
For account questions use the matching account tool. Its authentication comes from the server, never from a customer-supplied ID or email. If it returns login_required, explain that a signed-in website session is needed. Instagram and WhatsApp identities are not Hansora account authentication.
Never initiate purchases, generation, refunds or credit changes.
On the website channel only, call submit_sales_reply once after any required tools, with the full customer-facing message and optional allowed navigation actions. Its message is displayed directly; do not include JSON in ordinary chat text. Use real catalog IDs and customer-stated memory only. If it returns an error, correct the reply or answer in ordinary text.
On all other channels answer normally; never call submit_sales_reply or return website UI JSON. Follow the configured business's human-handoff rules.`;

// Instagram has no trusted Creative account mapping. Never use its business owner's identity.
export async function runChannelSupportTool(name, args, { businessId } = {}, run = executeTool) {
  if (!usesSharedSupportAgent(businessId) || !SUPPORT_TOOL_NAMES.has(name)) return null;
  return run(name, args, { user: null });
}
