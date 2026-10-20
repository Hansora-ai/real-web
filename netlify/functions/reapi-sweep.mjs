import common from '../../lib/henshin/common.cjs';
import checker from '../../lib/reapi/check.cjs';
export const config={schedule:'* * * * *'};
export default async request=>{
  const payload=await request.json().catch(()=>null);
  if(!payload?.next_run)return new Response(null,{status:401});
  const rows=await common.db('user_generations?meta->>source=eq.reapi&meta->>status=in.(pending,processing)&result_url=is.null&order=meta->>reapi_checked_at.asc.nullsfirst&select=id,user_id,result_url,meta,created_at&limit=8');
  // Bound concurrency and function duration. The next sweep resumes other rows.
  for(let i=0;i<(rows||[]).length;i+=4)await Promise.allSettled(rows.slice(i,i+4).map(row=>checker.reconcile(row)));
  return Response.json({ok:true,checked:rows?.length||0});
};
