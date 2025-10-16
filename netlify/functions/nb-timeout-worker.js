import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async () => {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('user_generations')
    .select('id, user_id, created_at, provider, kind, prompt, result_url, meta')
    .is('result_url', null);
  if (error) return new Response('select error', { status: 500 });

  const timedOut = (rows || []).filter(r =>
    r?.meta?.state === 'pending' &&
    r?.meta?.deadline && new Date(r.meta.deadline).getTime() < Date.now() &&
    !r?.meta?.refunded
  );

  for (const r of timedOut) {
    await supabase.rpc('increment_profile_credits', { p_user_id: r.user_id, p_delta: 0.5 }).catch(async () => {
      const prof = await supabase.from('profiles').select('credits').eq('user_id', r.user_id).maybeSingle();
      const cur = prof?.data?.credits ?? 0;
      await supabase.from('profiles').update({ credits: cur + 0.5 }).eq('user_id', r.user_id);
    });

    const newMeta = { ...(r.meta||{}), state:'failed', failed_reason:'timeout_200s', refunded:true, failed_at: nowIso };
    await supabase.from('user_generations').update({ meta: newMeta }).eq('id', r.id);
  }

  return new Response(`timeout sweep: ${timedOut.length} rows`, { status: 200 });
};
