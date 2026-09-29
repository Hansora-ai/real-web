// Per-step results for Instagram comment automations (ManyChat-style stats on each block):
// sent / seen / failed per message step, taps per button, link clicks, and people reaching AI or handoff steps.
import crypto from 'node:crypto';
import { safeEqual } from './crypto.mjs';
import * as db from './db.mjs';
import { instagramMessagingEvents } from './meta.mjs';

export function clickedActionId(payload) {
  const value = String(payload || '');
  if (value === 'HANSORA_HANDOFF') return 'handoff';
  return value.startsWith('HANSORA_FLOW:') ? value.slice('HANSORA_FLOW:'.length) : '';
}

export function nodeForAction(nodes, actionId) {
  if (!actionId) return null;
  return (Array.isArray(nodes) ? nodes : []).find(node => (node?.actions || []).some(action => String(action?.id || '') === actionId || (actionId === 'handoff' && action?.type === 'handoff'))) || null;
}

export async function recordFlowEvent({ businessId, workflowId, sessionId = null, nodeId = '', actionId = '', eventType, idempotencyKey }, overrides = {}) {
  const insert = overrides.serviceInsert || db.serviceInsert;
  if (!businessId || !workflowId || !eventType || !idempotencyKey) return null;
  return insert('automation_flow_events', { business_id: businessId, workflow_id: workflowId, session_id: sessionId, node_id: String(nodeId || '').slice(0, 200), action_id: String(actionId || '').slice(0, 200), event_type: eventType, idempotency_key: String(idempotencyKey).slice(0, 300) }, { ignoreDuplicates: true }).catch(error => { console.error('flow event not recorded', { message: error?.message }); return null; });
}

// Website buttons go through a signed Hansora link so clicks can be counted. The signature stops the
// endpoint being used as an open redirect or for fake clicks.
function linkSecret() { return String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || ''); }
function linkSignature(fields) { return crypto.createHmac('sha256', linkSecret()).update(JSON.stringify(fields)).digest('base64url').slice(0, 32); }

export function trackedLinkUrl({ url, businessId, workflowId, sessionId = '', nodeId = '', actionId = '' }) {
  if (!linkSecret() || !/^https:\/\//i.test(String(url || ''))) return url;
  const site = String(process.env.URL || 'https://hansora.co').replace(/\/$/, '');
  const fields = { u: String(url), b: String(businessId), w: String(workflowId), s: String(sessionId || ''), n: String(nodeId || ''), a: String(actionId || '') };
  const query = new URLSearchParams({ ...fields, sig: linkSignature(fields) });
  return `${site}/.netlify/functions/automation-link?${query}`;
}

export function verifyTrackedLink(params) {
  const fields = { u: String(params.u || ''), b: String(params.b || ''), w: String(params.w || ''), s: String(params.s || ''), n: String(params.n || ''), a: String(params.a || '') };
  if (!linkSecret() || !/^https:\/\//i.test(fields.u) || !safeEqual(String(params.sig || ''), linkSignature(fields))) return null;
  return fields;
}

// Instagram "messaging_seen" webhook events: { read: { mid } }.
export function extractInstagramReads(payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const output = [];
  for (const entry of payload.entry) for (const event of instagramMessagingEvents(entry)) {
    const mid = event?.read?.mid || event?.read?.watermark_mid;
    if (mid && event.sender?.id) output.push({ mid: String(mid), senderId: String(event.sender.id), timestamp: Number(event.timestamp || Date.now()) });
  }
  return output;
}

// Turns raw rows into per-step numbers for the builder.
export function summarizeFlowStats({ nodes = [], executions = [], messages = [], events = [], sessions = [] }) {
  const list = Array.isArray(nodes) ? nodes : [];
  const idAt = index => list[Number(index)]?.id || null;
  const stats = {};
  const bucket = id => (stats[id] ||= { sent: 0, seen: 0, failed: 0, clicks: {}, reached: 0 });
  for (const message of messages) {
    const id = message.metadata?.node_id || idAt(message.metadata?.node_index);
    if (!id) continue;
    const step = bucket(id);
    if (message.status === 'failed') step.failed++;
    else if (['sent', 'delivered', 'read'].includes(message.status)) { step.sent++; if (message.status === 'read') step.seen++; }
  }
  for (const event of events) {
    if (event.event_type !== 'click' || !event.node_id) continue;
    const step = bucket(event.node_id);
    step.clicks[event.action_id || 'unknown'] = (step.clicks[event.action_id || 'unknown'] || 0) + 1;
  }
  for (const session of sessions) {
    const id = idAt(session.current_node_index);
    if (id && ['ai_active', 'human_handling'].includes(session.status)) bucket(id).reached++;
  }
  const trigger = {
    comments: executions.length,
    publicReplies: executions.filter(row => row.public_reply_id).length,
    privateReplies: executions.filter(row => row.private_message_id).length,
    failed: executions.filter(row => row.status === 'failed').length
  };
  return { trigger, nodes: stats };
}

// Swap website buttons for tracked Hansora links (the original URL is kept inside the signed link).
export function withTrackedLinks(prepared, { businessId, workflowId, sessionId = '', nodeId = '' }) {
  return { ...prepared, buttons: (prepared.buttons || []).map(button => button.type === 'web_url' ? { ...button, url: trackedLinkUrl({ url: button.url, businessId, workflowId, sessionId, nodeId, actionId: button.actionId }) } : button) };
}
