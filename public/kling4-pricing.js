/* KIE regular rates, without top-up bonuses. 1 stored credit = 10 displayed credits. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Kling4Pricing=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const rates={text:{'720p':.1425,'1080p':.2125},video:{'720p':.085,'1080p':.1275}};
 // Kling 4.0 Flash (KIE): 720p only, $0.085/s, or $0.0565/s with reference video; 3–20 s outputs, 30% margin.
 const flashRates={text:{'720p':.085},video:{'720p':.0565}};
 function quote({resolution='720p',duration=5,inputSeconds=0,lite=false,flash=false}={}){
  const source=Number(inputSeconds),seconds=lite?Math.ceil(source-1e-7):Number(duration),quality=String(resolution).toLowerCase();
  const table=flash?flashRates:rates,maxSeconds=flash?20:30;
  if(!Number.isFinite(source)||source<0||source>maxSeconds+.0001||!Number.isInteger(seconds)||seconds<3||seconds>maxSeconds||!table.text[quality]||(lite&&(flash||source<4)))throw Error(flash?'Unsupported Kling 4.0 Flash duration or resolution.':'Unsupported Kling 4.0 duration or resolution.');
  // Reference video is billed on input + output seconds (at least twice the output), as with Kling 4.0.
  const billed=source>0?Math.max(source+seconds,2*seconds):seconds;
  const providerCostUSD=table[source>0?'video':'text'][quality]*billed;
  // Henshin Lite has the owner's explicit 220 / 340 displayed credits per 10s.
  const displayedCredits=Math.ceil((lite?seconds*({'720p':22,'1080p':34}[quality]):providerCostUSD/(flash?.7:.75)*100)-1e-7);
  return {displayedCredits,internalCredits:displayedCredits/10,providerCostUSD,duration:seconds,inputSeconds:source,billedSeconds:billed,resolution:quality};
 }
 return {quote,rates,flashRates};
});
