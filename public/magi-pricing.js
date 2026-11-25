/* MAGI-2 on reAPI: $0.08 per output second at 1080p (4–30 s); reference images, videos and audio cost nothing extra.
   30% margin: displayed credits = cost / 0.7 × 100, rounded up to a whole credit. 1 stored credit = 10 displayed. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MagiPricing=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const RATE=.08,MARGIN=.3;
 function quote({duration=5,resolution='1080p'}={}){
  const seconds=Number(duration);
  if(String(resolution).toLowerCase()!=='1080p')throw Error('MAGI-2 makes 1080p videos.');
  if(!Number.isInteger(seconds)||seconds<4||seconds>30)throw Error('MAGI-2 videos are 4–30 seconds.');
  const providerCostUSD=RATE*seconds;
  const displayedCredits=Math.ceil(Math.round(providerCostUSD/(1-MARGIN)*100*1e6)/1e6-1e-9);
  return {displayedCredits,internalCredits:displayedCredits/10,providerCostUSD,duration:seconds,billedSeconds:seconds,resolution:'1080p'};
 }
 return {quote,rate:RATE,margin:MARGIN};
});
