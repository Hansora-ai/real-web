'use strict';
const pricing=require('../../public/kling4-pricing.js');
const {mediaURL}=require('../henshin/common.cjs');
function list(body,key,alias,max){
 const items=body[key]??body[alias]??[];
 if(!Array.isArray(items)||items.length>max||items.some(url=>typeof url!=='string'||!mediaURL(url)))throw Error('Invalid Kling reference files. Upload your files again.');
 return items;
}
function build(body,{inputSeconds=0,lite=false}={}){
 const images=list(body,'image_urls','reference_image_urls',10),videos=list(body,'video_urls','reference_video_urls',5),audio=list(body,'audio_urls','reference_audio_urls',3);
 if(images.length+videos.length+audio.length>15)throw Error('Kling accepts up to 15 reference items.');
 if((body.elements?.length||body.voices?.length)||body.first_frame_url||body.last_frame_url)throw Error('Use image, video and voice reference uploads for Kling 4.0.');
 const prompt=String(body.prompt||'').trim();
 if(!prompt||prompt.length>10000)throw Error('Kling 4.0 prompts must be 1–10,000 characters.');
 const aspect=String(body.aspect_ratio||'auto');
 if(!['auto','16:9','9:16','1:1','21:9'].includes(aspect))throw Error('Unsupported Kling aspect ratio.');
 if(videos.length&&!inputSeconds)throw Error('Could not verify source video duration.');
 const quote=pricing.quote({resolution:body.resolution,duration:body.duration,inputSeconds,lite});
 const declared=new Set([...images.map((_,i)=>'image_'+(i+1)),...videos.map((_,i)=>'video_'+(i+1)),...audio.map((_,i)=>'voice_'+(i+1))]);
 for(const match of prompt.matchAll(/@([\u4e00-\u9fffA-Za-z0-9_]+)/g))if(!declared.has(match[1]))throw Error('Unknown reference @'+match[1]+'. Use the numbered references shown beside your uploads.');
 return {quote,payload:{model:'kling-4.0/reference-to-video',input:{prompt,duration:quote.duration,resolution:quote.resolution,aspect_ratio:aspect,image_urls:images,video_urls:videos,keep_original_sound:body.keep_original_sound===true,voices:audio.map((url,i)=>({name:'voice_'+(i+1),audio_url:url}))}}};
}
// Kling 4.0 Flash (https://docs.kie.ai/market/kling/v4-flash-keyframe-to-video and v4-flash-reference-to-video):
// 720p only, 3–20 s, prompts up to 8,000 characters, no voices. A first frame uses the keyframe model (it cannot be
// combined with references; the video follows that image's shape); otherwise images/videos go to the reference model.
function buildFlash(body,{inputSeconds=0}={}){
 const images=list(body,'image_urls','reference_image_urls',10),videos=list(body,'video_urls','reference_video_urls',5),audio=list(body,'audio_urls','reference_audio_urls',0);
 if(audio.length||body.voices?.length||body.elements?.length||body.last_frame_url)throw Error('Kling 4.0 Flash takes a first frame, or image and video references.');
 let prompt=String(body.prompt||'').trim();
 if(!prompt||prompt.length>8000)throw Error('Kling 4.0 Flash prompts must be 1–8,000 characters.');
 const first=body.first_frame_url==null||body.first_frame_url===''?null:String(body.first_frame_url);
 if(first&&!mediaURL(first))throw Error('Invalid Kling reference files. Upload your files again.');
 if(first&&(images.length||videos.length))throw Error('Remove the reference files to use a first frame with Kling 4.0 Flash.');
 const aspect=String(body.aspect_ratio||'auto');
 if(!['auto','16:9','9:16','1:1','21:9','4:3','3:4'].includes(aspect))throw Error('Unsupported Kling aspect ratio.');
 if(videos.length&&!inputSeconds)throw Error('Could not verify source video duration.');
 if(videos.length&&(inputSeconds<2||inputSeconds>20.0001))throw Error('Kling 4.0 Flash reference videos must total 2–20 seconds.');
 const quote=pricing.quote({resolution:body.resolution||'720p',duration:body.duration,inputSeconds:videos.length?inputSeconds:0,flash:true});
 const allowed=first?new Set(['first_frame']):new Set([...images.map((_,i)=>'image_'+(i+1)),...videos.map((_,i)=>'video_'+(i+1))]);
 for(const match of prompt.matchAll(/@([\u4e00-\u9fffA-Za-z0-9_]+)/g))if(!allowed.has(match[1]))throw Error('Unknown reference @'+match[1]+'. Use the numbered references shown beside your uploads.');
 if(first){
  if(!/@first_frame\b/.test(prompt))prompt=(prompt+'\nREFERENCES: @first_frame is the exact opening frame.').slice(0,8000);
  return {quote,payload:{model:'kling-4.0/flash-keyframe-to-video',input:{prompt,first_frame_url:first,duration:quote.duration,resolution:'720p'}}};
 }
 const input={prompt,duration:quote.duration,resolution:'720p',image_urls:images,video_urls:videos};
 // Text-only requests have no "auto": KIE then uses 16:9.
 if(aspect!=='auto'||images.length||videos.length)input.aspect_ratio=aspect;
 if(videos.length)input.keep_original_sound=body.keep_original_sound===true;
 return {quote,payload:{model:'kling-4.0/flash-reference-to-video',input}};
}
module.exports={build,buildFlash,list};
