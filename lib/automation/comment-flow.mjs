// Like ManyChat, the most specific comment automation wins: chosen posts before "next post" before all posts, and
// a keyword before "any comment". Sort is stable, so equal ones keep their order (most recently edited first).
export function automationPriority(workflow) {
  return ({ selected: 20, next: 10, all: 0 }[workflow?.post_scope] || 0) + (workflow?.match_type === 'exact' ? 2 : workflow?.match_type === 'contains' ? 1 : 0);
}
export const byPriority = (a, b) => automationPriority(b) - automationPriority(a);

// Comments are compared the way people write them: capitals, punctuation, emojis, @mentions and extra spaces do not
// matter, and a one-letter typo in a keyword of 5+ letters still counts ("Promt" → "prompt").
export function normalizeCommentText(text) {
  return String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/@[\p{L}\p{N}._]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function oneEditApart(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const typoMatch = (word, keyword) => keyword.length >= 5 && !keyword.includes(' ') && oneEditApart(word, keyword);

export function matchesCommentText(workflow, text, excludeKeywords = []) {
  const normalized = normalizeCommentText(text);
  const clean = list => (Array.isArray(list) ? list : []).map(normalizeCommentText).filter(Boolean);
  if (clean(excludeKeywords).some(word => ` ${normalized} `.includes(` ${word} `))) return false;
  const keywords = clean(workflow?.keywords);
  if (workflow?.match_type === 'any') return true;
  if (workflow?.match_type === 'exact') return keywords.some(word => normalized === word || (!normalized.includes(' ') && typoMatch(normalized, word)));
  const words = normalized.split(' ');
  return keywords.some(word => normalized.includes(word) || words.some(item => typoMatch(item, word)));
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
// The step connected to the trigger ("entry"). DM automations may start with any step; after a comment Instagram
// allows only a message first, so comment automations use openingMessageIndex.
export function entryIndex(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const marked = list.findIndex(node => node?.entry);
  return marked >= 0 ? marked : openingMessageIndex(list);
}

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

// ManyChat-style condition rules. facts: { follows: true|false|null|undefined, followerCount, tags: [], fields: {} }.
// A rule that needs Instagram data not loaded yet returns undefined, so the runner can load it and plan again.
export const CONDITION_FIELDS = ['follows', 'follower_count', 'tag', 'field', 'reply'];
export function conditionRules(node) {
  if (Array.isArray(node?.rules) && node.rules.length) return node.rules;
  return [{ field: 'reply', op: node?.operator || 'contains', value: node?.value || '' }]; // older flows: reply text only
}
export function needsReply(node) { return conditionRules(node).some(rule => rule?.field === 'reply'); }
export function evaluateRule(rule, { facts = {}, inboundText = '' } = {}) {
  const value = String(rule?.value ?? '').trim();
  switch (rule?.field) {
    case 'follows': {
      if (facts.follows === undefined) return undefined;
      const follows = facts.follows === true;
      return rule.op === 'is_false' ? !follows : follows;
    }
    case 'follower_count': {
      if (facts.followerCount === undefined) return undefined;
      const count = Number(facts.followerCount) || 0, target = Number(value) || 0;
      return rule.op === 'lt' ? count < target : rule.op === 'lte' ? count <= target : rule.op === 'gt' ? count > target : count >= target;
    }
    case 'tag': {
      const has = (facts.tags || []).map(tag => String(tag).toLocaleLowerCase()).includes(value.toLocaleLowerCase());
      return rule.op === 'not_has' ? !has : has;
    }
    case 'field': {
      const current = String((facts.fields || {})[String(rule.key || '')] ?? '').trim();
      if (rule.op === 'is_set') return Boolean(current);
      if (rule.op === 'not_set') return !current;
      if (rule.op === 'contains') return current.toLocaleLowerCase().includes(value.toLocaleLowerCase());
      return current.toLocaleLowerCase() === value.toLocaleLowerCase();
    }
    case 'reply':
    default:
      return matchesFlowCondition({ operator: rule?.op || 'contains', value }, inboundText);
  }
}
export function evaluateCondition(node, context) {
  const results = conditionRules(node).map(rule => evaluateRule(rule, context));
  if (results.some(result => result === undefined)) return undefined;
  return node?.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}
// Which Instagram facts a condition needs (loaded only when the flow actually reaches it).
export function neededFacts(node) {
  return [...new Set(conditionRules(node).filter(rule => ['follows', 'follower_count'].includes(rule?.field)).map(rule => rule.field === 'follows' ? 'follows' : 'followerCount'))];
}

// Collect info: validates what the customer typed.
export function validateInput(kind, text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value.toLowerCase() : null;
  if (kind === 'phone') { const digits = value.replace(/[^\d+]/g, ''); return digits.replace(/\D/g, '').length >= 7 && digits.replace(/\D/g, '').length <= 15 ? digits : null; }
  if (kind === 'number') { const number = Number(value.replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(number) && /\d/.test(value) ? String(number) : null; }
  return value.slice(0, 1000);
}

// Randomizer: picks a branch by its percentage.
export function pickBranch(branches, random = Math.random) {
  const list = (Array.isArray(branches) ? branches : []).filter(branch => Number(branch?.percent) > 0);
  const total = list.reduce((sum, branch) => sum + Number(branch.percent), 0);
  if (!total) return null;
  let roll = random() * total;
  for (const branch of list) { roll -= Number(branch.percent); if (roll < 0) return branch; }
  return list[list.length - 1];
}

// Actions step: tags and fields change the facts right away, so later conditions in the same run see them.
export function applyOpsToFacts(facts, ops = []) {
  const next = { ...facts, tags: [...(facts.tags || [])], fields: { ...(facts.fields || {}) } };
  for (const op of ops) {
    const value = String(op?.value || '').trim();
    if (op?.type === 'add_tag' && value && !next.tags.some(tag => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) next.tags.push(value.slice(0, 60));
    if (op?.type === 'remove_tag') next.tags = next.tags.filter(tag => tag.toLocaleLowerCase() !== value.toLocaleLowerCase());
    if (op?.type === 'set_field' && op.key) next.fields[String(op.key).slice(0, 60)] = value.slice(0, 1000);
    if (op?.type === 'clear_field' && op.key) delete next.fields[String(op.key)];
  }
  return next;
}

export function flowDelayMilliseconds(node) {
  if (node?.unit === 'second') return Math.min(50, Math.max(1, Number(node?.amount) || 1)) * 1000;
  const amount = Math.min(30, Math.max(1, Number(node?.amount) || 1));
  const unit = node?.unit === 'day' ? 86_400_000 : node?.unit === 'hour' ? 3_600_000 : 60_000;
  return amount * unit;
}

// Extra content sent before a message's text: images, videos, card carousels, extra texts and typing pauses.
export function messageBlocks(node) {
  return (Array.isArray(node?.blocks) ? node.blocks : []).slice(0, 10).filter(block => {
    if (block?.type === 'typing') return Number(block.seconds) > 0;
    if (['image', 'video', 'audio', 'file', 'dynamic'].includes(block?.type)) return /^https:\/\//i.test(String(block.url || ''));
    if (block?.type === 'cards') return (block.cards || []).some(card => String(card?.title || '').trim());
    if (block?.type === 'text') return String(block.text || '').trim();
    return false;
  });
}
// "If they don't tap": resend a reminder with the same buttons after a while (inside Instagram's 24-hour window).
export function followUpConfig(node) {
  const followUp = node?.followUp || {};
  if (!followUp.enabled || node?.commentReply || !String(followUp.text || '').trim()) return null;
  const amount = Math.min(followUp.unit === 'hour' ? 23 : 59, Math.max(1, Number(followUp.amount) || 1));
  return { delayMs: amount * (followUp.unit === 'hour' ? 3_600_000 : 60_000), text: String(followUp.text).slice(0, 640) };
}

export function nodeIndexById(nodes, nodeId, fallback = -1) {
  if (!nodeId) return fallback;
  const index = (Array.isArray(nodes) ? nodes : []).findIndex(node => String(node?.id || '') === String(nodeId));
  return index >= 0 ? index : fallback;
}

// A step that has the connection field set (even to "none") follows it exactly: none means the flow ends there.
// Older flows without the field continue with the next step in the list, as before.
function nextIndexFor(nodes, node, key, fallback) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (node && Object.prototype.hasOwnProperty.call(node, key)) return node[key] ? nodeIndexById(list, node[key], list.length) : list.length;
  return nodeIndexById(list, node?.[key], fallback);
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

// Plans what happens next from startIndex. Pure: returns actions for the runner. facts: Instagram and saved
// customer data; checks: how many times each condition already failed for this person (for "let through after N").
// status 'needs_facts' means a condition needs Instagram data that is not loaded: load facts.needs and plan again.
export function planFlowAdvance({ nodes, startIndex = 0, inboundText = '', inboundPayload = '', canUseInbound = true, facts = {}, checks = {}, random = Math.random }) {
  const list = Array.isArray(nodes) ? nodes : [];
  const actions = [];
  let index = Math.max(0, Number(startIndex) || 0);
  let inboundAvailable = Boolean(canUseInbound);
  let currentFacts = { tags: [], fields: {}, ...facts };
  const checkUpdates = {};
  const visited = new Set();
  const done = (status, nextIndex, extra = {}) => ({ actions, status, nextIndex, ...(Object.keys(checkUpdates).length ? { checks: checkUpdates } : {}), ...extra });

  while (index >= 0 && index < list.length && visited.size <= list.length * 2) {
    // The same step may come twice in one run (a tap on a message, then that message is sent again after a check);
    // the same step in the same situation twice is a real loop.
    const state = `${index}:${inboundAvailable ? 'reply' : 'send'}`;
    if (visited.has(state)) return done('failed', index, { error:'flow_cycle_detected' });
    visited.add(state);
    const node = list[index] || {};

    if (node.type === 'condition') {
      const replyBased = needsReply(node);
      if (replyBased && !inboundAvailable) return done('awaiting_reply', index);
      const verdict = evaluateCondition(node, { facts: currentFacts, inboundText });
      if (verdict === undefined) return { actions: [], status: 'needs_facts', nextIndex: index, needs: neededFacts(node) };
      let matched = verdict;
      // "Let them through after N tries" (for example a follow check that keeps saying no).
      const passAfter = Math.max(0, Number(node.passAfter) || 0);
      if (!matched && passAfter && node.id) {
        const failures = Number(checks[node.id] || 0) + 1;
        checkUpdates[node.id] = failures;
        if (failures >= passAfter) matched = true;
      }
      if (replyBased && !matched && !node.noId && !Array.isArray(node.rules)) return done('awaiting_reply', index);
      if (replyBased) inboundAvailable = false;
      const target = matched ? node.yesId : node.noId;
      if (!target && !matched && Array.isArray(node.rules)) return done('completed', index);
      index = nextIndexFor(list, node, matched ? 'yesId' : 'noId', index + 1);
      continue;
    }

    if (node.type === 'message') {
      if (inboundAvailable) {
        const selected = clickedAction(node, inboundPayload, inboundText);
        if (selected?.type === 'handoff') {
          actions.push({ type:'handoff', nodeIndex:index, note:String(selected.note || 'Customer requested a person.').slice(0, 8000) });
          return done('human_handling', index);
        }
        // A tapped button goes where it is connected; a typed reply goes to "If they type instead".
        const targetId = selected ? selected.nextId : node.replyNextId;
        // No route (a typed reply without one, or a button added with "Decide later") ends the flow and the AI answers.
        // Older flows without routes simply continue with the next step.
        index = targetId ? nodeIndexById(list, targetId, list.length) : (Object.prototype.hasOwnProperty.call(node, 'replyNextId') ? list.length : index + 1);
        // A tap is used up by the button; only a typed reply can feed a reply condition, AI or collect-info step.
        const nextType = list[index]?.type;
        inboundAvailable = nextType === 'ai' || (nextType === 'condition' && needsReply(list[index]));
        continue;
      }

      const prepared = preparePrivateReply(node);
      const blocks = messageBlocks(node);
      const conversationalActions = (Array.isArray(node.actions) ? node.actions : []).some(action => ['quick_reply', 'handoff'].includes(action?.type));
      const followUp = conversationalActions ? followUpConfig(node) : null;
      if (prepared.text || blocks.length) actions.push({ type:'message', nodeIndex:index, ...prepared, blocks, ...(followUp ? { followUp } : {}) });
      if (conversationalActions || node.waitForReply) return done('awaiting_reply', index);
      index = nextIndexFor(list, node, 'nextId', index + 1);
      continue;
    }

    if (node.type === 'input') {
      if (inboundAvailable) {
        const value = validateInput(node.kind, inboundText);
        if (value === null) {
          actions.push({ type:'message', nodeIndex:index, text:String(node.retryText || 'Sorry, that does not look right. Please try again.').slice(0, 640), quickReplies:[], buttons:[], retry:true });
          return done('awaiting_reply', index);
        }
        const key = String(node.saveTo || node.kind || 'answer').slice(0, 60);
        const ops = [{ type:'set_field', key, value }];
        actions.push({ type:'ops', nodeIndex:index, ops, contact: ['email', 'phone'].includes(node.kind) ? { [node.kind]: value } : null });
        currentFacts = applyOpsToFacts(currentFacts, ops);
        inboundAvailable = false;
        index = nextIndexFor(list, node, 'nextId', list.length);
        continue;
      }
      const question = String(node.text || '').trim();
      if (question) actions.push({ type:'message', nodeIndex:index, text:question.slice(0, 640), quickReplies:[], buttons:[] });
      return done('awaiting_reply', index);
    }

    if (node.type === 'action') {
      const ops = (Array.isArray(node.ops) ? node.ops : []).slice(0, 10);
      if (ops.length) actions.push({ type:'ops', nodeIndex:index, ops });
      currentFacts = applyOpsToFacts(currentFacts, ops);
      index = nextIndexFor(list, node, 'nextId', list.length);
      continue;
    }

    if (node.type === 'randomizer') {
      const branch = pickBranch(node.branches, random);
      if (!branch?.nextId) return done('completed', index);
      index = nodeIndexById(list, branch.nextId, list.length);
      continue;
    }

    if (node.type === 'delay' && node.unit === 'second') {
      // Short pauses (seconds) happen right away in the same run, with "typing…" shown to the customer.
      actions.push({ type:'pause', nodeIndex:index, ms:flowDelayMilliseconds(node) });
      index = nextIndexFor(list, node, 'nextId', index + 1);
      continue;
    }

    if (node.type === 'delay') {
      const nextIndex = nextIndexFor(list, node, 'nextId', index + 1);
      actions.push({ type:'delay', nodeIndex:index, delayMs:flowDelayMilliseconds(node), nextIndex });
      return done('waiting', nextIndex);
    }

    if (node.type === 'handoff') {
      actions.push({ type:'handoff', nodeIndex:index, note:String(node.note || 'A customer needs a person.').slice(0, 8000) });
      return done('human_handling', index);
    }

    if (node.type === 'ai') {
      if (!inboundAvailable) return done('awaiting_reply', index);
      actions.push({ type:'ai', nodeIndex:index, instruction:String(node.instruction || '').slice(0, 12000), handoff:Boolean(node.handoff) });
      return done('ai_active', index);
    }

    index += 1;
  }
  return done('completed', Math.max(0, index));
}
