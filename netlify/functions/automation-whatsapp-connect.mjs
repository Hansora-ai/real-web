import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { decryptSecret, encryptSecret } from '../../lib/automation/crypto.mjs';
import { first, rows, serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { exchangeWhatsAppCode, generateWhatsAppPin, getWhatsAppPhone, registerWhatsAppPhone, subscribeWhatsAppApp } from '../../lib/automation/whatsapp.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(statusCode,body)=>({statusCode,headers:HEADERS,body:JSON.stringify(body)});

// Two calls are possible: the first carries the single-use Embedded Signup code; if the number already has a
// two-step verification PIN, the owner retries with only phone_number_id + pin and the stored token is reused.
export async function handler(event){
  if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  try{
    const user=await authenticateRequest(event);if(!user)return json(401,{error:'authentication_required'});
    let body;try{body=JSON.parse(event.body||'{}')}catch(_){return json(400,{error:'invalid_json'})}
    const code=String(body.code||'').trim(),wabaId=String(body.waba_id||'').trim(),phoneNumberId=String(body.phone_number_id||'').trim(),ownerPin=String(body.pin||'').trim();
    if(!isUuid(body.business_id)||!/^\d{5,40}$/.test(phoneNumberId)||code.length>4000)return json(400,{error:'invalid_whatsapp_connection'});
    if(ownerPin&&!/^\d{6}$/.test(ownerPin))return json(400,{error:'whatsapp_pin_invalid'});
    if(!code&&!ownerPin)return json(400,{error:'invalid_whatsapp_connection'});
    if(code&&!/^\d{5,40}$/.test(wabaId))return json(400,{error:'invalid_whatsapp_connection'});
    const business=await first(`/rest/v1/automation_businesses?id=eq.${body.business_id}&owner_user_id=eq.${user.id}&select=id&limit=1`);if(!business)return json(404,{error:'business_not_found'});

    let resource,accessToken;
    if(code){
      const token=await exchangeWhatsAppCode(code);accessToken=token.accessToken;
      const phone=await getWhatsAppPhone({phoneNumberId,accessToken});
      await subscribeWhatsAppApp({wabaId,accessToken});
      const oldResources=rows(await supabaseRequest(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.whatsapp_account&status=in.(active,pending)&select=id,provider_resource_id`));
      for(const old of oldResources)if(old.provider_resource_id!==phoneNumberId)await serviceUpdate('automation_provider_resources',`id=eq.${old.id}`,{status:'revoked',updated_at:new Date().toISOString()});
      const expiresAt=token.expiresIn?new Date(Date.now()+token.expiresIn*1000).toISOString():null;
      resource=await serviceUpsert('automation_provider_resources','business_id,provider,resource_type,provider_resource_id',{business_id:business.id,provider:'meta',resource_type:'whatsapp_account',provider_resource_id:phoneNumberId,status:'pending',safe_config:{waba_id:wabaId,display_phone_number:phone.displayPhoneNumber,verified_name:phone.verifiedName,quality_rating:phone.qualityRating,verification_status:phone.verificationStatus,platform_type:phone.platformType,token_expires_at:expiresAt},last_synced_at:new Date().toISOString()});
      if(!resource)throw new Error('whatsapp_resource_not_saved');
      await serviceUpsert('automation_provider_credentials','provider_resource_id,credential_type',{business_id:business.id,provider_resource_id:resource.id,credential_type:'access_token',...encryptSecret(accessToken),expires_at:expiresAt});
    }else{
      resource=await first(`/rest/v1/automation_provider_resources?business_id=eq.${business.id}&provider=eq.meta&resource_type=eq.whatsapp_account&provider_resource_id=eq.${phoneNumberId}&status=in.(pending,active)&select=*&limit=1`);
      if(!resource)return json(404,{error:'whatsapp_signup_not_found'});
      const credential=await first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${resource.id}&credential_type=eq.access_token&select=*&limit=1`);
      if(!credential)return json(404,{error:'whatsapp_signup_not_found'});
      accessToken=decryptSecret(credential);
    }

    // Embedded Signup numbers must be registered for Cloud API before they can send or receive messages.
    const phone=await getWhatsAppPhone({phoneNumberId,accessToken});
    if(phone.platformType!=='CLOUD_API'){
      const pin=ownerPin||generateWhatsAppPin();
      try{await registerWhatsAppPhone({phoneNumberId,pin,accessToken});}
      catch(error){if(error?.status===400)return json(409,{error:ownerPin?'whatsapp_pin_incorrect':'whatsapp_pin_required'});throw error;}
      await serviceUpsert('automation_provider_credentials','provider_resource_id,credential_type',{business_id:business.id,provider_resource_id:resource.id,credential_type:'registration_pin',...encryptSecret(pin),expires_at:null});
    }

    const safeConfig={...(resource.safe_config||{}),display_phone_number:phone.displayPhoneNumber,verified_name:phone.verifiedName,quality_rating:phone.qualityRating,verification_status:phone.verificationStatus,platform_type:'CLOUD_API'};
    await serviceUpdate('automation_provider_resources',`id=eq.${resource.id}`,{status:'active',safe_config:safeConfig,last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    const label=[phone.verifiedName,phone.displayPhoneNumber].filter(Boolean).join(' · ')||phoneNumberId;
    await serviceUpdate('automation_channel_connections',`business_id=eq.${business.id}&channel_type=eq.whatsapp`,{status:'connecting',provider:'meta',connected_account_label:label,connected_at:null,last_error_code:null,updated_at:new Date().toISOString()});
    return json(200,{ok:true,account:{phone_number_id:phoneNumberId,waba_id:safeConfig.waba_id||wabaId,label,display_phone_number:phone.displayPhoneNumber,verified_name:phone.verifiedName}});
  }catch(error){console.error('automation-whatsapp-connect error',{message:error?.message,status:error?.status,providerStatus:error?.providerStatus});return json(Number(error?.status)||500,{error:Number(error?.status)>=500?'whatsapp_connection_unavailable':String(error?.message||'whatsapp_connection_failed')});}
}
