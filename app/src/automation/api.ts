import { Capacitor } from '@capacitor/core';
import { automationDb, supabase } from '../lib/supabase';
import { SITE_URL } from '../lib/config';

// Same tables and server actions as public/automation-inbox.js and public/automation-operations.js.
const API = Capacitor.isNativePlatform() ? SITE_URL : '';

async function authed(path: string, body: unknown): Promise<any> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('authentication_required');
  const res = await fetch(`${API}/.netlify/functions/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `${path}_failed`), { code: json.error });
  return json;
}

// ---------- Channels (generic: new channels such as WhatsApp or phone calls simply appear) ----------
export const CHANNEL_NAMES: Record<string, string> = {
  instagram_dm: 'Instagram DM', instagram_comments: 'Instagram comment', whatsapp: 'WhatsApp', phone: 'Phone',
  telegram: 'Telegram', messenger: 'Messenger', tiktok: 'TikTok', test: 'Test chat',
};
export const channelName = (type: string) => CHANNEL_NAMES[type] || (type ? type.replace(/_/g, ' ') : 'Other');
export const PLATFORM_NAMES: Record<string, string> = { instagram: 'Instagram', whatsapp: 'WhatsApp', tiktok: 'TikTok', messenger: 'Messenger', telegram: 'Telegram', phone: 'Phone' };
export const platformOf = (type: string) => (String(type || '').startsWith('instagram') ? 'instagram' : String(type || 'other'));

// ---------- Inbox ----------
export const STAGES: Record<string, [string, string]> = { new: ['🆕', 'New'], interested: ['👀', 'Interested'], ready: ['🔥', 'Ready'], done: ['✅', 'Done'], lost: ['❌', 'Lost'], quiet: ['💤', 'Went quiet'] };

export type Outcome = { conversation_id?: string; id?: string; outcome_type: 'order' | 'booking' | 'lead' | string; reference_number?: number; status?: string; title?: string; created_at?: string };
export type Conversation = {
  id: string; contactId: string; channelType: string; name: string; handle: string; avatarUrl: string; preview: string; lastAt: string;
  attention: boolean; human: boolean; aiActive: boolean; resolved: boolean; intent: string; summary: string; stage: string;
  interest: string; value: string; language: string; outcomes: Outcome[];
};
export type Message = { role: 'customer' | 'ai' | 'human' | 'event'; text: string; at: number; counted?: boolean; kind?: string; reference?: number; status?: string; mediaUrl?: string };

function stageOf(row: any): string {
  const stage = row.sales_stage || '';
  if (!stage) return '';
  const updated = Date.parse(row.sales_updated_at || row.last_message_at || '');
  return ['interested', 'ready'].includes(stage) && Number.isFinite(updated) && Date.now() - updated > 86400000 ? 'quiet' : stage;
}
const money = (value: any, currency: any) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}` : ''; };

export async function loadConversations(businessId: string): Promise<Conversation[]> {
  const base = 'id,contact_id,channel_type,status,ai_enabled,intent,summary,last_message_preview,last_message_at,automation_contacts(display_name,primary_phone,primary_email,language,profile)';
  const query = (select: string) => automationDb.from('automation_conversations').select(select).eq('business_id', businessId).order('last_message_at', { ascending: false }).limit(100);
  let result: any = await query(`${base},sales_stage,sales_interest,sales_value,sales_currency,sales_updated_at`);
  if (result.error) result = await query(base);
  if (result.error) throw result.error;
  const rows: any[] = result.data || [];
  const ids = rows.map(row => row.id);
  const made: any = ids.length
    ? await automationDb.from('automation_outcomes').select('conversation_id,outcome_type,reference_number,status,created_at').eq('business_id', businessId).in('conversation_id', ids).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(500)
    : { data: [] };
  const byConversation = new Map<string, Outcome[]>();
  for (const item of made.error ? [] : made.data || []) {
    if (!byConversation.has(item.conversation_id)) byConversation.set(item.conversation_id, []);
    byConversation.get(item.conversation_id)!.push(item);
  }
  return rows.map(row => {
    const contact = (Array.isArray(row.automation_contacts) ? row.automation_contacts[0] : row.automation_contacts) || {};
    const name = contact.display_name || contact.profile?.username || ({ whatsapp: 'WhatsApp customer', telegram: 'Telegram customer', messenger: 'Messenger customer', tiktok: 'TikTok customer', phone: 'Caller' } as Record<string, string>)[row.channel_type] || 'Instagram customer';
    return {
      id: row.id, contactId: row.contact_id, channelType: row.channel_type, name,
      handle: contact.primary_phone || contact.primary_email || (contact.profile?.username ? `@${contact.profile.username}` : ''),
      avatarUrl: /^https:\/\//.test(String(contact.profile?.profile_pic || '')) ? String(contact.profile.profile_pic) : '',
      preview: row.last_message_preview || '', lastAt: row.last_message_at,
      attention: row.status === 'needs_attention', human: row.status === 'human_handling', aiActive: Boolean(row.ai_enabled), resolved: row.status === 'resolved',
      intent: row.intent || '', summary: row.summary || '', stage: stageOf(row), interest: row.sales_interest || '', value: money(row.sales_value, row.sales_currency),
      language: contact.language || '', outcomes: byConversation.get(row.id) || [],
    };
  });
}

