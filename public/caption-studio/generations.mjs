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
export async function readGenerations(client) {
  if(!client) throw Error('Sign in to Hansora to see your generations.');
  const {data:session}=await client.auth.getSession();
  if(!session?.session?.user?.id) throw Error('Sign in to Hansora to see your generations.');
  const {data,error}=await client.from('user_generations').select('id,provider,kind,prompt,result_url,meta,created_at')
    .eq('user_id',session.session.user.id).order('created_at',{ascending:false}).limit(100);
  if(error) throw Error('Could not load your generations. Try again.');
  return generationMedia(data||[]);
}
