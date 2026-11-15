// Orders, bookings and leads, products, comment automations, business tools and phone settings for the Hansora
// Automation MCP server. Same privacy rule as data.mjs: a customer's name, phone number and answers are shown only
// when the record came from Hansora's own channels (website chat, phone) or was added by the team.
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from '../automation/db.mjs';
import { autoCallSettings } from '../automation/phone-auto-calls.mjs';
import { channelName, fail, isUuid, links, ownsBusiness, SITE } from './data.mjs';

const q = encodeURIComponent;
const one = value => Array.isArray(value) ? value[0] || null : value || null;
const OWN_CHANNELS = new Set(['website', 'phone', 'test']);

// ---------- Orders, bookings, leads ----------

export const RECORD_KINDS = ['order', 'booking', 'lead'];
export const RECORD_STATUSES = ['new', 'in_progress', 'waiting', 'confirmed', 'completed', 'cancelled'];
const RECORD_SELECT = 'id,business_id,outcome_type,title,status,reference_number,estimated_value_minor,currency,scheduled_start,scheduled_end,service_name,party_size,assignee,private_note,summary,customer_name,customer_phone,collected_fields,created_by,created_at,conversation_id,automation_conversations(channel_type)';

export function recordView(row) {
  const channel = one(row.automation_conversations)?.channel_type || '';
  // No chat behind it (added by the team) or a Hansora channel: the customer details may be shown.
  const open = !row.conversation_id || OWN_CHANNELS.has(channel);
  const fields = row.collected_fields && typeof row.collected_fields === 'object' ? Object.fromEntries(Object.entries(row.collected_fields).filter(([key]) => !key.startsWith('_'))) : {};
  return {
    record_id: row.id,
    kind: row.outcome_type,
    number: row.reference_number ?? null,
    title: row.title,
    status: row.status,
    ...(row.scheduled_start ? { starts_at: row.scheduled_start, ends_at: row.scheduled_end || null } : {}),
    ...(row.service_name ? { service: row.service_name } : {}),
    ...(row.party_size ? { people: row.party_size } : {}),
    ...(Number(row.estimated_value_minor) > 0 ? { value: Number(row.estimated_value_minor) / 100, currency: row.currency || 'USD' } : {}),
    assigned_to: row.assignee || '',
    note: row.private_note || '',
    created_at: row.created_at,
    came_from: channel ? channelName(channel) : 'Added by the team',
    ...(open
      ? { customer_name: row.customer_name || '', customer_phone: row.customer_phone || '', details: fields, summary: row.summary || '' }
      : { customer_details: `Hidden here because this came from ${channelName(channel)}. Open it in Hansora to see the customer.` })
  };
}

export async function listRecords(businessId, { kind, status, from, to, limit = 20 } = {}) {
  const filters = [
    RECORD_KINDS.includes(kind) ? `outcome_type=eq.${kind}` : '',
    RECORD_STATUSES.includes(status) ? `status=eq.${status}` : '',
    from ? `created_at=gte.${q(from)}` : '',
    to ? `created_at=lte.${q(to)}` : ''
  ].filter(Boolean).map(item => `&${item}`).join('');
  return rows(await supabaseRequest(`/rest/v1/automation_outcomes?business_id=eq.${q(businessId)}${filters}&select=${q(RECORD_SELECT)}&order=created_at.desc&limit=${limit}`)).map(recordView);
}

export async function ownedRecord(userId, recordId) {
  const missing = () => fail('record_not_found', 'This order, booking or lead was not found. Call list_orders_bookings_leads to see the ids.');
  if (!isUuid(recordId)) throw missing();
  const row = await first(`/rest/v1/automation_outcomes?id=eq.${q(recordId)}&select=${q(RECORD_SELECT)}&limit=1`);
  if (!row || !(await ownsBusiness(userId, row.business_id))) throw missing();
  return row;
}

// ---------- Products ----------

const PRODUCT_SELECT = 'id,name,description,category,sku,price,currency,stock,variants,active,source,payment_link,updated_at';
export function productView(row) {
  return {
    product_id: row.id, name: row.name, price: row.price === null ? null : Number(row.price), currency: row.currency, stock: row.stock, category: row.category || '', sku: row.sku || '',
    description: row.description || '', variants: Array.isArray(row.variants) ? row.variants : [], shown_to_customers: row.active !== false, payment_link: row.payment_link || '',
    ...(row.source && row.source !== 'manual' ? { synced_from: row.source } : {})
  };
}

