/* Gemini Omni 1.2 Flash on KIE: per second of output (or of the input video for an edit), regular rates without
   top-up bonuses, with a 35% margin. 1 stored credit = 10 displayed credits. Shared by the website, the runner
   (run-gemini-omni-flash-1-2.js) and ChatGPT (lib/hansora-catalog). */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GeminiOmni12Pricing=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const rates={'360p':.02,'720p':.045,'1080p':.05,'4k':.11};
 const MARGIN=.35;
 function normalizeResolution(value){const key=String(value||'720p').toLowerCase();return rates[key]?key:'720p';}
 // duration: 3-15 seconds (3-10 with first and last frame). inputSeconds: the source video of an edit (up to 15 s),
 // which replaces the duration (the output follows the input video).
 function quote({resolution='720p',duration=4,inputSeconds=0,firstAndLast=false}={}){
  const quality=normalizeResolution(resolution);
  const source=Number(inputSeconds)||0;
  let seconds;
  if(source>0){
   if(!Number.isFinite(source)||source>15.0001)throw Error('Gemini Omni 1.2 Flash edits take a video of up to 15 seconds.');
   seconds=Math.max(1,Math.ceil(source-1e-7));
  }else{
   seconds=Math.round(Number(duration));
   if(!Number.isInteger(seconds)||seconds<3||seconds>(firstAndLast?10:15))throw Error(`Gemini Omni 1.2 Flash makes ${firstAndLast?'3 to 10':'3 to 15'}-second videos.`);
  }
  const providerCostUSD=rates[quality]*seconds;
  const displayedCredits=Math.ceil(providerCostUSD/(1-MARGIN)*100-1e-7);
  return {displayedCredits,internalCredits:displayedCredits/10,providerCostUSD,duration:seconds,inputSeconds:source,billedSeconds:seconds,resolution:quality};
 }
 return {quote,rates,normalizeResolution,margin:MARGIN};
});
