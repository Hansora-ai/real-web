// HTTP success alone does not mean KIE accepted a generation.
function acceptedTaskId(data) {
  if (data?.code != null && Number(data.code) !== 200) return null;
  const value = data?.taskId || data?.id || data?.data?.taskId || data?.data?.id;
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && !/^(null|undefined)$/i.test(id) ? id : null;
}

// The database checks age, provider, latest task ID and billing again while
// holding a row lock. Never fall back to a separate profile PATCH here.
async function resolveMissingTask(generationId = null) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !key) throw new Error('missing_refund_config');
  const name = generationId ? 'resolve_kie_missing_task' : 'sweep_kie_missing_tasks';
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(generationId ? { p_generation_id: generationId } : { p_limit: 100 }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`missing_task_recovery_failed_${response.status}`);
  return response.json();
}

module.exports = { acceptedTaskId, resolveMissingTask };