const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
export function productPatch(input = {}) {
  const patch = {};
  if (input.name !== undefined) { const name = cleanText(input.name, 300); if (name) patch.name = name; }
  if (input.description !== undefined) patch.description = cleanText(input.description, 5000);
  if (input.category !== undefined) patch.category = cleanText(input.category, 200);
  if (input.sku !== undefined) patch.sku = cleanText(input.sku, 120);
  if (input.price !== undefined) patch.price = input.price === null ? null : Math.max(0, Number(input.price) || 0);
  if (input.currency !== undefined && /^[A-Za-z]{3}$/.test(String(input.currency))) patch.currency = String(input.currency).toUpperCase();
  if (input.stock !== undefined) patch.stock = input.stock === null ? null : Math.max(0, Math.round(Number(input.stock) || 0));
  if (input.shown_to_customers !== undefined) patch.active = input.shown_to_customers !== false;
  if (input.payment_link !== undefined) { const link = cleanText(input.payment_link, 1000); if (!link || /^https:\/\//.test(link)) patch.payment_link = link; }
  return patch;
}

export async function listProducts(businessId, { search = '', limit = 30 } = {}) {
  const term = String(search || '').replace(/[%*,()]/g, ' ').trim().slice(0, 80);
  const filter = term ? `&or=(name.ilike.*${q(term)}*,category.ilike.*${q(term)}*,sku.ilike.*${q(term)}*)` : '';
  const [list, catalog] = await Promise.all([
    supabaseRequest(`/rest/v1/automation_products?business_id=eq.${q(businessId)}${filter}&select=${q(PRODUCT_SELECT)}&order=name.asc&limit=${limit}`).then(rows),
    first(`/rest/v1/automation_tool_configs?business_id=eq.${q(businessId)}&tool_type=eq.catalog&select=enabled&limit=1`)
  ]);
  return { products: list.map(productView), ai_offers_products: catalog?.enabled === true };
}

export async function addProduct(businessId, input) {
  const patch = productPatch(input);
  if (!patch.name) throw fail('product_name_required', 'Ask the user for the product name.');
  return productView(await serviceInsert('automation_products', { business_id: businessId, ...patch }));
}

export async function ownedProduct(userId, productId) {
  const missing = () => fail('product_not_found', 'This product was not found. Call list_products to see the ids.');
  if (!isUuid(productId)) throw missing();
  const row = await first(`/rest/v1/automation_products?id=eq.${q(productId)}&select=${q(`business_id,${PRODUCT_SELECT}`)}&limit=1`);
  if (!row || !(await ownsBusiness(userId, row.business_id))) throw missing();
  return row;
}

export async function updateProduct(row, input) {
  const patch = productPatch(input);
  if (!Object.keys(patch).length) return productView(row);
  const saved = await serviceUpdate('automation_products', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { ...patch, updated_at: new Date().toISOString() });
  return productView(saved[0] || { ...row, ...patch });
}

export async function deleteProduct(row) {
  await supabaseRequest(`/rest/v1/automation_products?id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { method: 'DELETE' });
}

// ---------- Business tools (what the AI employee may do) ----------

const TOOL_NAMES = { orders: 'orders', bookings: 'calendar', leads: 'leads', handoff_to_person: 'handoff', products: 'catalog' };
export const TOOL_KEYS = Object.keys(TOOL_NAMES);

export async function businessTools(businessId) {
  const configs = rows(await supabaseRequest(`/rest/v1/automation_tool_configs?business_id=eq.${q(businessId)}&select=tool_type,enabled`));
  const byType = Object.fromEntries(configs.map(row => [row.tool_type, row]));
  return Object.fromEntries(TOOL_KEYS.map(key => [key, byType[TOOL_NAMES[key]] ? (byType[TOOL_NAMES[key]].enabled ? 'on' : 'off') : 'not set up']));
}

// Turns tools on or off. A tool that was never set up (it needs working hours, required details and so on) is
// left for the website, except products, which has no required settings.
export async function setBusinessTools(businessId, changes = {}) {
  const current = await businessTools(businessId);
  const changed = {}, needsSetup = [];
  for (const key of TOOL_KEYS) {
    if (typeof changes[key] !== 'boolean') continue;
    const type = TOOL_NAMES[key];
    if (current[key] === 'not set up') {
      if (key !== 'products') { needsSetup.push(key); continue; }
      await supabaseRequest('/rest/v1/automation_tool_configs?on_conflict=business_id,tool_type', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { business_id: businessId, tool_type: type, enabled: changes[key], config: {} } });
    } else {
      await serviceUpdate('automation_tool_configs', `business_id=eq.${q(businessId)}&tool_type=eq.${type}`, { enabled: changes[key], updated_at: new Date().toISOString() });
    }
    changed[key] = changes[key] ? 'on' : 'off';
  }
  return { changed, needs_setup_on_website: needsSetup, settings_page: `${SITE}/automation-tools.html?business=${businessId}` };
}

// ---------- Comment automations ----------

export function automationView(row) {
  const config = row.safety_config && typeof row.safety_config === 'object' ? row.safety_config : {};
  const type = config.trigger_type || 'comment';
  return {
    automation_id: row.id,
    name: row.name,
    status: row.status === 'active' ? 'on' : row.status === 'paused' ? 'off' : row.status,
    platform: type === 'tiktok_comment' ? 'TikTok' : 'Instagram',
    trigger: type,
    reacts_to: row.match_type === 'any' ? 'any comment' : `comments ${row.match_type === 'exact' ? 'that are exactly' : 'that contain'}: ${(row.keywords || []).join(', ')}`,
    posts: row.post_scope === 'all' ? 'all posts' : row.post_scope === 'next' ? 'the next post' : `${(row.selected_post_ids || []).length} selected posts`,
    ...(Array.isArray(row.public_reply_variations) && row.public_reply_variations.length ? { public_replies: row.public_reply_variations } : {}),
    ...(Array.isArray(row.dm_steps) && row.dm_steps.length ? { private_message: String(row.dm_steps.find(step => step?.type === 'message' && step.text)?.text || ''), steps: row.dm_steps.length } : {}),
    times_run: Number(row.triggered_count || 0),
    last_run_at: row.last_triggered_at || null
  };
}

const AUTOMATION_SELECT = 'id,business_id,name,status,post_scope,selected_post_ids,match_type,keywords,public_reply_variations,dm_steps,safety_config,triggered_count,last_triggered_at';
export async function listAutomations(businessId) {
  return rows(await supabaseRequest(`/rest/v1/automation_comment_workflows?business_id=eq.${q(businessId)}&status=neq.archived&select=${q(AUTOMATION_SELECT)}&order=updated_at.desc&limit=100`));
}

export async function ownedAutomation(userId, automationId) {
  const missing = () => fail('automation_not_found', 'This comment automation was not found. Call list_comment_automations to see the ids.');
  if (!isUuid(automationId)) throw missing();
  const row = await first(`/rest/v1/automation_comment_workflows?id=eq.${q(automationId)}&status=neq.archived&select=${q(AUTOMATION_SELECT)}&limit=1`);
  if (!row || !(await ownsBusiness(userId, row.business_id))) throw missing();
  return row;
}

export async function setAutomationOn(row, on) {
  const status = on ? 'active' : 'paused';
  try {
    await serviceUpdate('automation_comment_workflows', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { status, ...(on ? { activated_at: new Date().toISOString() } : {}) });
  } catch (error) {
    // The database refuses to turn on an automation with no keywords or no selected posts.
    if (on && [400, 409].includes(Number(error?.status))) throw fail('automation_not_finished', 'This automation is not finished (it needs its keywords or posts). The user can finish it in the builder on hansora.co.', { builder: `${SITE}/automation-workflows.html?business=${row.business_id}` });
    throw error;
  }
  return { ...row, status };
}

// A simple automation as the builders on hansora.co save it: Instagram (optional public reply under the comment,
// then one private message, optionally with a link button) or TikTok (public reply only; TikTok has no private
// message after a comment). Multi-step flows are made in the builder.
const short = (value, max) => String(value ?? '').trim().slice(0, max);
export function automationPayload(businessId, input = {}) {
  const tiktok = input.platform === 'tiktok';
  const any = input.reacts_to === 'any';
  const keywords = any ? [] : [...new Set((Array.isArray(input.keywords) ? input.keywords : []).map(word => short(word, 80)).filter(Boolean))].slice(0, 20);
  if (!any && !keywords.length) throw fail('keywords_required', 'Ask the user which words in a comment should start this automation, or whether it should react to any comment.');
  const match = any ? 'any' : tiktok ? 'contains' : input.reacts_to === 'exact' ? 'exact' : 'contains';
  const replies = (Array.isArray(input.public_replies) ? input.public_replies : []).map(text => short(text, 300)).filter(Boolean).slice(0, 3);
  const scope = input.posts === 'next' ? 'next' : 'all';
  const name = short(input.name, 200) || (any ? 'Reply to every comment' : `Comment: ${keywords.slice(0, 3).join(', ')}`).slice(0, 200);
  const base = { business_id: businessId, name, status: 'draft', post_scope: scope, selected_post_ids: [], match_type: match, keywords };
  if (tiktok) {
    const ai = input.ai_writes_reply === true;
    if (!ai && !replies.length) throw fail('reply_required', 'Ask the user what to reply under the comment (TikTok allows a public reply only), or whether the AI should write each reply.');
    return { ...base, public_reply_variations: replies, dm_steps: [], safety_config: { platform: 'tiktok', trigger_type: 'tiktok_comment', reply_mode: ai ? 'ai' : 'fixed', ai_instruction: short(input.ai_instruction, 500), first_comment_only: true, ignore_own: true, exclude_keywords: [], public_reply_enabled: true, post_previews: {} } };
  }
  const message = short(input.private_message, 640);
  if (!message) throw fail('private_message_required', 'Ask the user what private message to send to the person who commented.');
  const label = short(input.button_label, 20), url = short(input.button_url, 1000);
  if ((label || url) && !(label && /^https:\/\//i.test(url))) throw fail('button_needs_https_link', 'A button needs a short label and a link that starts with https://.');
  const step = { id: 'message-opening', type: 'message', title: 'Opening DM', text: message, commentReply: true, entry: true, nextId: null, replyNextId: null, actions: label ? [{ id: 'action-website', type: 'website', label, url }] : [] };
  return { ...base, public_reply_variations: replies, dm_steps: [step], safety_config: { exclude_keywords: [], public_reply_enabled: replies.length > 0, first_comment_only: true, ignore_own: true, flow_version: 3, trigger_type: 'comment', trigger: { ref: '', question: '' }, folder: '', post_previews: {}, layout: {} } };
}

export async function channelConnected(businessId, platform) {
  const type = platform === 'tiktok' ? 'tiktok' : 'instagram_comments';
  const fallback = platform === 'tiktok' ? '' : ',instagram_dm';
  const list = rows(await supabaseRequest(`/rest/v1/automation_channel_connections?business_id=eq.${q(businessId)}&channel_type=in.(${type}${fallback})&select=channel_type,status`));
  return list.some(item => item.status === 'connected');
}

export async function createAutomation(businessId, input) {
  const payload = automationPayload(businessId, input);
  const turnOn = input.turn_on === true && await channelConnected(businessId, input.platform);
  const row = await serviceInsert('automation_comment_workflows', turnOn ? { ...payload, status: 'active', activated_at: new Date().toISOString() } : payload);
  return { row, turned_on: turnOn, not_connected: input.turn_on === true && !turnOn };
}

export async function archiveAutomation(row) {
  await serviceUpdate('automation_comment_workflows', `id=eq.${q(row.id)}&business_id=eq.${q(row.business_id)}`, { status: 'archived' });
}

// ---------- Automatic phone calls ----------

async function phoneChannel(businessId) {
  return first(`/rest/v1/automation_channel_connections?business_id=eq.${q(businessId)}&channel_type=eq.phone&select=id,status,settings&limit=1`);
}

export function automaticCallsView(settings) {
  const value = autoCallSettings(settings?.auto_calls);
  return {
    calling_hours: { from: value.from, to: value.to },
    confirm_new_orders: { on: value.order.on, minutes_after_the_order: value.order.delay_minutes, what_to_say: value.order.purpose },
    remind_before_bookings: { on: value.reminder.on, hours_before: value.reminder.hours_before, what_to_say: value.reminder.purpose }
  };
}

export async function getAutomaticCalls(businessId) {
  const channel = await phoneChannel(businessId);
  return { ...automaticCallsView(channel?.settings), links: { phone: links(businessId).phone } };
}

export async function setAutomaticCalls(businessId, input = {}) {
  const channel = await phoneChannel(businessId);
  if (!channel) throw fail('phone_not_set_up', 'This AI employee has no phone channel yet. The user can set it up on the Phone page.', { phone: links(businessId).phone });
  const settings = channel.settings && typeof channel.settings === 'object' ? channel.settings : {};
  const now = autoCallSettings(settings.auto_calls);
  const next = autoCallSettings({
    from: input.calling_hours_from ?? now.from,
    to: input.calling_hours_to ?? now.to,
    order: { on: input.confirm_new_orders ?? now.order.on, delay_minutes: input.minutes_after_the_order ?? now.order.delay_minutes, purpose: input.order_call_says ?? now.order.purpose },
    reminder: { on: input.remind_before_bookings ?? now.reminder.on, hours_before: input.hours_before_the_booking ?? now.reminder.hours_before, purpose: input.reminder_call_says ?? now.reminder.purpose }
  });
  await serviceUpdate('automation_channel_connections', `id=eq.${q(channel.id)}`, { settings: { ...settings, auto_calls: next } });
  return automaticCallsView({ auto_calls: next });
}
