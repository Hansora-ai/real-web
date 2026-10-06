import common from '../../lib/henshin/common.cjs';
import jobs from '../../lib/henshin/jobs.cjs';
export const config={schedule:'* * * * *'};
export default async request=>{
 // Netlify scheduled functions have no public URL invocation. Match its payload
 // as an additional guard; callers cannot use this as an unauthenticated poller.
 const payload=await request.json().catch(()=>null);
 if(!payload?.next_run)return new Response(null,{status:401});
 const records=await common.db('user_generations?meta->>source_feature=eq.henshin&meta->>status=in.(pending,processing,restoring_audio,audio_retry)&order=meta->>finisher_dispatched_at.asc.nullsfirst&select=id,user_id,result_url,meta&limit=20');
 let dispatched=0;
 await Promise.allSettled((records||[]).map(async row=>{
  if(Number(row.meta.audio_lease_until)>Date.now()||Date.parse(row.meta.audio_retry_at)>Date.now())return;
  // Rotate pending tasks fairly without overwriting a concurrent worker claim.
  const filter=row.meta.audio_lease?'eq.'+encodeURIComponent(row.meta.audio_lease):'is.null';
  const updated=await common.db(`user_generations?id=eq.${row.id}&meta->>audio_lease=${filter}&meta->>status=eq.${row.meta.status}`,{method:'PATCH',body:JSON.stringify({meta:{...row.meta,finisher_dispatched_at:new Date().toISOString()}})});
  if(updated?.length&&(row.meta.task_id||jobs.audioPending(row))&&await jobs.enqueue(updated[0]))dispatched++;
 }));
 return Response.json({ok:true,dispatched});
};
