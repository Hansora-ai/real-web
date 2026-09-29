export function matchesCommentText(workflow, text, excludeKeywords = []) {
  const normalized = String(text || '').trim().toLocaleLowerCase();
  if ((Array.isArray(excludeKeywords) ? excludeKeywords : []).some(word => normalized.includes(String(word).trim().toLocaleLowerCase()))) return false;
  const keywords = (Array.isArray(workflow?.keywords) ? workflow.keywords : []).map(word => String(word).trim().toLocaleLowerCase()).filter(Boolean);
  if (workflow?.match_type === 'any') return true;
  if (workflow?.match_type === 'exact') return keywords.some(word => normalized === word);
  return keywords.some(word => normalized.includes(word));
}

function safeFlowId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function flowActionPayload(action, index = 0) {
  if (action?.type === 'handoff') return 'HANSORA_HANDOFF';
  const id = safeFlowId(action?.id) || `action-${Math.max(0, Number(index) || 0) + 1}`;
  return `HANSORA_FLOW:${id}`;
}

export function preparePrivateReply(node) {
  const actions = (Array.isArray(node?.actions) ? node.actions : []).slice(0, 3);
  const quickReplies = actions
    .filter(action => ['quick_reply', 'handoff'].includes(action?.type) && String(action.label || '').trim())
    .map((action, index) => ({ title:String(action.label).trim(), payload:flowActionPayload(action, index) }));
  const buttons = actions.map((action, index) => {
    const title = String(action?.label || '').trim();
    if (!title) return null;
    if (action?.type === 'website' && /^https:\/\//i.test(String(action.url || ''))) return {type:'web_url',title,url:String(action.url).trim(),actionId:safeFlowId(action.id)};
    if (['quick_reply', 'handoff'].includes(action?.type)) return {type:'postback',title,payload:flowActionPayload(action, index)};
    return null;
  }).filter(Boolean);
  return { text:String(node?.text || '').trim().slice(0, 640), quickReplies, buttons };
}

// The opening DM is the step marked as the comment's private reply (the builder's "Private reply" block),
// falling back to the first message for older flows.
export function openingMessageIndex(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const marked = list.findIndex(node => node?.type === 'message' && node.commentReply && String(node.text || '').trim());
  return marked >= 0 ? marked : list.findIndex(node => node?.type === 'message' && String(node.text || '').trim());
}

export function pickReplyVariation(values, key) {
  let total = 0;
  for (const character of String(key)) total = (total + character.charCodeAt(0)) % 2147483647;
  return values[total % values.length];
}

export function matchesFlowCondition(node, inboundText) {
  const text = String(inboundText || '').trim().toLocaleLowerCase();
  const value = String(node?.value || '').trim().toLocaleLowerCase();
  if (node?.operator === 'any') return Boolean(text);
  if (!value) return false;
  return node?.operator === 'exact' ? text === value : text.includes(value);
}

export function flowDelayMilliseconds(node) {
  const amount = Math.min(30, Math.max(1, Number(node?.amount) || 1));
  const unit = node?.unit === 'day' ? 86_400_000 : node?.unit === 'hour' ? 3_600_000 : 60_000;
  return amount * unit;
}

export function nodeIndexById(nodes, nodeId, fallback = -1) {
  if (!nodeId) return fallback;
  const index = (Array.isArray(nodes) ? nodes : []).findIndex(node => String(node?.id || '') === String(nodeId));
  return index >= 0 ? index : fallback;
}

function nextIndexFor(nodes, node, key, fallback) {
  return nodeIndexById(nodes, node?.[key], fallback);
}

function clickedAction(node, inboundPayload, inboundText) {
  const actions = Array.isArray(node?.actions) ? node.actions : [];
  const payload = String(inboundPayload || '');
  if (payload === 'HANSORA_HANDOFF') return actions.find(action => action?.type === 'handoff') || {type:'handoff'};
  if (payload.startsWith('HANSORA_FLOW:')) {
    const actionId = payload.slice('HANSORA_FLOW:'.length);
    const match = actions.find(action => safeFlowId(action?.id) === actionId);
    if (match) return match;
  }
  const legacyMatch = payload.match(/^HANSORA_REPLY_(\d+)$/);
  if (legacyMatch) return actions.filter(action => action?.type === 'quick_reply')[Number(legacyMatch[1]) - 1] || null;
  const text = String(inboundText || '').trim().toLocaleLowerCase();
  return actions.find(action => ['quick_reply', 'handoff'].includes(action?.type) && String(action.label || '').trim().toLocaleLowerCase() === text) || null;
}

export function planFlowAdvance({ nodes, startIndex = 0, inboundText = '', inboundPayload = '', canUseInbound = true }) {
  const list = Array.isArray(nodes) ? nodes : [];
  const actions = [];
  let index = Math.max(0, Number(startIndex) || 0);
  let inboundAvailable = Boolean(canUseInbound);
  const visited = new Set();

  while (index >= 0 && index < list.length && visited.size <= list.length) {
    if (visited.has(index)) return { actions, status:'failed', nextIndex:index, error:'flow_cycle_detected' };
    visited.add(index);
    const node = list[index] || {};

    if (node.type === 'condition') {
      if (!inboundAvailable) return { actions, status:'awaiting_reply', nextIndex:index };
      const matched = matchesFlowCondition(node, inboundText);
      if (!matched && !node.noId) return { actions, status:'awaiting_reply', nextIndex:index };
      inboundAvailable = false;
      index = nextIndexFor(list, node, matched ? 'yesId' : 'noId', index + 1);
      continue;
    }

    if (node.type === 'message') {
      if (inboundAvailable) {
        const selected = clickedAction(node, inboundPayload, inboundText);
        if (selected?.type === 'handoff') {
          actions.push({ type:'handoff', nodeIndex:index, note:String(selected.note || 'Customer requested a person.').slice(0, 8000) });
          return { actions, status:'human_handling', nextIndex:index };
        }
        const targetId = selected?.nextId || node.replyNextId;
        index = nodeIndexById(list, targetId, index + 1);
        inboundAvailable = ['condition', 'ai'].includes(list[index]?.type);
        continue;
      }

      const prepared = preparePrivateReply(node);
      if (prepared.text) actions.push({ type:'message', nodeIndex:index, ...prepared });
      const conversationalActions = (Array.isArray(node.actions) ? node.actions : []).some(action => ['quick_reply', 'handoff'].includes(action?.type));
      if (conversationalActions || node.waitForReply) return { actions, status:'awaiting_reply', nextIndex:index };
      index = nextIndexFor(list, node, 'nextId', index + 1);
      continue;
    }

    if (node.type === 'delay') {
      const nextIndex = nextIndexFor(list, node, 'nextId', index + 1);
      actions.push({ type:'delay', nodeIndex:index, delayMs:flowDelayMilliseconds(node), nextIndex });
      return { actions, status:'waiting', nextIndex };
    }

    if (node.type === 'handoff') {
      actions.push({ type:'handoff', nodeIndex:index, note:String(node.note || 'A customer needs a person.').slice(0, 8000) });
      return { actions, status:'human_handling', nextIndex:index };
    }

    if (node.type === 'ai') {
      if (!inboundAvailable) return { actions, status:'awaiting_reply', nextIndex:index };
      actions.push({ type:'ai', nodeIndex:index, instruction:String(node.instruction || '').slice(0, 12000), handoff:Boolean(node.handoff) });
      return { actions, status:'ai_active', nextIndex:index };
    }

    index += 1;
  }
  return { actions, status:'completed', nextIndex:Math.max(0, index) };
}
