import { TOOL_DEFINITIONS, executeTool } from './tools.mjs';
import { REPLY_JSON_SCHEMA } from './reply.mjs';
import { monthlySupportKnowledge } from './product-knowledge.mjs';

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
Use saved business facts, retrieved knowledge documents and verified support-tool results together. Uploaded knowledge adds detail; it does not replace the tools for current prices, balances, payments or generation status. For those current facts, tool results take priority over dated document values or earlier chat replies. The tools registered for this conversation define what you can check now, even if an older document says those tools are unavailable; authentication still comes only from the server.
All credit amounts returned by support tools are already customer-facing credits, the same units as the website balance and pricing page. Call them simply credits. Never multiply them again, describe internal credits, explain backend conversion or give a second credit number in parentheses. If an earlier reply mentioned internal credits, briefly correct it and use only the customer-facing amount.
Answer the actual question first. Keep greetings and simple questions brief, but give enough detail for comparisons, troubleshooting, how-to questions and requests for a deeper explanation. Use the relevant knowledge documents and model-detail tools before saying information is unavailable. Do not repeatedly ask for information the customer already gave. Explain verified limitations honestly; never fill missing knowledge with guesses.
Hansora has two product areas: Creative (AI image, video and audio creation) and Automation (AI employees configured with business knowledge and connected customer channels). Do not answer an Automation question with Creative model features or Creative credit-package prices. For Automation features, channel availability, setup and pricing, use the saved Automation knowledge; ask a focused question or say the specific detail is not yet available when that knowledge is missing. Do not claim that a channel is live merely because it is mentioned by a customer.
Use get_available_features for product features; get_available_models and get_model_details for model facts; get_model_current_price before exact generation costs; get_credit_packages for current package prices.
For account questions use the matching account tool. Its authentication comes from the server, never from a customer-supplied ID or email. If it returns login_required, explain that a signed-in website session is needed. Instagram and WhatsApp identities are not Hansora account authentication.
Never initiate purchases, generation, refunds or credit changes.
On the website channel only, call submit_sales_reply once after any required tools, with the full customer-facing message and optional allowed navigation actions. Its message is displayed directly; do not include JSON in ordinary chat text. Use real catalog IDs and customer-stated memory only. If it returns an error, correct the reply or answer in ordinary text.
On all other channels answer normally; never call submit_sales_reply or return website UI JSON. Follow the configured business's human-handoff rules.

${monthlySupportKnowledge()}`;

// Instagram has no trusted Creative account mapping. Never use its business owner's identity.
export async function runChannelSupportTool(name, args, { businessId } = {}, run = executeTool) {
  if (!usesSharedSupportAgent(businessId) || !SUPPORT_TOOL_NAMES.has(name)) return null;
  return run(name, args, { user: null });
}
