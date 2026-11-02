const kindFor=row=>/audio|speech|music/.test(row.kind||'')?'audio':/video/.test(row.kind||'')?'video':'image';
export function generationMedia(rows) {
  const output=[];
  for(const row of rows) {
    const meta=row.meta||{};
    if(/fail|reject|cancel|pending|processing|queued/.test(meta.status||'')) continue;
    if(meta.source_audio_url && !meta.audio_restored && /henshin/i.test(row.provider||'')) continue;
    const urls=[row.result_url,meta.result_url,...(Array.isArray(meta.result_urls)?meta.result_urls:[]),...(Array.isArray(meta.urls)?meta.urls:[])];
    for(const [index,url] of [...new Set(urls)].entries()) {
      if(typeof url!=='string' || !/^https:\/\//i.test(url)) continue;
      output.push({id:`${row.id}:${index}`,url,kind:kindFor(row),title:String(row.prompt||row.provider||'My generation').slice(0,100),date:row.created_at});
    }
  }
  return output;
}
export const GENERATIONS_PAGE = 30;
// One page of the signed-in user's generations, newest first, filtered on the server.
export async function readGenerations(client, { page = 1, kind = 'all', pageSize = GENERATIONS_PAGE } = {}) {
  if(!client) throw Error('Sign in to Hansora to see your generations.');
  const {data:session}=await client.auth.getSession();
  if(!session?.session?.user?.id) throw Error('Sign in to Hansora to see your generations.');
  let query=client.from('user_generations').select('id,provider,kind,prompt,result_url,meta,created_at',{count:'exact'})
    .eq('user_id',session.session.user.id);
  if(kind==='video') query=query.ilike('kind','%video%');
  else if(kind==='audio') query=query.or('kind.ilike.%audio%,kind.ilike.%speech%,kind.ilike.%music%');
  else if(kind==='image') for(const word of ['video','audio','speech','music']) query=query.not('kind','ilike',`%${word}%`);
  const from=(Math.max(1,page)-1)*pageSize;
  const {data,error,count}=await query.order('created_at',{ascending:false}).range(from,from+pageSize-1);
  if(error) throw Error('Could not load your generations. Try again.');
  return {items:generationMedia(data||[]),pages:Math.max(1,Math.ceil((count||0)/pageSize)),page};
}
