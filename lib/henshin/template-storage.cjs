const {BASE,KEY,mediaURL}=require('./common.cjs');
function mediaFiles(row){
 const m=row.meta||{};
 return [...new Set([row.result_url,m.source_video_url,m.poster_url,m.preview_url,...(m.reference_image_urls||[]),...(m.retired_media_urls||[])].filter(Boolean))];
}
async function removeFiles(urls){
 const buckets=new Map();
 for(const url of new Set(urls)){
  if(!mediaURL(url))throw Error('Invalid template media.');
  const parts=new URL(url).pathname.slice('/storage/v1/object/public/'.length).split('/').map(decodeURIComponent),bucket=parts.shift(),key=parts.join('/');
  if(!bucket||!key||parts.some(p=>!p||p==='.'||p==='..'))throw Error('Invalid template media.');
  if(!buckets.has(bucket))buckets.set(bucket,[]);buckets.get(bucket).push(key);
 }
 for(const [bucket,prefixes]of buckets){
  const res=await fetch(`${BASE}/storage/v1/object/${encodeURIComponent(bucket)}`,{method:'DELETE',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes}),signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Object.assign(Error('Could not delete template files. Please try again.'),{status:502});
 }
}
module.exports={mediaFiles,removeFiles};
