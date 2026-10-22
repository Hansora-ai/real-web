/* KIE regular rates, without top-up bonuses. 1 stored credit = 10 displayed credits. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Kling4Pricing=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const rates={text:{'720p':.1425,'1080p':.2125},video:{'720p':.085,'1080p':.1275}};
 function quote({resolution='720p',duration=5,inputSeconds=0,lite=false}={}){
  const source=Number(inputSeconds),seconds=lite?Math.ceil(source-1e-7):Number(duration),quality=String(resolution).toLowerCase();
  if(!Number.isFinite(source)||source<0||source>30.0001||!Number.isInteger(seconds)||seconds<3||seconds>30||!rates.text[quality]||(lite&&source<4))throw Error('Unsupported Kling 4.0 duration or resolution.');
  const billed=source>0?Math.max(source+seconds,2*seconds):seconds;
  const providerCostUSD=rates[source>0?'video':'text'][quality]*billed;
  // Henshin Lite has the owner's explicit 220 / 340 displayed credits per 10s.
  const displayedCredits=Math.ceil((lite?seconds*({'720p':22,'1080p':34}[quality]):providerCostUSD/.75*100)-1e-7);
  return {displayedCredits,internalCredits:displayedCredits/10,providerCostUSD,duration:seconds,inputSeconds:source,billedSeconds:billed,resolution:quality};
 }
 return {quote,rates};
});