export async function loadMessages(businessId: string, conversationId: string): Promise<{ messages: Message[]; lastCustomerAt: number }> {
  const [result, outcomes]: any[] = await Promise.all([
    automationDb.from('automation_messages').select('sender_type,content,billable,occurred_at,metadata').eq('business_id', businessId).eq('conversation_id', conversationId).order('occurred_at', { ascending: false }).limit(100),
    automationDb.from('automation_outcomes').select('id,outcome_type,reference_number,title,status,created_at').eq('business_id', businessId).eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(50),
  ]);
  if (result.error) throw result.error;
  const rows = (result.data || []).reverse();
  const lastCustomer = [...rows].reverse().find((row: any) => row.sender_type === 'customer');
  const messages: Message[] = rows.map((row: any) => ({
    role: row.sender_type === 'customer' ? 'customer' : row.sender_type === 'human' ? 'human' : 'ai',
    text: row.content || '', at: Date.parse(row.occurred_at), counted: Boolean(row.billable), mediaUrl: row.metadata?.product_photo_url || '',
  }));
  const events: Message[] = (outcomes.error ? [] : outcomes.data || []).map((row: any) => ({ role: 'event', kind: row.outcome_type, reference: row.reference_number, text: row.title, status: row.status, at: Date.parse(row.created_at) }));
  return { messages: [...messages, ...events].sort((a, b) => a.at - b.at), lastCustomerAt: lastCustomer ? Date.parse(lastCustomer.occurred_at) : 0 };
}

export async function setAi(businessId: string, conversationId: string, aiOn: boolean) {
  const { error } = await automationDb.from('automation_conversations').update({ ai_enabled: aiOn, status: aiOn ? 'open' : 'human_handling' }).eq('id', conversationId).eq('business_id', businessId);
  if (error) throw error;
}

export async function setResolved(businessId: string, conversation: Conversation, resolved: boolean) {
  const { error } = await automationDb.from('automation_conversations')
    .update({ status: resolved ? 'resolved' : conversation.human ? 'human_handling' : 'open', resolved_at: resolved ? new Date().toISOString() : null })
    .eq('id', conversation.id).eq('business_id', businessId);
  if (error) throw error;
}

export const sendReply = (businessId: string, conversationId: string, message: string) =>
  authed('automation-conversation-reply', { business_id: businessId, conversation_id: conversationId, message });

/** WhatsApp, Instagram and Messenger: replies within 24 h of the customer's last message; TikTok 48 h. */
export function replyWindowHours(channelType: string): number | null {
  if (channelType === 'tiktok') return 48;
  return ['whatsapp', 'instagram_dm', 'messenger'].includes(channelType) ? 24 : null;
}

// ---------- Orders & bookings ----------
export const STATUSES = ['new', 'in_progress', 'waiting', 'confirmed', 'completed', 'cancelled'] as const;
export type RecordItem = {
  id: string; reference?: number; kind: string; customer: string; handle: string; title: string; channel: string; owner: string; status: string;
  value: number; currency: string; start: string | null; createdAt: string; summary: string; fields: [string, string][]; note: string; conversationId: string | null;
};

export async function loadRecords(businessId: string): Promise<RecordItem[]> {
  const { data, error } = await automationDb.from('automation_outcomes')
    .select('*, automation_conversations(channel_type), automation_contacts(display_name,primary_phone,profile,channel_type)')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return (data || []).map((row: any) => {
    const conversation = Array.isArray(row.automation_conversations) ? row.automation_conversations[0] : row.automation_conversations;
    const contact = Array.isArray(row.automation_contacts) ? row.automation_contacts[0] : row.automation_contacts;
    const channel = row.created_by === 'human' ? 'Manual' : CHANNEL_NAMES[conversation?.channel_type || contact?.channel_type] || 'AI employee';
    const handle = contact?.profile?.username ? `@${contact.profile.username}` : contact?.primary_phone || row.customer_phone || '';
    const fields = Object.entries(row.collected_fields || {}).filter(([label]) => !label.startsWith('_')).map(([label, value]) => [label, String(value ?? '')] as [string, string]);
    if (row.customer_phone && !fields.some(([label]) => /phone/i.test(label))) fields.push(['Phone', row.customer_phone]);
    return {
      id: row.id, reference: row.reference_number, kind: row.outcome_type, customer: row.customer_name || contact?.display_name || 'Customer', handle,
      title: row.title || '', channel, owner: row.assignee || '', status: row.status, value: Number(row.estimated_value_minor || 0) / 100, currency: row.currency || 'USD',
      start: row.scheduled_start, createdAt: row.created_at, summary: row.summary || '', fields, note: row.private_note || '', conversationId: row.conversation_id,
    };
  });
}

export const updateRecord = (businessId: string, id: string, patch: Record<string, unknown>) =>
  authed('automation-outcome-update', { business_id: businessId, outcome_id: id, ...patch });

export function formatMoney(value: number, currency = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toLocaleString()} ${currency}`; }
}
