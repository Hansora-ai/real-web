import crypto from 'node:crypto';
import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { sha256 } from '../../lib/automation/crypto.mjs';
import { first, rows, serviceInsert, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { NOTIFICATION_EVENTS, normalizePhone, notifyOwner, sendVerificationCode } from '../../lib/automation/notify.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});
const codeHash=(businessId,phone,code)=>sha256(`${businessId}:${phone}:${code}`);

// Owner notification settings. The owner's WhatsApp number is saved only after they enter the code
// Hansora sent to it, so alerts can never be pointed at someone else's phone.
export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    if(!isUuid(body.business_id))return json(400,{error:'invalid_business_id'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id,name&limit=1`);if(!business)return json(404,{error:'business_not_found'});
    const settings=await first(`/rest/v1/automation_notification_settings?business_id=eq.${business.id}&select=*&limit=1`);
    const now=new Date().toISOString();

    if(body.action==='save'){
      const events=Array.isArray(body.events)?[...new Set(body.events.map(String))].filter(item=>NOTIFICATION_EVENTS.includes(item)):undefined;
      const email=body.email===undefined?undefined:String(body.email||'').trim().toLowerCase();
      if(email&&(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>320))return json(400,{error:'invalid_email'});
      const whatsappEnabled=Boolean(body.whatsapp_enabled);
      if(whatsappEnabled&&!settings?.whatsapp_verified_at)return json(409,{error:'whatsapp_not_verified'});
      const saved=await serviceUpsert('automation_notification_settings','business_id',{business_id:business.id,email_enabled:Boolean(body.email_enabled),whatsapp_enabled:whatsappEnabled,...(email!==undefined?{email:email||null}:{}),...(events?{events}:{}),...(['en','hy','ru'].includes(body.language)?{language:body.language}:{}),updated_at:now});
      return json(200,{ok:true,settings:publicSettings(saved)});
    }

    if(body.action==='send_code'){
      const phone=normalizePhone(body.phone);if(!phone)return json(400,{error:'invalid_phone'});
      const recent=rows(await supabaseRequest(`/rest/v1/automation_notification_verifications?business_id=eq.${business.id}&created_at=gt.${encodeURIComponent(new Date(Date.now()-3600000).toISOString())}&select=id`));
      if(recent.length>=5)return json(429,{error:'too_many_codes'});
      const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
      await serviceInsert('automation_notification_verifications',{business_id:business.id,phone,code_hash:codeHash(business.id,phone,code),expires_at:new Date(Date.now()+10*60000).toISOString()});
      await sendVerificationCode({to:phone,code,language:settings?.language||'en'});
      return json(200,{ok:true,phone});
    }

    if(body.action==='verify'){
      const phone=normalizePhone(body.phone),code=String(body.code||'').trim();
      if(!phone||!/^\d{6}$/.test(code))return json(400,{error:'invalid_code'});
      const pending=await first(`/rest/v1/automation_notification_verifications?business_id=eq.${business.id}&phone=eq.${phone}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=*&order=created_at.desc&limit=1`);
      if(!pending)return json(400,{error:'code_expired'});
      if(pending.attempts>=5)return json(429,{error:'too_many_attempts'});
      if(pending.code_hash!==codeHash(business.id,phone,code)){await serviceUpdate('automation_notification_verifications',`id=eq.${pending.id}`,{attempts:pending.attempts+1});return json(400,{error:'wrong_code'});}
      const claimed=await serviceUpdate('automation_notification_verifications',`id=eq.${pending.id}&consumed_at=is.null`,{consumed_at:now});if(!claimed.length)return json(400,{error:'code_expired'});
      const saved=await serviceUpsert('automation_notification_settings','business_id',{business_id:business.id,whatsapp_phone:phone,whatsapp_verified_at:now,whatsapp_enabled:true,updated_at:now});
      return json(200,{ok:true,settings:publicSettings(saved)});
    }

    if(body.action==='remove_whatsapp'){
      const saved=await serviceUpsert('automation_notification_settings','business_id',{business_id:business.id,whatsapp_phone:null,whatsapp_verified_at:null,whatsapp_enabled:false,updated_at:now});
      return json(200,{ok:true,settings:publicSettings(saved)});
    }

    if(body.action==='test'){
      const results=await notifyOwner({businessId:business.id,event:'test',idempotencyKey:`test:${Date.now()}`,data:{businessId:business.id,business:business.name,customer:'Hansora test',details:'Notifications are working',channel:'Test'}});
      return json(200,{ok:true,results:results.map(item=>({channel:item.channel,status:item.status}))});
    }

    return json(400,{error:'unknown_action'});
  }catch(error){console.error('automation-notifications error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});const status=Number(error?.status)||500;return json(status,{error:status===503?String(error.message):status>=500?'notifications_unavailable':String(error?.message||'notifications_failed')});}
}

function publicSettings(row){return row?{whatsapp_enabled:row.whatsapp_enabled,whatsapp_phone:row.whatsapp_phone,whatsapp_verified:Boolean(row.whatsapp_verified_at),email_enabled:row.email_enabled,email:row.email,events:row.events,language:row.language}:null;}
