const {mediaURL,rates}=require('./common.cjs');
const MODES=['motion','swap','edit'];
function templateInput(body){
 const source=body.source_video_url||body.video_url;
 if(!mediaURL(body.video_url)||!mediaURL(source))throw Error('Upload the example and source videos.');
 const images=body.image_urls||[];
 if(!Array.isArray(images)||images.length>30||!images.every(mediaURL))throw Error('Invalid template reference images.');
 const mode=body.mode||'motion',resolution=body.resolution||'720p';
 if(!MODES.includes(mode)||!Object.hasOwn(rates,resolution))throw Error('Invalid template mode or resolution.');
 const prompt=String(body.prompt||'').trim();
 if(prompt.length>2000)throw Error('Prompt must be 2000 characters or fewer.');
 if(mode!=='motion'&&!prompt)throw Error('Describe the change for this mode.');
 if(!images.length)throw Error('Add at least one reference image.');
 return {source_video_url:source,reference_image_urls:images,transformation_prompt:prompt,mode,resolution,keep_audio:body.keep_audio!==false};
}
function templatePublic(row){
 const m=row.meta||{};
 return {id:row.id,title:row.prompt,video_url:row.result_url,duration:m.duration,source_video_url:m.source_video_url||row.result_url,image_urls:m.reference_image_urls||[],prompt:m.transformation_prompt||'',mode:m.mode||'motion',resolution:m.resolution||'720p',keep_audio:m.keep_audio!==false};
}
module.exports={templateInput,templatePublic};
