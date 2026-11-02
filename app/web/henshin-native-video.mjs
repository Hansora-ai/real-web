// AV1 is playable in Chrome but has no software decoder in our FFmpeg build.
// Reuse the editor's device decoder and MP4 muxer, then let FFmpeg normalize
// the video and copy audio from the original file as usual.
import { openVideo } from './caption-studio/decoder.mjs';
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer/mp4-muxer.mjs';

export async function decodeToH264(file, seconds) {
 const unsupported=()=>Error('This browser cannot convert AV1 video. Use an updated Chrome or export the source as MP4 (H.264).');
 if(!globalThis.VideoEncoder||!globalThis.VideoFrame)throw unsupported();
 const decoder=await openVideo({file});
 if(!decoder)throw unsupported();
 let encoder;
 try{
  const first=await decoder.frame(0);
  const width=Math.ceil(first.displayWidth/2)*2,height=Math.ceil(first.displayHeight/2)*2;
  const bitrate=Math.min(20e6,Math.max(4e6,width*height*4));
  let config;
  for(const codec of ['avc1.640033','avc1.420033']){
   const candidate={codec,width,height,bitrate,framerate:30,avc:{format:'avc'}};
   if((await VideoEncoder.isConfigSupported(candidate)).supported){config=candidate;break;}
  }
  if(!config)throw unsupported();
  const target=new ArrayBufferTarget(),muxer=new Muxer({target,video:{codec:'avc',width,height,frameRate:30},fastStart:'in-memory',firstTimestampBehavior:'offset'});
  let failure;
  encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:error=>{failure=error;}});
  encoder.configure(config);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)throw unsupported();
  for(let i=0;i<Math.ceil(seconds*30);i++){
   if(failure)throw failure;
   const at=i/30,image=i?await decoder.frame(at):first;
   context.drawImage(image,0,0,width,height);
   const frame=new VideoFrame(canvas,{timestamp:Math.round(at*1e6),duration:Math.round(Math.min(1/30,seconds-at)*1e6)});
   try{encoder.encode(frame,{keyFrame:i%60===0});}finally{frame.close();}
   while(encoder.encodeQueueSize>6){
    await new Promise(resolve=>{const timer=setTimeout(done,100);function done(){clearTimeout(timer);encoder.removeEventListener('dequeue',done);resolve();}encoder.addEventListener('dequeue',done,{once:true});});
    if(failure)throw failure;
   }
  }
  await encoder.flush();if(failure)throw failure;
  muxer.finalize();return new Uint8Array(target.buffer);
 }finally{if(encoder&&encoder.state!=='closed')encoder.close();decoder.close();}
}
