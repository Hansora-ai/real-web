import { duration, baseDuration, audioClips, frameSize } from './core.mjs';
export function exportPlan(p, assets, audio, overlays = false, threads = 1) {
  const { width, height } = frameSize(p, assets), total = duration(p);
  const used = [...new Set(p.clips.map(c => c.assetId))];
  const tracks = audioClips(p), soundAssets = [...new Set(tracks.map(a => a.assetId))];
  const args = ['-y', '-filter_complex_threads', String(threads)], filters = [];
  p.clips.forEach((c, i) => {
    const length = c.end-c.start, a=assets.get(c.assetId), image=a.kind==='image';
    if (image) args.push('-f','image2','-pattern_type','none','-loop','1','-framerate','30','-t',String(length),'-i',`media${used.indexOf(c.assetId)}`);
    else args.push('-ss',String(c.start),'-t',String(length),'-i',`media${used.indexOf(c.assetId)}`);
    if (image) {
      const s=c.style || {width:100,x:50,y:50}, fit=Math.min(width/a.width,height/a.height);
      const w=Math.max(2,Math.round(a.width*fit*s.width/100/2)*2),h=Math.max(2,Math.round(a.height*fit*s.width/100/2)*2);
      filters.push(`[${i}:v]scale=${w}:${h},setsar=1,fps=30,setpts=PTS-STARTPTS[im${i}];color=c=black:s=${width}x${height}:r=30:d=${length}[bg${i}];[bg${i}][im${i}]overlay=x=${width*s.x/100-w/2}:y=${height*s.y/100-h/2}:shortest=1,trim=duration=${length}[v${i}]`);
    } else filters.push(`[${i}:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length}[v${i}]`);
    const source=!image && audio.get(c.assetId) ? `[${i}:a]` : 'anullsrc=r=48000:cl=stereo,';
    filters.push(`${source}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${c.volume??1},apad,atrim=duration=${length}[a${i}]`);
  });
  if (p.clips.length) {
    filters.push(`${p.clips.map((_,i)=>`[v${i}][a${i}]`).join('')}concat=n=${p.clips.length}:v=1:a=1[joined][joinedSound]`);
    filters.push(`[joined]tpad=stop_mode=add:stop_duration=${Math.max(0,total-baseDuration(p))},trim=duration=${total}[base];[joinedSound]apad,atrim=duration=${total}[sound]`);
  } else filters.push(`color=c=black:s=${width}x${height}:r=30:d=${total}[base];anullsrc=r=48000:cl=stereo,atrim=duration=${total}[sound]`);
  let index=p.clips.length, video='[base]', sound='[sound]';
  if (overlays) {
    args.push('-f','concat','-safe','0','-i','overlays.txt');
    filters.push(`[${index++}:v]fps=30[ov];[base][ov]overlay=0:0:eof_action=pass:shortest=0[video]`); video='[video]';
  }
  tracks.forEach((a,i)=>{
    if(a.loop) args.push('-stream_loop','-1');
    args.push('-ss',String(a.in||0),'-t',String(a.end-a.start),'-i',`audio${soundAssets.indexOf(a.assetId)}`);
    filters.push(`[${index++}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${a.volume},apad,atrim=duration=${a.end-a.start},adelay=${Math.round(a.start*1000)}:all=1[track${i}]`);
  });
  if(tracks.length) {
    filters.push(`[sound]${tracks.map((_,i)=>`[track${i}]`).join('')}amix=inputs=${tracks.length+1}:duration=first:normalize=0[mixed]`);sound='[mixed]';
  }
  args.push('-filter_complex',filters.join(';'),'-map',video,'-map',sound,'-t',String(total),'-c:v','libx264','-threads',String(threads),'-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-b:a','160k','-movflags','+faststart','finished.mp4');
  return args;
}
