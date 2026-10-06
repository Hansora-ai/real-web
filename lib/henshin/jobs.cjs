const crypto=require('node:crypto');
const {KEY}=require('./common.cjs');
function internalToken(){return KEY?crypto.createHmac('sha256',KEY).update('henshin-background-v1').digest('hex'):'';}
function internal(event){
 const token=event.headers?.['x-henshin-internal']||'';
 const a=Buffer.from(token),b=Buffer.from(internalToken());
 return b.length>0&&a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function audioPending(row){return !!(row?.meta?.source_audio_url&&!row.meta.audio_restored&&(row.meta.generated_video_url||row.result_url));}
async function enqueue(row){
 if(!KEY||row.meta?.audio_restored||row.meta?.status==='audio_failed')return false;
 if(Number(row.meta?.audio_lease_until)>Date.now())return false;
 if(Date.parse(row.meta?.audio_retry_at)>Date.now())return false;
 const site=(process.env.DEPLOY_PRIME_URL||process.env.SITE_BASE||process.env.URL||'https://hansora.co').replace(/\/$/,'');
 const response=await fetch(`${site}/.netlify/functions/henshin-finish-background`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','x-henshin-internal':internalToken()},body:JSON.stringify({id:row.id})});
 if(!response.ok)throw Error('Could not queue Henshin completion.');
 // Do not patch stale metadata after dispatch: the worker may already claim it.
 return true;
}
module.exports={internal,internalToken,audioPending,enqueue};
