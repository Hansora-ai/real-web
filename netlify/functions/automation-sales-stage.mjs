import { rows, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';
import { updateSalesStage } from '../../lib/automation/sales-stage.mjs';
import { isInternalCall, isScheduledRun } from '../../lib/automation/schedule.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// Every 10 minutes: chats that have been quiet for 30 minutes and changed since their last check get their buying
// stage read once (Inbox: Ready / Interested / Went quiet / Lost, "Interested in", "Likely value").
export async function pickQuietChats(list, now = Date.now()) {
  return list.filter(chat => chat.channel_type !== 'test' && Date.parse(chat.last_message_at) <= now - 30 * 60000 && (!chat.sales_updated_at || Date.parse(chat.sales_updated_at) < Date.parse(chat.last_message_at)));
}

export async function handler(event) {
  if (!isScheduledRun(event) && !isInternalCall(event)) return json(401, { error: 'unauthorized' });
  const now = Date.now();
  const from = new Date(now - 3 * 86400000).toISOString(), to = new Date(now - 30 * 60000).toISOString();
  const recent = rows(await supabaseRequest(`/rest/v1/automation_conversations?last_message_at=gte.${from}&last_message_at=lte.${to}&select=id,business_id,channel_type,last_message_at,sales_updated_at&order=last_message_at.desc&limit=500`));
  const due = (await pickQuietChats(recent, now)).slice(0, 60);
  let checked = 0;
  for (let i = 0; i < due.length; i += 4) {
    const batch = due.slice(i, i + 4);
    const results = await Promise.all(batch.map(chat => updateSalesStage({ businessId: chat.business_id, conversationId: chat.id }).catch(() => null)));
    // No result (empty chat, unreadable answer): marked as checked anyway, so it is not retried every 10 minutes.
    await Promise.all(batch.map((chat, index) => results[index] ? null : serviceUpdate('automation_conversations', `id=eq.${chat.id}`, { sales_updated_at: new Date().toISOString() }).catch(() => null)));
    checked += results.filter(Boolean).length;
  }
  return json(200, { ok: true, due: due.length, checked });
}
