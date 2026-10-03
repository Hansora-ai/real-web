const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OWNER = 'hansora.ai.bot@gmail.com';
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const json = (statusCode, value) => ({statusCode, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}, body:JSON.stringify(value)});
async function auth(event) {
  const bearer = event.headers?.authorization || event.headers?.Authorization || '';
  if (!/^Bearer \S+$/i.test(bearer)) throw Object.assign(Error('Sign in first.'), {status:401});
  const res = await fetch(`${BASE}/auth/v1/user`, {headers:{apikey:KEY, Authorization:bearer}});
  const user = await res.json();
  if (!res.ok || !user.id) throw Object.assign(Error('Session expired. Sign in again.'), {status:401});
  return user;
}
async function db(path, options={}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {...options, headers:{...headers, Prefer:'return=representation', ...options.headers}});
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw Object.assign(Error('Could not save Henshin data.'), {status:res.status===409?409:502});
  return data;
}
function mediaURL(value) {
  try { const u=new URL(value); return u.origin===new URL(BASE).origin && u.pathname.startsWith('/storage/v1/object/public/') && !u.username && !u.password; } catch { return false; }
}
const rates = {'480p':2,'720p':4.2,'1080p':9};
function validate(body) {
  if (!Object.hasOwn(rates,body.resolution)) throw Error('Choose 480p, 720p or 1080p.');
  const seconds=Number(body.source_video_duration);
  if (!Number.isFinite(seconds)||seconds<4||seconds>30) throw Error('Source video must be 4–30 seconds.');
  if (!mediaURL(body.video_url)) throw Error('Upload a source video first.');
  if (!['motion','swap'].includes(body.mode)) throw Error('Choose a transformation mode.');
  if (!Array.isArray(body.image_urls)||!body.image_urls.length||body.image_urls.length>30||!body.image_urls.every(mediaURL)) throw Error('Upload 1–30 reference images.');
  if (body.audio_url && !mediaURL(body.audio_url)) throw Error('Invalid source audio.');
  if (typeof body.run_id!=='string'||body.run_id.length<8||body.run_id.length>160) throw Error('Invalid run identifier.');
  return {seconds, cost:Number((Math.ceil(seconds)*rates[body.resolution]).toFixed(1))};
}
function promptFor(body) {
  const tags=body.image_urls.map((_,i)=>`@Image ${i+1}`).join(', ');
  return [`Use @Video 1 as the sole master for the complete shot sequence, camera position, camera angles, camera path, lens perspective, framing, crop, cuts, background geometry, lighting, duration and timing.`,
    `Preserve the exact original choreography, body movements, expressions, action order, rhythm and subject placement. Do not add camera angles, cuts, zooms, reframing, extra people or actions.`,
    body.mode==='swap' ? `Change only the element described below using ${tags}; leave all other subjects, objects and the environment as in @Video 1.` : `Replace the main character with the character shown in ${tags}. Use these images only for replacement identity and appearance, never their camera angle, framing or pose. Preserve everything else from @Video 1.`,
    'Keep replacement identity consistent throughout, including occlusions. No identity drift.',
    body.audio_url ? 'Use @Audio 1 only as the original timing and rhythm reference. Match its synchronization.' : '',
    `Requested transformation: ${String(body.prompt||'Replace the main character using the reference images.').trim().slice(0,2000)}`].filter(Boolean).join('\n');
}
module.exports={BASE,KEY,OWNER,json,auth,db,mediaURL,rates,validate,promptFor};
