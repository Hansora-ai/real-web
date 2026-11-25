/* KIE regular rates (without top-up bonuses) for Seedream 5.5 and FLUX 3 Klein, priced at a 30% margin:
   displayed credits = provider cost / 0.7 × 100, rounded UP to the next 0.5 (prices read 1, 1.5, 2, 2.5…). 1 stored credit = 10 displayed credits;
   the page shows displayed credits and the server debits the stored value. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NewImagePricing=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const MARGIN=.3;
 // USD per output image. Seedream 5.5 also bills every input image ($0.0072 each); FLUX 3 Klein references are free.
 const rates={
  'seedream-5-5':{output:{'1K':.018,'1.5K':.018,'2K':.0315},input:.0072,maxImages:10},
  'flux-3-klein':{output:{'1K':.008,'2K':.0125,'4K':.0325},input:0,maxImages:10}
 };
 function quote(model,{resolution='1K',imageCount=0}={}){
  const rate=rates[model],res=String(resolution).toUpperCase(),count=Number(imageCount);
  if(!rate||!Object.hasOwn(rate.output,res)||!Number.isInteger(count)||count<0||count>rate.maxImages)throw Error('Unsupported resolution or image count.');
  const providerCostUSD=rate.output[res]+rate.input*count;
  // Work in halves of a displayed credit, so floating point never rounds a price down.
  const halves=Math.ceil(Math.round(providerCostUSD/(1-MARGIN)*200*1e6)/1e6-1e-9);
  return {displayedCredits:halves/2,internalCredits:halves/20,providerCostUSD};
 }
 return {quote,rates,margin:MARGIN};
});
