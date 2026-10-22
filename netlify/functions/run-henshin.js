const standard=require('../../lib/reapi/launch.cjs').handler('2.5',true);
const lite=require('../../lib/kling4/launch.cjs').handler(true);
exports.handler=event=>{let body;try{body=JSON.parse(event.body||'{}');}catch{return standard(event);}
 return body.henshin_model==='lite'?lite(event):standard(event);
};
