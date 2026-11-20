const standard=require('../../lib/reapi/launch.cjs').handler('2.5',true);
const kling=require('../../lib/kling4/launch.cjs').handler(true);
const wan=require('../../lib/reapi/henshin-lite-wan.cjs');
const wanLite=wan.handler();
// Henshin Lite: source videos up to 15 seconds run on Wan 3.0 (reAPI), longer ones on Kling 4.0 (Wan 3.0 takes at most
// 15 seconds of video). Same price and limits for the customer. If the server measures a video "up to 15 s" as longer,
// nothing has been charged yet and the run continues on Kling.
async function lite(event,body){
 if(process.env.HENSHIN_LITE_WAN!=='off'&&wan.fitsWan(body)){
  try{return await wanLite(event);}
  catch(error){if(!error.tooLongForWan)throw error;console.log('henshin lite: source over 15 s, using Kling 4.0',{seconds:error.seconds});}
 }
 return kling(event);
}
exports.handler=event=>{let body;try{body=JSON.parse(event.body||'{}');}catch{return standard(event);}
 return body.henshin_model==='lite'?lite(event,body):standard(event);
};
