/* Shared Search Models action: finish an eligible Seedance 2.5 result at 1080p. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeedanceDraftUI = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const busy = new Set();
  function eligible(data, now = Date.now()) {
    const m = data.meta || {};
    return m.source === 'reapi' && m.model === 'doubao-seedance-2.5-face' && m.draft === true && m.resolution === '480p'
      && m.source_feature !== 'henshin' && !!data.result_url && /^(ready|done|completed)$/.test(data.status || m.status || '')
      && !!m.run_id && Date.parse(m.draft_expires_at) > now;
  }
  function createButton(initial, hooks) {
    let data = {...initial};
    const lang = document.documentElement.lang || '';
    const ru = lang.startsWith('ru'), hy = lang.startsWith('hy') || lang.startsWith('arm');
    const text = ru ? {label:'Сделать 1080p',title:'Версия в 1080p',credits:'кредитов',create:'Создать 1080p',cancel:'Отмена',copy:'Исходное видео 480p сохранится. Будет создана отдельная версия 1080p.'}
      : hy ? {label:'Դարձնել 1080p',title:'1080p տարբերակ',credits:'կրեդիտ',create:'Ստեղծել 1080p',cancel:'Չեղարկել',copy:'Սկզբնական 480p տեսանյութը կպահպանվի։ Կստեղծվի առանձին 1080p տարբերակ։'}
      : {label:'Make it 1080p',title:'Make it 1080p',credits:'credits',create:'Generate 1080p',cancel:'Cancel',copy:'Your 480p video stays in history. This creates a separate 1080p version.'};
    if (!document.getElementById('seedance-final-style')) {
      const style = document.createElement('style'); style.id = 'seedance-final-style';
      style.textContent = '.seedance-finalize{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:auto;min-width:44px;height:32px;padding:0 7px;gap:3px;border-radius:999px;border:1px solid #ffffff33;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-size:10px;font-weight:700;cursor:pointer}.seedance-finalize[hidden]{display:none!important}.seedance-final-dialog{box-sizing:border-box;width:min(380px,calc(100vw - 32px));padding:24px;border:1px solid #7775;border-radius:20px;background:#17191f;color:#f7f7fa;box-shadow:0 20px 80px #0009}.seedance-final-dialog::backdrop{background:#0009}.seedance-final-dialog h2{font-size:21px;margin:0 0 12px}.seedance-final-dialog p{font-size:14px;line-height:1.5;margin:10px 0;color:#bfc0cc}.seedance-final-dialog .final-price{font-size:23px;font-weight:700;color:#d2c5ff}.seedance-final-dialog footer{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}.seedance-final-dialog button{border:1px solid #7775;border-radius:10px;padding:10px 14px;background:#282b34;color:#fff;cursor:pointer}.seedance-final-dialog button.final-submit{background:#a890e0;color:#171321;font-weight:700}.seedance-final-dialog button:disabled{opacity:.6;cursor:wait}';
      document.head.appendChild(style);
    }
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'seedance-finalize'; button.title = text.label; button.setAttribute('aria-label',text.label);
    const icon = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 18V5m-5 5 5-5 5 5M4 17v4h16v-4"/></svg><span>1080p</span>';
    button.innerHTML = icon;
    const update = next => {data = {...data,...next,meta:{...data.meta,...next?.meta}};button.hidden = !eligible(data);button.style.setProperty('display',button.hidden?'none':'inline-flex','important');};
    async function request(payload, submit = false) {
      const token = await hooks.token().catch(error=>{throw Object.assign(error,{status:error.status||401});});
      const res = await fetch(submit ? '/.netlify/functions/safe-run' : '/.netlify/functions/run-seedance-25-final',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify(submit ? {target_endpoint:'/.netlify/functions/run-seedance-25-final',model_id:'seedance25',model_name:'Seedance 2.5 · 1080p',kind:'video',prompt:data.prompt||'',usage_mode:'credits',payload} : payload)
      });
      const reply = await res.json().catch(()=>({}));
      if (!res.ok) throw Object.assign(Error(reply.error || reply.message || 'Could not start the 1080p version.'),{status:res.status});
      return reply;
    }
    button.addEventListener('click',async event => {
      event.preventDefault();event.stopPropagation();
      const run = data.meta?.run_id;
      if (!eligible(data) || busy.has(run)) return;
      busy.add(run);button.disabled=true;button.setAttribute('aria-busy','true');
      let dialog;
      const release = () => {busy.delete(run);button.disabled=false;button.removeAttribute('aria-busy');};
      try {
        const quote = await request({draft_run_id:run,quote_only:true});
        if (quote.submitted) {await hooks.accepted(quote,null);release();return;}
        if (!Number.isInteger(quote.displayedCredits) || !quote.run_id) throw Error('The 1080p price is unavailable. Try again.');
        dialog = document.createElement('dialog');dialog.className='seedance-final-dialog';
        const title=document.createElement('h2');title.textContent=text.title;
        const copy=document.createElement('p');copy.textContent=text.copy;
        const price=document.createElement('p');price.className='final-price';price.textContent=`${quote.displayedCredits} ${text.credits}`;
        const footer=document.createElement('footer');
        const cancel=document.createElement('button');cancel.type='button';cancel.textContent=text.cancel;
        const submit=document.createElement('button');submit.type='button';submit.className='final-submit';submit.textContent=text.create;
        const message=document.createElement('p');message.setAttribute('role','status');
        footer.append(cancel,submit);dialog.append(title,copy,price,message,footer);document.body.append(dialog);
        let submitting=false;
        dialog.addEventListener('cancel',e=>{if(submitting)e.preventDefault();});
        dialog.addEventListener('close',()=>{dialog.remove();release();},{once:true});
        cancel.addEventListener('click',()=>dialog.close());
        submit.addEventListener('click',async()=>{
          if (submitting) return;
          submitting=true;submit.disabled=true;cancel.disabled=true;
          let context, sent=false;
          try {
            context=hooks.start(quote.run_id,data);
            sent=true;
            const reply=await request({draft_run_id:run,expected_credits:quote.displayedCredits},true);
            await hooks.accepted(reply,context);dialog.close();
          } catch (error) {
            if (sent && !error.status) {
              // The server may have accepted a disconnected POST. Poll its
              // deterministic run instead of automatically submitting again.
              await hooks.accepted({run_id:quote.run_id,status:'pending',submission_uncertain:true},context);dialog.close();
            } else {
              await hooks.rejected(error,context);message.textContent=error.message;
              submitting=false;submit.disabled=false;cancel.disabled=false;
            }
          }
        });
        dialog.showModal();
      } catch (error) {if(dialog)dialog.remove();release();await hooks.rejected(error,null);}
    });
    update(data);
    return {button,update};
  }
  return {eligible,createButton};
});
