(async function(){
  'use strict';
  const api=window.HansoraAutomation;
  const params=new URLSearchParams(location.search);
  const businessId=params.get('business')||(api.isLocalPreview?'preview':'');
  const requestedWorkflowId=params.get('workflow');
  const requestedTemplate=params.get('template');
  const createNew=params.get('new')==='1'||Boolean(requestedTemplate);
  const loading=document.querySelector('#comments-loading');
  const errorBox=document.querySelector('#comments-error');
  const builder=document.querySelector('#comments-builder');
  const inspector=document.querySelector('#inspector-content');
  const emptyInspector=document.querySelector('#inspector-empty');
  const user=await api.requireUser(location.pathname+location.search);if(!user)return;
  if(!api.isLocalPreview&&!/^[0-9a-f-]{36}$/i.test(businessId))return fail('This comment automation link is invalid.');
  document.querySelector('#builder-back').href=`automation-workflows.html?business=${encodeURIComponent(businessId)}${api.isLocalPreview&&location.protocol!=='file:'?'&preview=1':''}`;

  const defaults={workflowId:null,name:'Comment to DM',status:'draft',selected:'message-opening',trigger:{scope:'all',postIds:[],match:'any',keywords:[],exclude:[],publicEnabled:true,variations:['Thanks for your comment! I just sent you the details in a private message.'],firstCommentOnly:true,ignoreOwn:true},nodes:[
    {id:'message-opening',type:'message',title:'Opening DM',text:'Hi! Thanks for your interest. Tap below and I’ll send the details.',commentReply:true,replyNextId:'ai-assistant',actions:[{id:'action-details',type:'quick_reply',label:'Send me details',nextId:'delay-natural'},{id:'action-website',type:'website',label:'Visit website',url:'https://example.com'}]},
    {id:'delay-natural',type:'delay',title:'Natural pause',amount:1,unit:'minute',nextId:'message-details'},
    {id:'message-details',type:'message',title:'Send the details',text:'Here are the details you asked for. What would you like help with next?',replyNextId:'ai-assistant',actions:[{id:'action-question',type:'quick_reply',label:'Ask a question',nextId:'ai-assistant'},{id:'action-person',type:'handoff',label:'Talk to a person'}]},
    {id:'ai-assistant',type:'ai',title:'AI assistant',instruction:'Continue using the saved business knowledge and help the customer complete their goal.',handoff:true}
  ]};
  const previewStoreKey='hansora_comment_workflows_preview';
  // Step settings vocabulary (defined before the first render).
  const RULE_FIELDS={follows:'Follows your account',follower_count:'Follower count',tag:'Has tag',field:'Saved field',reply:'Their reply text'};
  const RULE_OPS={follows:[['is_true','is true'],['is_false','is false']],follower_count:[['gte','at least'],['lte','at most'],['gt','more than'],['lt','less than']],tag:[['has','has tag'],['not_has','does not have tag']],field:[['equals','is'],['contains','contains'],['is_set','has any value'],['not_set','is empty']],reply:[['contains','contains'],['exact','is exactly'],['any','anything']]};
  const OP_TYPES={add_tag:'Add tag',remove_tag:'Remove tag',set_field:'Save a field',clear_field:'Clear a field',notify:'Notify my team',mark_needs_you:'Mark chat “Needs you”'};
  const INPUT_KINDS={email:'email',phone:'phone number',number:'number',text:'text'};
  let state=structuredClone(defaults);let posts=[];let saveTimer=null;let pendingConnection=null;
  // Canvas camera (pan/zoom), ManyChat-style view vs edit mode, per-step results, and undo for deletes.
  let camera={x:40,y:24,z:1};let mode='edit';let stats=null;let editSnapshot=null;let lastDeleted=null;let currentLayout=null;let suppressClick=false;
  if(!await loadFlow())return;
  normalizeFlow();loading.hidden=true;builder.hidden=false;
  mode=state.workflowId&&['active','paused'].includes(state.status)&&!createNew?'view':'edit';
  document.querySelector('#flow-name').value=state.name;renderAll();requestAnimationFrame(fitView);
  if(mode==='view')loadStats();

  document.querySelector('#flow-map').addEventListener('click',event=>{
    if(suppressClick){suppressClick=false;return}
    const tool=event.target.closest('[data-toolbar]');if(tool){event.stopPropagation();return tool.dataset.toolbar==='delete'?removeNode(state.selected,{announce:true}):duplicateNode(state.selected)}
    const connector=event.target.closest('[data-connect-kind]');
    if(connector&&mode==='view'){const node=connector.closest('[data-node-id]');if(node){state.selected=node.dataset.nodeId;renderAll()}return}
    if(connector){event.stopPropagation();const sourceId=connector.dataset.sourceId,kind=connector.dataset.connectKind,actionIndex=Number(connector.dataset.actionIndex??connector.dataset.branchIndex);const targetId=connectionTarget(sourceId,kind,actionIndex);if(targetId&&byId(targetId)){state.selected=targetId;renderAll();return}return openStepPicker(sourceId,kind,actionIndex,connector);}
    const first=event.target.closest('[data-first-step]');if(first){event.stopPropagation();return addNode(first.dataset.firstStep,{sourceId:'trigger',kind:'next'})}
    const template=event.target.closest('[data-first-template]');if(template){event.stopPropagation();const next=templateState(template.dataset.firstTemplate);state.nodes=next.nodes;state.trigger={...state.trigger,match:next.trigger.match,keywords:next.trigger.keywords,variations:next.trigger.variations};if(state.name==='Untitled automation'){state.name=next.name;document.querySelector('#flow-name').value=state.name}state.selected=null;markDirty();renderAll();requestAnimationFrame(fitView);return}
    const node=event.target.closest('[data-node-id]');if(node){state.selected=node.dataset.nodeId;renderAll();}
  });
  document.querySelectorAll('[data-add-node]').forEach(button=>button.addEventListener('click',()=>{toggleAddPanel(false);addFromLibrary(button.dataset.addNode)}));
  document.querySelector('[data-panel-trigger]').addEventListener('click',()=>{toggleAddPanel(false);state.selected='trigger';renderAll();centerOn('trigger')});
  document.querySelector('#add-step-fab').addEventListener('click',event=>{event.stopPropagation();toggleAddPanel()});
  document.addEventListener('click',event=>{if(!event.target.closest('#add-panel,#add-step-fab'))toggleAddPanel(false);if(!event.target.closest('#node-menu,[data-node-menu]'))document.querySelector('#node-menu').hidden=true});
  document.querySelector('#node-menu').addEventListener('click',event=>{const item=event.target.closest('[data-menu]');if(!item)return;const id=document.querySelector('#node-menu').dataset.nodeId;document.querySelector('#node-menu').hidden=true;if(item.dataset.menu==='delete')removeNode(id,{announce:true});else duplicateNode(id)});
  document.querySelector('#edit-flow').addEventListener('click',enterEdit);document.querySelector('#banner-edit').addEventListener('click',enterEdit);
  document.querySelector('#cancel-edit').addEventListener('click',discardEdit);
  document.querySelector('#zoom-in').addEventListener('click',()=>zoomBy(1.2));document.querySelector('#zoom-out').addEventListener('click',()=>zoomBy(1/1.2));document.querySelector('#zoom-reset').addEventListener('click',()=>{camera.z=1;applyCamera()});
  document.addEventListener('keydown',onKeyDown);
  setupCanvasGestures();
  document.querySelectorAll('[data-pop-add-node]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const connection=pendingConnection;closeStepPicker();addNode(button.dataset.popAddNode,connection)}));
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#step-popover,[data-connect-kind]'))closeStepPicker()});
  document.querySelector('#flow-name').addEventListener('input',event=>{state.name=event.target.value.slice(0,200);markDirty()});
  document.querySelector('#rename-flow')?.addEventListener('click',()=>{const input=document.querySelector('#flow-name');if(input.readOnly)return;input.focus();input.select()});
  document.querySelector('#flow-name').addEventListener('keydown',event=>{if(event.key==='Enter')event.target.blur()});
  document.querySelector('#save-comment-draft').addEventListener('click',()=>saveFlow('draft'));
  document.querySelector('#activate-comment-flow').addEventListener('click',activateFlow);
  document.querySelector('#preview-flow').addEventListener('click',showPreview);
  document.querySelector('#fit-flow').addEventListener('click',fitView);
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  document.querySelector('#confirm-posts').addEventListener('click',()=>{state.trigger.postIds=[...document.querySelectorAll('#post-picker-grid input:checked')].map(input=>input.value);const previews={};state.trigger.postIds.forEach(id=>{const post=posts.find(item=>item.id===id)||{};const known=(state.trigger.postPreviews||{})[id]||{};previews[id]={thumb:String(post.thumbnail_url||post.media_url||known.thumb||'').slice(0,1500),caption:String(post.caption||known.caption||'').slice(0,120)}});state.trigger.postPreviews=previews;document.querySelector('#post-picker-dialog').close();markDirty();renderAll()});

  function normalizeFlow(){
    if(!Array.isArray(state.nodes))state.nodes=[];
    state.nodes.forEach((node,index)=>{node.id=node.id||`${node.type||'step'}-${index+1}`;node.title=node.title||stepTitle(node.type);if(node.type==='message'){node.actions=Array.isArray(node.actions)?node.actions:[];node.actions.forEach((action,actionIndex)=>{action.id=action.id||`action-${index+1}-${actionIndex+1}`});}
      if(node.type==='condition'&&Array.isArray(node.rules))node.match=node.match==='any'?'any':'all';
      if(node.type==='action')node.ops=Array.isArray(node.ops)?node.ops:[];
      if(node.type==='input')node.kind=node.kind||'text';
      if(node.type==='randomizer'){node.branches=Array.isArray(node.branches)&&node.branches.length?node.branches:[{id:uniqueId('branch'),percent:50,nextId:null},{id:uniqueId('branch'),percent:50,nextId:null}];node.branches.forEach(branch=>{branch.id=branch.id||uniqueId('branch')})}});
    state.nodes.forEach((node,index)=>{
      const following=state.nodes[index+1]?.id||null;
      if(node.type==='message'&&!('nextId' in node)&&!('replyNextId' in node)){
        const conversational=(node.actions||[]).filter(action=>['quick_reply','handoff'].includes(action.type));
        if(conversational.length){conversational.forEach(action=>{if(action.type==='quick_reply'&&!action.nextId)action.nextId=following});node.replyNextId=following;}
        else if(!node.commentReply)node.nextId=following;
      }
      if(node.type==='delay'&&!('nextId' in node))node.nextId=following;
      if(node.type==='condition'&&!('yesId' in node))node.yesId=following;
    });
    if(state.selected&&state.selected!=='trigger'&&!state.nodes.some(node=>node.id===state.selected))state.selected=null;
  }
  function renderAll(){renderStatus();renderCanvas();renderInspector()}
  function renderStatus(){
    const live=state.status==='active';
    document.querySelector('#flow-status').textContent=live?'Live':state.status==='paused'?'Paused':'Draft';
    document.querySelector('#flow-status-dot').classList.toggle('live',live);
    const viewing=mode==='view';
    document.querySelector('#comments-builder').classList.toggle('flow-viewing',viewing);
    document.querySelector('#mode-banner').hidden=!viewing;
    document.querySelector('#edit-flow').hidden=!viewing;
    document.querySelector('#add-step-fab').hidden=viewing;
    document.querySelector('#cancel-edit').hidden=viewing||!editSnapshot;
    document.querySelector('#save-comment-draft').hidden=viewing||live;
    const activate=document.querySelector('#activate-comment-flow');activate.hidden=viewing;activate.textContent=live?'Publish changes':'Set live';
    document.querySelector('#flow-name').readOnly=viewing;
  }

  function entryNode(){return state.nodes.find(node=>node.type==='message'&&node.commentReply)||state.nodes.find(node=>node.type==='message')||state.nodes[0]||null}
  function graphEdges(){
    const edges=[];const entry=entryNode();if(entry)edges.push({from:'trigger',to:entry.id,label:'Private reply',kind:'start'});
    state.nodes.forEach(node=>{
      if(node.type==='message'){
        (node.actions||[]).forEach((action,index)=>{if(action.type==='quick_reply'&&action.nextId)edges.push({from:node.id,to:action.nextId,label:action.label||`Button ${index+1}`,kind:'button'});});
        if(node.nextId)edges.push({from:node.id,to:node.nextId,label:'Next',kind:'next'});
        if(node.replyNextId)edges.push({from:node.id,to:node.replyNextId,label:'Typed reply',kind:'reply'});
      }
      if(node.type==='delay'&&node.nextId)edges.push({from:node.id,to:node.nextId,label:'After wait',kind:'next'});
      if(['action','input'].includes(node.type)&&node.nextId)edges.push({from:node.id,to:node.nextId,label:'Next',kind:'next'});
      if(node.type==='randomizer')(node.branches||[]).forEach((branch,index)=>{if(branch.nextId)edges.push({from:node.id,to:branch.nextId,label:`${branchLetter(index)} · ${Number(branch.percent)||0}%`,kind:'button'})});
      if(node.type==='condition'){
        if(node.yesId)edges.push({from:node.id,to:node.yesId,label:'Yes',kind:'yes'});
        if(node.noId)edges.push({from:node.id,to:node.noId,label:'No',kind:'no'});
      }
    });return edges.filter(edge=>edge.to&&state.nodes.some(node=>node.id===edge.to));
  }
  function graphLayout(){
    const edges=graphEdges();const depth=new Map([['trigger',0]]);const queue=['trigger'];
    while(queue.length){const source=queue.shift();const nextDepth=(depth.get(source)||0)+1;edges.filter(edge=>edge.from===source).forEach(edge=>{if(!depth.has(edge.to)){depth.set(edge.to,nextDepth);queue.push(edge.to)}});}
    let orphanDepth=Math.max(1,...depth.values())+1;state.nodes.forEach(node=>{if(!depth.has(node.id))depth.set(node.id,orphanDepth)});
    const groups=new Map();[['trigger',{id:'trigger',type:'trigger'}],...state.nodes.map(node=>[node.id,node])].forEach(([id,node])=>{const column=depth.get(id)||0;if(!groups.has(column))groups.set(column,[]);groups.get(column).push(node)});
    const positions=new Map();let maxRows=1;
    [...groups.entries()].sort((a,b)=>a[0]-b[0]).forEach(([column,nodes])=>{maxRows=Math.max(maxRows,nodes.length);nodes.forEach((node,row)=>positions.set(node.id,{x:48+column*370,y:70+row*330}))});
    // Steps the owner dragged keep their place; the rest are laid out automatically.
    if(state.triggerPos)positions.set('trigger',{...state.triggerPos});
    state.nodes.forEach(node=>{if(node.pos&&Number.isFinite(node.pos.x)&&Number.isFinite(node.pos.y))positions.set(node.id,{x:node.pos.x,y:node.pos.y})});
    const xs=[...positions.values()].map(point=>point.x),ys=[...positions.values()].map(point=>point.y);
    return{positions,edges,width:Math.max(920,Math.max(...xs)+420),height:Math.max(650,Math.max(...ys)+460)};
  }
  function renderCanvas(){
    const map=document.querySelector('#flow-map');const nodesLayer=document.querySelector('#flow-nodes');const svg=document.querySelector('#flow-lines');const layout=graphLayout();map.style.width=`${layout.width}px`;map.style.height=`${layout.height}px`;svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);svg.setAttribute('width',layout.width);svg.setAttribute('height',layout.height);
    const trigger={id:'trigger',type:'trigger',title:'Instagram comment',summary:triggerSummary()};
    nodesLayer.innerHTML=[canvasNode(trigger,layout.positions.get('trigger')),...state.nodes.map(node=>canvasNode(node,layout.positions.get(node.id)))].join('');
    currentLayout=layout;svg.innerHTML=layout.edges.map(edge=>edgePath(edge,layout.positions)).join('');
    // Empty automation: ManyChat's "Choose first step" card next to the trigger. After a comment, Instagram only
    // allows a private message first, so that is the first step.
    if(!entryNode()&&mode==='edit'){const origin=layout.positions.get('trigger');const x=origin.x+370,y=origin.y;nodesLayer.insertAdjacentHTML('beforeend',`<div class="flow-first-step" style="left:${x}px;top:${y}px"><b>Choose first step 👇</b><p>After a comment, Instagram lets you send one private message first.</p><button type="button" data-first-step="message"><span class="flow-lib-icon message">${window.HansoraUI.icon('send')}</span><span><b>Send a message</b><small>Text and buttons, like “Send me the link”</small></span></button><button type="button" data-first-template="follow-link"><span class="flow-lib-icon condition">${window.HansoraUI.icon('branch')}</span><span><b>Use “Follow to get the link”</b><small>Message → follows you? → link</small></span></button></div>`);svg.insertAdjacentHTML('beforeend',`<path class="flow-first-edge" d="M ${origin.x+310} ${origin.y+72} C ${origin.x+340} ${origin.y+72}, ${x-30} ${y+40}, ${x} ${y+40}"/>`)}
    const selectedPos=layout.positions.get(state.selected);
    if(mode==='edit'&&selectedPos&&byId(state.selected))nodesLayer.insertAdjacentHTML('beforeend',`<div class="node-toolbar" style="left:${selectedPos.x+310}px;top:${selectedPos.y-8}px" role="toolbar" aria-label="Step actions"><button type="button" data-toolbar="duplicate" title="Duplicate" aria-label="Duplicate step">${window.HansoraUI.icon('copy')}</button><button type="button" data-toolbar="delete" class="danger" title="Delete" aria-label="Delete step">${window.HansoraUI.icon('trash')}</button></div>`);
    const steps=state.nodes.length+1,links=layout.edges.length;document.querySelector('#canvas-summary').textContent=`${steps} step${steps===1?'':'s'} · ${links} connection${links===1?'':'s'}`;
  }
  function canvasNode(node,position){
    const selected=state.selected===node.id?' selected':'';const style=`left:${position.x}px;top:${position.y}px`;const labels={trigger:'Instagram trigger',message:node.commentReply?'Private reply':'Instagram message',condition:'Condition',delay:'Smart delay',ai:'AI assistant',handoff:'Human handoff',action:'Actions',input:'Collect info',randomizer:'Randomizer'};const icons={trigger:'instagram',message:'send',condition:'branch',delay:'clock',ai:'sparkle',handoff:'handoff',action:'spark',input:'edit',randomizer:'refresh'};
    let body='';
    if(node.type==='trigger')body=`${postThumbs()}<p>${escapeHtml(node.summary)}</p><div class="flow-trigger-tags">${triggerChips().map(value=>`<span>${escapeHtml(value)}</span>`).join('')}</div>`;
    if(node.type==='action')body=`<ul class="node-lines">${(node.ops||[]).map(op=>`<li>${escapeHtml(opSummary(op))}</li>`).join('')||'<li class="muted">Add an action</li>'}</ul>${routeButton(node,'next',node.nextId,'Next step')}`;
    if(node.type==='input')body=`<div class="message-bubble">${escapeHtml(node.text||'Ask a question…')}</div><span class="terminal-chip">Saves ${escapeHtml(INPUT_KINDS[node.kind]||'text')} → ${escapeHtml(node.saveTo||node.kind||'answer')}</span>${routeButton(node,'next',node.nextId,'After a valid answer')}`;
    if(node.type==='randomizer')body=`<div class="branch-list">${(node.branches||[]).map((branch,index)=>`<button type="button" data-connect-kind="branch" data-branch-index="${index}" data-source-id="${escapeAttribute(node.id)}"><b>${branchLetter(index)}</b><span>${Number(branch.percent)||0}%</span><em>${escapeHtml(branch.nextId?targetName(branch.nextId):'Choose next')} →</em></button>`).join('')}</div>`;
    if(node.type==='message')body=`<div class="message-bubble">${escapeHtml(node.text||'Write a message…')}</div><div class="message-actions">${(node.actions||[]).map((action,index)=>canvasAction(node,action,index)).join('')||'<span class="message-no-actions">No buttons yet</span>'}</div>${messageFooter(node)}`;
    if(node.type==='condition')body=`<p class="condition-summary">${escapeHtml(nodeSummary(node))}</p><div class="branch-row"><button type="button" data-connect-kind="yes" data-source-id="${escapeAttribute(node.id)}">Yes <span>${escapeHtml(targetName(node.yesId))}</span></button><button type="button" data-connect-kind="no" data-source-id="${escapeAttribute(node.id)}">No <span>${escapeHtml(targetName(node.noId))}</span></button></div>`;
    if(node.type==='delay')body=`<div class="delay-display"><b>${Number(node.amount||1)}</b><span>${escapeHtml(pluralUnit(node.unit,node.amount))}</span></div>${node.nextId?`<button class="node-route" type="button" data-connect-kind="next" data-source-id="${escapeAttribute(node.id)}"><span>After the delay</span><b>${escapeHtml(targetName(node.nextId))} →</b></button>`:nextConnector(node,'next','Choose next step')}`;
    if(node.type==='ai')body=`<p>${escapeHtml(node.instruction||'Answer with business knowledge.')}</p><span class="terminal-chip">AI continues the conversation</span>`;
    if(node.type==='handoff')body=`<p>${escapeHtml(node.note||'Pause AI and notify the team.')}</p><span class="terminal-chip">Conversation moves to Inbox</span>`;
    const menu='';
    return`<article class="flow-node ${node.type}${selected}" style="${style}" data-node-id="${escapeAttribute(node.id)}" tabindex="0"><div class="flow-node-head"><span class="flow-node-icon">${window.HansoraUI.icon(icons[node.type])}</span><div><small>${labels[node.type]}</small><strong>${escapeHtml(node.title)}</strong></div>${menu}</div>${statStrip(node)}<div class="flow-node-body">${body}</div></article>`;
  }
  function canvasAction(node,action,index){
    const symbol=action.type==='website'?'↗':action.type==='handoff'?'●':'→';const tapped=nodeStats(node.id).clicks[action.type==='handoff'?'handoff':action.id]||0;const destination=mode==='view'&&stats?`CTR ${pct(tapped,nodeStats(node.id).sent)}`:action.type==='website'?(action.url?'Website':'Add link'):action.type==='handoff'?'Team':targetName(action.nextId);
    const connect=action.type==='quick_reply'?`data-connect-kind="action" data-source-id="${escapeAttribute(node.id)}" data-action-index="${index}"`:'';
    return`<button type="button" class="message-action ${action.type}" ${connect}><span>${escapeHtml(action.label||'Untitled button')}</span><small>${escapeHtml(destination)}</small><b>${symbol}</b></button>`;
  }
  function messageFooter(node){
    if(node.commentReply)return`<button class="node-route" type="button" data-connect-kind="reply" data-source-id="${escapeAttribute(node.id)}"><span>Customer types a reply</span><b>${escapeHtml(targetName(node.replyNextId))} →</b></button>`;
    if(node.nextId)return`<button class="node-route" type="button" data-connect-kind="next" data-source-id="${escapeAttribute(node.id)}"><span>Continue automatically</span><b>${escapeHtml(targetName(node.nextId))} →</b></button>`;
    return nextConnector(node,'next','Add next step');
  }
  function routeButton(node,kind,target,label){return target?`<button class="node-route" type="button" data-connect-kind="${kind}" data-source-id="${escapeAttribute(node.id)}"><span>${escapeHtml(label)}</span><b>${escapeHtml(targetName(target))} →</b></button>`:nextConnector(node,kind,'Add next step')}
  function postThumbs(){if(state.trigger.scope!=='selected'||!state.trigger.postIds.length)return'';const previews=state.trigger.postPreviews||{};return`<div class="trigger-posts">${state.trigger.postIds.slice(0,4).map(id=>{const post=previews[id]||{};return post.thumb?`<img src="${escapeAttribute(post.thumb)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'Post'}))">`:'<span>Post</span>'}).join('')}${state.trigger.postIds.length>4?`<span>+${state.trigger.postIds.length-4}</span>`:''}</div>`}
  function nextConnector(node,kind,label){return`<button class="node-add-next" type="button" data-connect-kind="${kind}" data-source-id="${escapeAttribute(node.id)}"><i>+</i>${label}</button>`}
  function edgePath(edge,positions){
    const from=positions.get(edge.from),to=positions.get(edge.to);if(!from||!to)return'';const x1=from.x+310,y1=from.y+72,x2=to.x,y2=to.y+72,curve=Math.max(60,(x2-x1)*.48);const color=edge.kind==='yes'?'var(--green)':edge.kind==='no'?'var(--red)':edge.kind==='button'?'#b779ff':'var(--accent)';return`<path d="M ${x1} ${y1} C ${x1+curve} ${y1}, ${x2-curve} ${y2}, ${x2} ${y2}" style="--edge:${color}"/><circle cx="${x2}" cy="${y2}" r="4" style="--edge:${color}"/><text x="${(x1+x2)/2}" y="${(y1+y2)/2-8}">${escapeHtml(edge.label)}</text>`;
  }

  function renderInspector(){
    // Floating panel: open while a step is selected, gone when you click the empty canvas (like ManyChat).
    document.querySelector('#flow-inspector').classList.toggle('closed',!state.selected);
    if(!state.selected){inspector.hidden=true;emptyInspector.hidden=true;return}
    emptyInspector.hidden=true;inspector.hidden=false;
    if(mode==='view')return renderStatsInspector();
    if(state.selected==='trigger')return renderTriggerInspector();
    const node=state.nodes.find(item=>item.id===state.selected);if(!node){inspector.hidden=true;emptyInspector.hidden=false;return}
    if(node.type==='message')renderMessageInspector(node);else if(node.type==='condition')renderConditionInspector(node);else if(node.type==='delay')renderDelayInspector(node);else if(node.type==='ai')renderAiInspector(node);else if(node.type==='action')renderActionInspector(node);else if(node.type==='input')renderInputInspector(node);else if(node.type==='randomizer')renderRandomizerInspector(node);else renderHandoffInspector(node);
  }
  function inspectorHead(kicker,title){return`<div class="inspector-head"><div><p>${kicker}</p><h2>${escapeHtml(title)}</h2></div><button type="button" data-close-inspector aria-label="Close settings">×</button></div>`}
  function renderTriggerInspector(){
    inspector.innerHTML=inspectorHead('STARTING STEP','Instagram comment trigger')+`<section class="inspector-section"><label>Run when someone comments on</label><div class="inspector-tabs" id="scope-tabs"><button data-value="all">All posts</button><button data-value="selected">Specific</button><button data-value="next">Next post</button></div>${state.trigger.scope==='selected'&&state.trigger.postIds.length?`<div class="inspector-posts">${postThumbs()}</div>`:''}<button class="inspector-add" id="choose-posts" type="button" ${state.trigger.scope==='selected'?'':'hidden'}>${state.trigger.postIds.length?`Change posts (${state.trigger.postIds.length} chosen)`:'Choose posts or reels'}</button></section><section class="inspector-section"><label>Comment rule</label><select id="trigger-match"><option value="any">Any comment</option><option value="contains">Contains a word or phrase</option><option value="exact">Exactly matches a phrase</option></select><div class="inspector-field" id="keyword-wrap"><label>Include words or phrases</label><textarea id="trigger-keywords" rows="3" placeholder="price, catalog, available">${escapeHtml(state.trigger.keywords.join('\n'))}</textarea></div><div class="inspector-field"><label>Exclude words or phrases</label><textarea id="trigger-exclude" rows="2" placeholder="spam, scam">${escapeHtml(state.trigger.exclude.join('\n'))}</textarea></div></section><section class="inspector-section"><div class="inspector-toggle"><span><b>Public reply</b><small>Rotate up to three replies naturally</small></span><input id="public-enabled" type="checkbox" ${state.trigger.publicEnabled?'checked':''}></div><div id="public-variations">${state.trigger.variations.map((value,index)=>variationHtml(value,index)).join('')}</div><button class="inspector-add" id="add-variation" type="button">+ Add reply variation</button></section><section class="inspector-section"><label class="inspector-toggle"><span><b>First comment per person</b><small>Instagram allows one trigger per person per post</small></span><input id="first-comment" type="checkbox" ${state.trigger.firstCommentOnly?'checked':''}></label><label class="inspector-toggle"><span><b>Ignore your own comments</b><small>Prevent the business from triggering itself</small></span><input id="ignore-own" type="checkbox" ${state.trigger.ignoreOwn?'checked':''}></label></section>`;
    document.querySelectorAll('#scope-tabs button').forEach(button=>{button.classList.toggle('active',button.dataset.value===state.trigger.scope);button.addEventListener('click',()=>{state.trigger.scope=button.dataset.value;markDirty();renderAll()})});
    const match=document.querySelector('#trigger-match');match.value=state.trigger.match;document.querySelector('#keyword-wrap').hidden=state.trigger.match==='any';match.addEventListener('change',()=>{state.trigger.match=match.value;markDirty();renderAll()});
    bindLines('#trigger-keywords',values=>state.trigger.keywords=values);bindLines('#trigger-exclude',values=>state.trigger.exclude=values);bindCheck('#public-enabled',value=>state.trigger.publicEnabled=value);bindCheck('#first-comment',value=>state.trigger.firstCommentOnly=value);bindCheck('#ignore-own',value=>state.trigger.ignoreOwn=value);
    document.querySelector('#add-variation').addEventListener('click',()=>{if(state.trigger.variations.length<3)state.trigger.variations.push('');markDirty();renderInspector()});
    document.querySelector('#public-variations').addEventListener('input',event=>{if(!event.target.matches('textarea'))return;state.trigger.variations[Number(event.target.dataset.index)]=event.target.value;markDirty();renderCanvas()});
    document.querySelector('#public-variations').addEventListener('click',event=>{const button=event.target.closest('[data-remove-variation]');if(!button)return;state.trigger.variations.splice(Number(button.dataset.removeVariation),1);markDirty();renderAll()});
    document.querySelector('#choose-posts').addEventListener('click',openPostPicker);closeInspectorButton();
  }
  function variationHtml(value,index){return`<div class="reply-variation"><textarea rows="2" data-index="${index}" placeholder="Public reply variation">${escapeHtml(value)}</textarea><button type="button" data-remove-variation="${index}">×</button></div>`}
  function renderMessageInspector(node){
    inspector.innerHTML=inspectorHead(node.commentReply?'OPENING DM':'MESSAGE STEP',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="inspector-field"><label>Message text</label><textarea id="node-message" rows="6" placeholder="Write the message…">${escapeHtml(node.text||'')}</textarea></div>${node.commentReply?'<p class="inspector-note">Instagram allows only this one private reply until the customer replies or taps a conversational button.</p>':''}</section><section class="inspector-section"><div class="section-heading"><span><b>Buttons</b><small>Up to 3 inside this message</small></span><em>${(node.actions||[]).length}/3</em></div><div id="action-editors">${(node.actions||[]).map((action,index)=>actionHtml(node,action,index)).join('')}</div><button class="inspector-add" id="add-action" type="button">+ Add button</button></section><section class="inspector-section"><label>${node.commentReply?'If they type instead':'Automatic continuation'}</label>${node.commentReply?targetControl('reply-target',node.replyNextId,'End the flow'):targetControl('next-target',node.nextId,'End after this message')}<p class="inspector-note">${node.commentReply?'Typed replies can go directly to AI, a condition, or another message.':'Choose another message or a delay to continue without waiting for a tap.'}</p></section>`;
    bindText('#node-title',value=>node.title=value||'Instagram message');bindText('#node-message',value=>node.text=value);
    document.querySelector('#add-action').addEventListener('click',()=>{node.actions=node.actions||[];if(node.actions.length<3)node.actions.push({id:uniqueId('action'),type:'quick_reply',label:'New option',nextId:null});markDirty();renderAll()});
    document.querySelector('#action-editors').addEventListener('input',event=>updateAction(node,event));document.querySelector('#action-editors').addEventListener('change',event=>updateAction(node,event));document.querySelector('#action-editors').addEventListener('click',event=>{const button=event.target.closest('[data-remove-action]');if(button){node.actions.splice(Number(button.dataset.removeAction),1);markDirty();renderAll();return}const connect=event.target.closest('[data-create-action-step]');if(connect)openStepPicker(node.id,'action',Number(connect.dataset.createActionStep))});
    const target=document.querySelector(node.commentReply?'#reply-target':'#next-target');target.addEventListener('change',()=>{if(node.commentReply)node.replyNextId=target.value||null;else node.nextId=target.value||null;markDirty();renderCanvas()});bindRemoveNode(node);
  }
  function actionHtml(node,action,index){
    const destination=action.type==='quick_reply'?`<label>Opens next<input type="hidden"><select data-action-field="nextId" data-index="${index}">${targetOptions(action.nextId,'Choose a step')}</select></label><button class="action-create" type="button" data-create-action-step="${index}">+ Create connected step</button>`:action.type==='website'?`<label>Website URL<input data-action-field="url" data-index="${index}" value="${escapeAttribute(action.url||'')}" placeholder="https://your-site.com"></label><p>Website buttons do not open Instagram’s 24-hour reply window.</p>`:`<p>Pauses AI, alerts your team, and moves the chat to Inbox.</p>`;
    return`<div class="action-editor"><div class="action-editor-top"><select data-action-field="type" data-index="${index}"><option value="quick_reply" ${action.type==='quick_reply'?'selected':''}>Continue flow</option><option value="website" ${action.type==='website'?'selected':''}>Open website</option><option value="handoff" ${action.type==='handoff'?'selected':''}>Talk to a person</option></select><button type="button" data-remove-action="${index}" aria-label="Remove button">×</button></div><label>Button text<input data-action-field="label" data-index="${index}" value="${escapeAttribute(action.label||'')}" maxlength="20" placeholder="Button label"></label>${destination}</div>`;
  }
  function updateAction(node,event){const index=Number(event.target.dataset.index);const field=event.target.dataset.actionField;if(!Number.isInteger(index)||!field)return;node.actions[index][field]=event.target.value||null;if(field==='type'){node.actions[index].nextId=null;node.actions[index].url='';}markDirty();if(field==='type')renderInspector();renderCanvas()}
  // ManyChat-style condition: rules (follows you, follower count, tag, saved field, reply) with ALL / ANY.
  function renderConditionInspector(node){
    if(!Array.isArray(node.rules))node.rules=[{field:'reply',op:node.operator||'contains',value:node.value||''}]; // older condition, same meaning
    node.match=node.match==='any'?'any':'all';
    const ruleHtml=(rule,index)=>{const ops=RULE_OPS[rule.field]||RULE_OPS.reply;const needsValue=!['follows'].includes(rule.field)&&!['is_set','not_set','any'].includes(rule.op);return`<div class="rule-editor"><div class="rule-row"><select data-rule-field="field" data-index="${index}">${Object.entries(RULE_FIELDS).map(([value,label])=>`<option value="${value}" ${value===rule.field?'selected':''}>${label}</option>`).join('')}</select><button type="button" data-remove-rule="${index}" aria-label="Remove condition">×</button></div>${rule.field==='field'?`<input data-rule-field="key" data-index="${index}" value="${escapeAttribute(rule.key||'')}" placeholder="Field name, e.g. email">`:''}<select data-rule-field="op" data-index="${index}">${ops.map(([value,label])=>`<option value="${value}" ${value===rule.op?'selected':''}>${label}</option>`).join('')}</select>${needsValue?`<input data-rule-field="value" data-index="${index}" value="${escapeAttribute(rule.value??'')}" placeholder="${rule.field==='follower_count'?'1000':rule.field==='tag'?'Tag name':'Value'}" ${rule.field==='follower_count'?'inputmode="numeric"':''}>`:''}</div>`};
    const hasFollow=node.rules.some(rule=>rule.field==='follows');
    inspector.innerHTML=inspectorHead('CONDITION',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="section-heading"><span><b>Conditions</b><small>The customer goes to Yes when they match</small></span></div>${node.rules.length>1?`<div class="inspector-tabs" id="rule-match"><button data-value="all" class="${node.match==='all'?'active':''}">All match</button><button data-value="any" class="${node.match==='any'?'active':''}">Any matches</button></div>`:''}<div id="rule-editors">${node.rules.map(ruleHtml).join('')}</div><button class="inspector-add" id="add-rule" type="button">+ Add condition</button>${hasFollow?'<p class="inspector-note">Instagram tells us if they follow you only after they tapped a button or wrote to you, so put this after a button like “Send me the link”. A brand-new follow is checked twice, a few seconds apart.</p>':''}</section><section class="inspector-section"><label class="route-label yes">YES</label>${targetControl('condition-yes',node.yesId,'End the flow')}<label class="route-label no">NO</label>${targetControl('condition-no',node.noId,'End the flow')}<div class="inspector-field"><label>Let them through after</label><select id="condition-pass"><option value="0">Never (keep asking)</option><option value="2">2 tries</option><option value="3">3 tries</option><option value="5">5 tries</option></select><p class="inspector-note">For a follow check: after this many “No”s the person still gets the link, so nobody is stuck.</p></div></section>`;
    bindText('#node-title',value=>node.title=value||'Condition');
    document.querySelectorAll('#rule-match button').forEach(button=>button.addEventListener('click',()=>{node.match=button.dataset.value;markDirty();renderAll()}));
    const editors=document.querySelector('#rule-editors');
    editors.addEventListener('change',event=>{const index=Number(event.target.dataset.index),field=event.target.dataset.ruleField;if(!field)return;const rule=node.rules[index];rule[field]=event.target.value;if(field==='field'){rule.op=RULE_OPS[rule.field][0][0];rule.value='';delete rule.key}markDirty();renderAll()});
    editors.addEventListener('input',event=>{const index=Number(event.target.dataset.index),field=event.target.dataset.ruleField;if(!['value','key'].includes(field))return;node.rules[index][field]=event.target.value;markDirty();renderCanvas()});
    editors.addEventListener('click',event=>{const button=event.target.closest('[data-remove-rule]');if(!button)return;node.rules.splice(Number(button.dataset.removeRule),1);if(!node.rules.length)node.rules.push({field:'follows',op:'is_true'});markDirty();renderAll()});
    document.querySelector('#add-rule').addEventListener('click',()=>{if(node.rules.length<5)node.rules.push({field:'tag',op:'has',value:''});markDirty();renderAll()});
    const pass=document.querySelector('#condition-pass');pass.value=String(node.passAfter||0);pass.addEventListener('change',()=>{node.passAfter=Number(pass.value)||0;markDirty();renderCanvas()});
    bindTarget('#condition-yes',value=>node.yesId=value);bindTarget('#condition-no',value=>node.noId=value);bindRemoveNode(node)}
  function renderActionInspector(node){
    const opHtml=(op,index)=>`<div class="rule-editor"><div class="rule-row"><select data-op-field="type" data-index="${index}">${Object.entries(OP_TYPES).map(([value,label])=>`<option value="${value}" ${value===op.type?'selected':''}>${label}</option>`).join('')}</select><button type="button" data-remove-op="${index}" aria-label="Remove action">×</button></div>${['set_field','clear_field'].includes(op.type)?`<input data-op-field="key" data-index="${index}" value="${escapeAttribute(op.key||'')}" placeholder="Field name, e.g. interest">`:''}${['add_tag','remove_tag'].includes(op.type)?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="Tag name, e.g. Lead">`:''}${op.type==='set_field'?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="Value">`:''}${op.type==='notify'?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="Message for your team">`:''}</div>`;
    inspector.innerHTML=inspectorHead('ACTIONS',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="section-heading"><span><b>Actions</b><small>Run instantly, the customer sees nothing</small></span></div><div id="op-editors">${(node.ops||[]).map(opHtml).join('')}</div><button class="inspector-add" id="add-op" type="button">+ Add action</button><p class="inspector-note">Tags and saved fields stay on the customer: use them in conditions and they appear in the Inbox.</p></section><section class="inspector-section"><label>Next step</label>${targetControl('op-next',node.nextId,'End the flow')}</section>`;
    bindText('#node-title',value=>node.title=value||'Actions');
    const editors=document.querySelector('#op-editors');
    editors.addEventListener('change',event=>{const field=event.target.dataset.opField;if(field!=='type')return;node.ops[Number(event.target.dataset.index)]={type:event.target.value};markDirty();renderAll()});
    editors.addEventListener('input',event=>{const field=event.target.dataset.opField;if(!['key','value'].includes(field))return;node.ops[Number(event.target.dataset.index)][field]=event.target.value;markDirty();renderCanvas()});
    editors.addEventListener('click',event=>{const button=event.target.closest('[data-remove-op]');if(!button)return;node.ops.splice(Number(button.dataset.removeOp),1);markDirty();renderAll()});
    document.querySelector('#add-op').addEventListener('click',()=>{if(node.ops.length<10)node.ops.push({type:'add_tag',value:''});markDirty();renderAll()});
    bindTarget('#op-next',value=>node.nextId=value);bindRemoveNode(node)}
  function renderInputInspector(node){
    inspector.innerHTML=inspectorHead('COLLECT INFO',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="inspector-field"><label>Question</label><textarea id="input-text" rows="3" placeholder="What is your email?">${escapeHtml(node.text||'')}</textarea></div><div class="inspector-field"><label>Expected answer</label><select id="input-kind"><option value="email">Email</option><option value="phone">Phone number</option><option value="number">Number</option><option value="text">Any text</option></select></div><div class="inspector-field"><label>Save to field</label><input id="input-save" value="${escapeAttribute(node.saveTo||'')}" placeholder="${escapeAttribute(node.kind||'email')}" maxlength="60"></div><div class="inspector-field"><label>If the answer is not valid</label><textarea id="input-retry" rows="2" placeholder="That doesn’t look right, please try again.">${escapeHtml(node.retryText||'')}</textarea></div></section><section class="inspector-section"><label>After a valid answer</label>${targetControl('input-next',node.nextId,'End the flow')}</section>`;
    bindText('#node-title',value=>node.title=value||'Collect info');bindText('#input-text',value=>node.text=value);bindText('#input-save',value=>node.saveTo=value.trim());bindText('#input-retry',value=>node.retryText=value);
    const kind=document.querySelector('#input-kind');kind.value=node.kind||'text';kind.addEventListener('change',()=>{node.kind=kind.value;markDirty();renderAll()});
    bindTarget('#input-next',value=>node.nextId=value);bindRemoveNode(node)}
  function renderRandomizerInspector(node){
    const total=(node.branches||[]).reduce((sum,branch)=>sum+(Number(branch.percent)||0),0);
    inspector.innerHTML=inspectorHead('RANDOMIZER',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="section-heading"><span><b>Split</b><small>Each person goes down one path, by chance</small></span><em class="${total===100?'':'bad'}">${total}%</em></div><div id="branch-editors">${node.branches.map((branch,index)=>`<div class="rule-editor"><div class="rule-row"><b class="branch-letter">${branchLetter(index)}</b><input type="number" min="0" max="100" data-branch-percent="${index}" value="${Number(branch.percent)||0}"><span>%</span>${node.branches.length>2?`<button type="button" data-remove-branch="${index}" aria-label="Remove path">×</button>`:''}</div><select data-branch-next="${index}">${targetOptions(branch.nextId,'Choose a step')}</select></div>`).join('')}</div>${node.branches.length<6?'<button class="inspector-add" id="add-branch" type="button">+ Add path</button>':''}${total===100?'':'<p class="inspector-note bad">The paths must add up to 100%.</p>'}</section>`;
    bindText('#node-title',value=>node.title=value||'Randomizer');
    const editors=document.querySelector('#branch-editors');
    editors.addEventListener('change',event=>{if(event.target.dataset.branchNext!==undefined){node.branches[Number(event.target.dataset.branchNext)].nextId=event.target.value||null;markDirty();renderCanvas()}if(event.target.dataset.branchPercent!==undefined){markDirty();renderAll()}});
    editors.addEventListener('input',event=>{if(event.target.dataset.branchPercent===undefined)return;node.branches[Number(event.target.dataset.branchPercent)].percent=Math.max(0,Math.min(100,Number(event.target.value)||0));markDirty();renderCanvas()});
    editors.addEventListener('click',event=>{const button=event.target.closest('[data-remove-branch]');if(!button)return;node.branches.splice(Number(button.dataset.removeBranch),1);markDirty();renderAll()});
    document.querySelector('#add-branch')?.addEventListener('click',()=>{node.branches.push({id:uniqueId('branch'),percent:0,nextId:null});markDirty();renderAll()});
    bindRemoveNode(node)}
  function renderDelayInspector(node){inspector.innerHTML=inspectorHead('SMART DELAY',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="delay-fields"><label>Wait<input id="delay-amount" type="number" min="1" max="30" value="${Number(node.amount||1)}"></label><label>Unit<select id="delay-unit"><option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option></select></label></div></section><section class="inspector-section"><label>After the delay</label>${targetControl('delay-next',node.nextId,'Choose a step')}<button class="inspector-add" id="create-delay-step" type="button">+ Create connected step</button></section>`;bindText('#node-title',value=>node.title=value||'Smart delay');document.querySelector('#delay-amount').addEventListener('input',event=>{node.amount=Math.max(1,Number(event.target.value)||1);markDirty();renderCanvas()});const unit=document.querySelector('#delay-unit');unit.value=node.unit||'minute';unit.addEventListener('change',()=>{node.unit=unit.value;markDirty();renderCanvas()});bindTarget('#delay-next',value=>node.nextId=value);document.querySelector('#create-delay-step').addEventListener('click',()=>openStepPicker(node.id,'next'));bindRemoveNode(node)}
  function renderAiInspector(node){inspector.innerHTML=inspectorHead('AI ASSISTANT',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="inspector-field"><label>Instruction at this point</label><textarea id="ai-instruction" rows="6">${escapeHtml(node.instruction||'')}</textarea></div><label class="inspector-toggle"><span><b>Handoff when uncertain</b><small>Pause AI instead of inventing an answer</small></span><input id="ai-handoff" type="checkbox" ${node.handoff?'checked':''}></label></section><section class="inspector-section"><p class="inspector-note">The assistant continues naturally using the saved business knowledge, tools, orders, and calendar.</p></section>`;bindText('#node-title',value=>node.title=value||'AI assistant');bindText('#ai-instruction',value=>node.instruction=value);bindCheck('#ai-handoff',value=>node.handoff=value);bindRemoveNode(node)}
  function renderHandoffInspector(node){inspector.innerHTML=inspectorHead('HUMAN HANDOFF',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="inspector-field"><label>Internal note</label><textarea id="handoff-note" rows="4">${escapeHtml(node.note||'A customer needs a person.')}</textarea></div></section><section class="inspector-section"><p class="inspector-note">AI pauses, the conversation is marked “Needs attention,” and your configured owner notification is sent.</p></section>`;bindText('#node-title',value=>node.title=value||'Human handoff');bindText('#handoff-note',value=>node.note=value);bindRemoveNode(node)}

  function targetControl(id,value,emptyLabel){return`<select id="${id}">${targetOptions(value,emptyLabel)}</select>`}
  function targetOptions(value,emptyLabel){return`<option value="">${escapeHtml(emptyLabel)}</option>${state.nodes.map(node=>`<option value="${escapeAttribute(node.id)}" ${node.id===value?'selected':''}>${escapeHtml(node.title)} · ${escapeHtml(stepTitle(node.type))}</option>`).join('')}`}
  function bindTarget(selector,apply){document.querySelector(selector).addEventListener('change',event=>{apply(event.target.value||null);markDirty();renderCanvas()})}
  function bindRemoveNode(){closeInspectorButton()}
  function closeInspectorButton(){document.querySelector('[data-close-inspector]')?.addEventListener('click',()=>{state.selected=null;renderAll()})}
  function removeNode(id,{announce=false}={}){if(mode!=='edit')return;lastDeleted=structuredClone(state.nodes);if(announce)window.HansoraUI.toast('Step deleted · press ⌘Z / Ctrl+Z to undo');state.nodes=state.nodes.filter(node=>node.id!==id);state.nodes.forEach(node=>{if(node.nextId===id)node.nextId=null;if(node.replyNextId===id)node.replyNextId=null;if(node.yesId===id)node.yesId=null;if(node.noId===id)node.noId=null;(node.actions||[]).forEach(action=>{if(action.nextId===id)action.nextId=null});(node.branches||[]).forEach(branch=>{if(branch.nextId===id)branch.nextId=null})});state.selected=null;markDirty();renderAll()}
  // ManyChat-style: the step menu opens right next to the "+" that was clicked, and closes on any outside click.
  function openStepPicker(sourceId,kind,actionIndex,anchor){
    pendingConnection={sourceId,kind,actionIndex:Number.isInteger(actionIndex)?actionIndex:null};
    const pop=document.querySelector('#step-popover');const canvas=document.querySelector('#flow-canvas').getBoundingClientRect();const rect=(anchor||document.querySelector('#add-step-fab')).getBoundingClientRect();
    pop.querySelectorAll('[data-pop-add-node]').forEach(button=>{button.hidden=sourceId==='trigger'&&button.dataset.popAddNode!=='message'});
    pop.hidden=false;const width=300,height=pop.offsetHeight||420;
    pop.style.left=`${Math.max(8,Math.min(canvas.width-width-8,rect.right-canvas.left+10))}px`;pop.style.top=`${Math.max(8,Math.min(canvas.height-height-8,rect.top-canvas.top-20))}px`;
  }
  function closeStepPicker(){const pop=document.querySelector('#step-popover');if(pop)pop.hidden=true;pendingConnection=null}
  function connectionTarget(sourceId,kind,actionIndex){const source=byId(sourceId);if(!source)return null;if(kind==='action')return source.actions?.[actionIndex]?.nextId||null;if(kind==='reply')return source.replyNextId||null;if(kind==='yes')return source.yesId||null;if(kind==='no')return source.noId||null;if(kind==='branch')return source.branches?.[actionIndex]?.nextId||null;return source.nextId||null}
  function addFromLibrary(type){const sourceId=state.selected==='trigger'?'trigger':state.selected;let kind='next';const source=state.nodes.find(node=>node.id===sourceId);if(source?.type==='condition')kind=source.yesId?'no':'yes';addNode(type,{sourceId,kind})}
  function addNode(type,connection){
    const id=uniqueId(type);const node={id,type,title:stepTitle(type)};
    if(type==='message')Object.assign(node,{text:'Write your message here.',actions:[],nextId:null,replyNextId:null});if(type==='condition')Object.assign(node,{operator:'contains',value:'',yesId:null,noId:null});if(type==='delay')Object.assign(node,{amount:1,unit:'minute',nextId:null});if(type==='ai')Object.assign(node,{instruction:'Continue using the saved business knowledge.',handoff:true});if(type==='handoff')node.note='Pause AI and notify the team.';
    if(type==='condition')Object.assign(node,{title:'Follows you?',match:'all',rules:[{field:'follows',op:'is_true'}],passAfter:0});
    if(type==='action')Object.assign(node,{ops:[{type:'add_tag',value:''}],nextId:null});
    if(type==='input')Object.assign(node,{text:'What is your email?',kind:'email',saveTo:'email',retryText:'That doesn’t look like an email. Please try again.',nextId:null});
    if(type==='randomizer')Object.assign(node,{branches:[{id:uniqueId('branch'),percent:50,nextId:null},{id:uniqueId('branch'),percent:50,nextId:null}]});
    const sourcePos=connection&&currentLayout?.positions.get(connection.sourceId);if(sourcePos)node.pos=freeSpot(sourcePos.x+370,sourcePos.y);
    state.nodes.push(node);attachConnection(connection,id);state.selected=id;pendingConnection=null;markDirty();renderAll();requestAnimationFrame(()=>centerOn(id));
  }
  function attachConnection(connection,targetId){
    if(!connection)return;const source=state.nodes.find(node=>node.id===connection.sourceId);
    if(connection.sourceId==='trigger'){const target=state.nodes.find(node=>node.id===targetId);if(target?.type==='message')target.commentReply=true;return}
    if(!source)return;if(connection.kind==='action'&&source.actions?.[connection.actionIndex])source.actions[connection.actionIndex].nextId=targetId;else if(connection.kind==='reply')source.replyNextId=targetId;else if(connection.kind==='yes')source.yesId=targetId;else if(connection.kind==='no')source.noId=targetId;else if(connection.kind==='branch'&&source.branches?.[connection.actionIndex])source.branches[connection.actionIndex].nextId=targetId;else source.nextId=targetId;
  }

  async function openPostPicker(){
    const dialog=document.querySelector('#post-picker-dialog');const grid=document.querySelector('#post-picker-grid');grid.innerHTML='<p class="ui-empty">Loading your posts…</p>';dialog.showModal();
    try{if(api.isLocalPreview)posts=[1,2,3,4,5,6].map(index=>({id:`post-${index}`,caption:`Instagram post ${index}`,thumbnail_url:`data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='hsl(${index*55},55%,45%)'/><text x='60' y='68' font-size='26' text-anchor='middle' fill='white' font-family='sans-serif'>${index}</text></svg>`)}`}));else{const response=await api.authenticatedFetch('/.netlify/functions/automation-instagram-media',{method:'POST',body:JSON.stringify({business_id:businessId})});const result=await response.json();if(!response.ok)throw new Error(result.error||'instagram_media_unavailable');posts=result.media||[]}grid.innerHTML=posts.length?posts.map(post=>`<label>${post.thumbnail_url||post.media_url?`<img src="${escapeAttribute(post.thumbnail_url||post.media_url)}" alt="" class="post-thumb">`:''}<input type="checkbox" value="${escapeAttribute(post.id)}" ${state.trigger.postIds.includes(post.id)?'checked':''}><span>${escapeHtml((post.caption||'Post or reel').slice(0,55))}</span></label>`).join(''):'<p class="ui-empty">No posts or reels found.</p>'}catch(error){grid.innerHTML=`<p class="ui-alert">${escapeHtml(api.displayError(error))}</p>`}
  }
  function showPreview(){
    const thread=document.querySelector('#flow-preview-thread');const comment=state.trigger.match==='exact'&&state.trigger.keywords[0]?state.trigger.keywords[0]:state.trigger.match==='contains'&&state.trigger.keywords[0]?`Can I get the ${state.trigger.keywords[0]}?`:'How much is this?';const rows=[`<div class="customer">${escapeHtml(comment)}</div>`];if(state.trigger.publicEnabled&&state.trigger.variations[0])rows.push(`<div>${escapeHtml(state.trigger.variations[0])}</div>`);
    let node=entryNode(),guard=0;while(node&&guard++<12){if(node.type==='message'){rows.push(`<div>${escapeHtml(node.text||'')} ${(node.actions||[]).map(action=>`<button>${escapeHtml(action.label)} ${action.type==='website'?'↗':''}</button>`).join('')}</div>`);const action=(node.actions||[]).find(item=>item.type==='quick_reply'&&item.nextId);node=byId(action?.nextId||node.nextId||node.replyNextId);}else if(node.type==='delay'){rows.push(`<p class="preview-system">Wait ${Number(node.amount||1)} ${escapeHtml(pluralUnit(node.unit,node.amount))}</p>`);node=byId(node.nextId);}else if(node.type==='condition'){rows.push(`<p class="preview-system">Check: ${escapeHtml(nodeSummary(node))} → Yes</p>`);node=byId(node.yesId||node.noId);}else if(node.type==='action'){rows.push(`<p class="preview-system">${escapeHtml((node.ops||[]).map(opSummary).join(' · ')||'Actions')}</p>`);node=byId(node.nextId);}else if(node.type==='input'){rows.push(`<div>${escapeHtml(node.text||'')}</div><div class="customer">${node.kind==='email'?'ani@example.com':node.kind==='phone'?'+374 99 123456':node.kind==='number'?'3':'My answer'}</div>`);node=byId(node.nextId);}else if(node.type==='randomizer'){rows.push('<p class="preview-system">Randomizer picks a path</p>');node=byId(node.branches?.[0]?.nextId);}else if(node.type==='ai'){rows.push('<div>AI assistant continues with your business knowledge.</div>');node=null;}else if(node.type==='handoff'){rows.push('<p class="preview-system">Conversation handed to your team</p>');node=null;}else node=null;}
    thread.innerHTML=rows.join('');document.querySelector('#flow-preview-dialog').showModal();
  }
  async function loadFlow(){
    if(api.isLocalPreview){
      try{
        const flows=JSON.parse(localStorage.getItem(previewStoreKey)||'[]');
        const saved=Array.isArray(flows)&&requestedWorkflowId?flows.find(flow=>flow.workflowId===requestedWorkflowId):Array.isArray(flows)&&!createNew?flows[0]:null;
        const legacy=!saved&&!createNew?JSON.parse(localStorage.getItem('hansora_comment_flow_preview')||'null'):null;
        if(saved||legacy)state=mergePreviewState(saved||legacy);
        else if(createNew)state=templateState(requestedTemplate||'blank');
      }catch(_){if(createNew)state=templateState(requestedTemplate||'blank')}
      return true;
    }
    let query=api.db.from('automation_comment_workflows').select('*').eq('business_id',businessId);
    if(requestedWorkflowId){if(!/^[0-9a-f-]{36}$/i.test(requestedWorkflowId)){fail('This automation link is invalid.');return false}query=query.eq('id',requestedWorkflowId)}
    else if(createNew){state=templateState(requestedTemplate||'blank');return true}
    else query=query.order('updated_at',{ascending:false}).limit(1);
    const result=await query.maybeSingle();if(result.error){fail(api.displayError(result.error));return false}if(!result.data)return true;state=stateFromRow(result.data);return true;
  }
  function mergePreviewState(saved){return{...structuredClone(defaults),...saved,trigger:{...structuredClone(defaults.trigger),...(saved.trigger||{})},nodes:Array.isArray(saved.nodes)?saved.nodes:structuredClone(defaults.nodes),selected:null}}
  function stateFromRow(row){return{workflowId:row.id,name:row.name,status:row.status,selected:null,createdAt:row.created_at,updatedAt:row.updated_at,metrics:{runs:Number(row.triggered_count||0)},trigger:{scope:row.post_scope,postIds:row.selected_post_ids||[],postPreviews:row.safety_config?.post_previews||{},match:row.match_type,keywords:row.keywords||[],exclude:row.safety_config?.exclude_keywords||[],publicEnabled:row.safety_config?.public_reply_enabled!==false,variations:row.public_reply_variations||[],firstCommentOnly:row.safety_config?.first_comment_only!==false,ignoreOwn:row.safety_config?.ignore_own!==false},triggerPos:row.safety_config?.layout?.trigger||null,nodes:Array.isArray(row.dm_steps)?row.dm_steps:structuredClone(defaults.nodes)}}
  function templateState(template){
    const next=structuredClone(defaults);next.workflowId=null;next.status='draft';next.createdAt=new Date().toISOString();next.updatedAt=next.createdAt;
    // Like ManyChat: a new automation starts empty ("When…" plus "Choose first step"); templates are optional.
    if(!['send-link','prices','lead','follow-link'].includes(template)){next.name='Untitled automation';next.nodes=[];next.selected=null;return next}
    if(template==='follow-link'){next.name='Follow to get the link';next.trigger.match='contains';next.trigger.keywords=['link'];next.trigger.variations=['Sent you a DM 📩'];next.nodes=[
      {id:'message-opening',type:'message',title:'Opening DM',text:'Hey! Tap below and I’ll send you the link 👇',commentReply:true,replyNextId:null,nextId:null,actions:[{id:'action-send',type:'quick_reply',label:'Send me the link',nextId:'check-follow'}]},
      {id:'check-follow',type:'condition',title:'Follows you?',match:'all',rules:[{field:'follows',op:'is_true'}],passAfter:3,yesId:'message-link',noId:'message-follow'},
      {id:'message-follow',type:'message',title:'Ask to follow',text:'Almost there! Follow our account first, then tap the button below 🙏',replyNextId:null,nextId:null,actions:[{id:'action-followed',type:'quick_reply',label:'I followed ✅',nextId:'check-follow'}]},
      {id:'message-link',type:'message',title:'Send the link',text:'Here is your link 🎉',replyNextId:null,nextId:null,actions:[{id:'action-open',type:'website',label:'Open link',url:'https://example.com'}]}
    ];next.selected=null;return next}
    if(template==='send-link'){next.name='Send a link from comments';next.trigger.match='contains';next.trigger.keywords=['link','guide'];next.nodes=[{id:'message-opening',type:'message',title:'Opening DM',text:'I have the link ready for you. Tap below to receive it.',commentReply:true,replyNextId:'ai-assistant',actions:[{id:'action-link',type:'quick_reply',label:'Send the link',nextId:'message-link'}]},{id:'message-link',type:'message',title:'Deliver the link',text:'Here you go — open the page below.',actions:[{id:'action-website',type:'website',label:'Open link',url:'https://example.com'}]},{id:'ai-assistant',type:'ai',title:'AI assistant',instruction:'Answer any follow-up questions about the linked offer.',handoff:true}];}
    if(template==='prices'){next.name='Share prices automatically';next.trigger.match='contains';next.trigger.keywords=['price','cost'];next.nodes=[{id:'message-opening',type:'message',title:'Opening DM',text:'I can send the prices privately. Tap below to continue.',commentReply:true,replyNextId:'ai-assistant',actions:[{id:'action-prices',type:'quick_reply',label:'Show prices',nextId:'delay-natural'}]},{id:'delay-natural',type:'delay',title:'Natural pause',amount:1,unit:'minute',nextId:'message-prices'},{id:'message-prices',type:'message',title:'Price information',text:'Here are our current prices. Tell me what you need and I’ll help you choose.',replyNextId:'ai-assistant',actions:[]},{id:'ai-assistant',type:'ai',title:'AI assistant',instruction:'Explain pricing from business knowledge and help the customer choose.',handoff:true}];}
    if(template==='lead'){next.name='Collect interested leads';next.trigger.match='contains';next.trigger.keywords=['interested','details'];next.nodes=[{id:'message-opening',type:'message',title:'Opening DM',text:'Thanks for your interest. Would you like help choosing the right option?',commentReply:true,replyNextId:'ai-assistant',actions:[{id:'action-help',type:'quick_reply',label:'Yes, help me',nextId:'ai-assistant'},{id:'action-person',type:'handoff',label:'Talk to a person'}]},{id:'ai-assistant',type:'ai',title:'Qualify and save lead',instruction:'Understand what the customer needs, collect their preferred contact details with consent, and use the lead tool when they are interested.',handoff:true}];}
    next.selected=null;return next;
  }
  async function saveFlow(status=state.status){
    if(!validateFlow(status==='active'))return false;state.status=status;state.name=document.querySelector('#flow-name').value.trim()||'Comment to DM';const payload={business_id:businessId,name:state.name,status,post_scope:state.trigger.scope,selected_post_ids:state.trigger.postIds,match_type:state.trigger.match,keywords:state.trigger.keywords,public_reply_variations:state.trigger.publicEnabled?state.trigger.variations.filter(value=>value.trim()).slice(0,3):[],dm_steps:state.nodes,safety_config:{exclude_keywords:state.trigger.exclude,public_reply_enabled:state.trigger.publicEnabled,first_comment_only:state.trigger.firstCommentOnly,ignore_own:state.trigger.ignoreOwn,flow_version:3,post_previews:state.trigger.scope==='selected'?(state.trigger.postPreviews||{}):{},layout:state.triggerPos?{trigger:state.triggerPos}:{}},...(status==='active'?{activated_at:new Date().toISOString()}:{})};
    try{if(api.isLocalPreview){const now=new Date().toISOString();state.workflowId=state.workflowId||`preview-${Date.now()}`;state.createdAt=state.createdAt||now;state.updatedAt=now;state.metrics=state.metrics||{runs:0,dms:0,engaged:0,failed:0};let flows=[];try{flows=JSON.parse(localStorage.getItem(previewStoreKey)||'[]')}catch(_){}if(!Array.isArray(flows))flows=[];const index=flows.findIndex(flow=>flow.workflowId===state.workflowId);const saved=structuredClone(state);if(index>=0)flows[index]=saved;else flows.unshift(saved);localStorage.setItem(previewStoreKey,JSON.stringify(flows));localStorage.setItem('hansora_comment_flow_preview',JSON.stringify(state));syncWorkflowUrl()}else if(state.workflowId){const result=await api.db.from('automation_comment_workflows').update(payload).eq('id',state.workflowId).eq('business_id',businessId).select('id').single();if(result.error)throw result.error}else{const result=await api.db.from('automation_comment_workflows').insert(payload).select('id').single();if(result.error)throw result.error;state.workflowId=result.data.id;syncWorkflowUrl()}setSaved();renderStatus();return true}catch(error){showError(api.displayError(error));return false}
  }
  function syncWorkflowUrl(){if(!state.workflowId)return;const url=new URL(location.href);url.searchParams.set('workflow',state.workflowId);url.searchParams.delete('new');url.searchParams.delete('template');history.replaceState({},'',url)}
  async function activateFlow(){if(!validateFlow(true))return;if(!api.isLocalPreview){const connection=await api.db.from('automation_channel_connections').select('status').eq('business_id',businessId).eq('channel_type','instagram_comments').maybeSingle();if(connection.error)return showError(api.displayError(connection.error));if(!connection.data||!['connecting','connected'].includes(connection.data.status))return showError('Connect your Instagram account before setting this flow live.')}if(!await saveFlow('active'))return;if(!api.isLocalPreview){const result=await api.db.from('automation_channel_connections').update({status:'connected'}).eq('business_id',businessId).eq('channel_type','instagram_comments');if(result.error)return showError(api.displayError(result.error))}state.status='active';editSnapshot=null;mode='view';state.selected=null;setSaved('Flow is live');renderAll();loadStats();window.HansoraUI.toast('Your comment automation is live')}
  function validateFlow(forActivation){
    if(forActivation&&state.trigger.scope==='selected'&&!state.trigger.postIds.length)return validationError('Choose at least one Instagram post or reel.');if(forActivation&&state.trigger.match!=='any'&&!state.trigger.keywords.length)return validationError('Add at least one comment word or phrase.');const opening=entryNode();if(forActivation&&(!opening||opening.type!=='message'||!String(opening.text||'').trim()))return validationError('Add an opening Instagram message before setting the flow live.');if(forActivation&&opening&&!((opening.actions||[]).some(action=>['quick_reply','handoff'].includes(action.type))||opening.replyNextId))return validationError('The opening DM needs a conversational button or a route for typed replies.');for(const node of state.nodes){for(const action of node.actions||[]){if(action.type==='quick_reply'&&!action.nextId)return validationError(`Choose what happens after “${action.label||'Untitled button'}”.`);if(action.type==='website'&&!/^https:\/\//i.test(String(action.url||'')))return validationError(`Add a secure https:// link for “${action.label||'Website button'}”.`);}
      if(!forActivation)continue;
      if(node.type==='condition'&&Array.isArray(node.rules)){for(const rule of node.rules){if(['tag','follower_count'].includes(rule.field)&&!String(rule.value??'').trim())return validationError(`“${node.title}”: fill in the ${rule.field==='tag'?'tag name':'follower number'}.`);if(rule.field==='field'&&!String(rule.key||'').trim())return validationError(`“${node.title}”: choose which saved field to check.`);if(rule.field==='reply'&&rule.op!=='any'&&!String(rule.value||'').trim())return validationError(`“${node.title}”: add the words to look for in the reply.`)}}
      if(node.type==='action'){if(!(node.ops||[]).length)return validationError(`“${node.title}”: add at least one action.`);for(const op of node.ops){if(['add_tag','remove_tag'].includes(op.type)&&!String(op.value||'').trim())return validationError(`“${node.title}”: fill in the tag name.`);if(['set_field','clear_field'].includes(op.type)&&!String(op.key||'').trim())return validationError(`“${node.title}”: fill in the field name.`)}}
      if(node.type==='input'&&!String(node.text||'').trim())return validationError(`“${node.title}”: write the question to ask.`);
      if(node.type==='randomizer'){const total=(node.branches||[]).reduce((sum,branch)=>sum+(Number(branch.percent)||0),0);if(total!==100)return validationError(`“${node.title}”: the paths must add up to 100% (now ${total}%).`);if((node.branches||[]).some(branch=>Number(branch.percent)>0&&!branch.nextId))return validationError(`“${node.title}”: choose where every path goes.`)}
    }errorBox.hidden=true;return true
  }
  function validationError(message){showError(message);return false}
  function triggerSummary(){const scope={all:'All posts and reels',selected:`${state.trigger.postIds.length||'No'} selected posts`,next:'Your next post or reel'}[state.trigger.scope];const match=state.trigger.match==='any'?'Any comment':`${capitalize(state.trigger.match)}: ${state.trigger.keywords.join(', ')||'add keywords'}`;return`${scope} · ${match}`}
  function triggerChips(){const output=[];if(state.trigger.publicEnabled)output.push(`${state.trigger.variations.filter(Boolean).length} public replies`);if(state.trigger.firstCommentOnly)output.push('First comment only');return output}
  function nodeSummary(node){if(node.type!=='condition')return'';if(!Array.isArray(node.rules))return`Reply ${node.operator||'contains'} ${node.value||'a value'}`;const parts=node.rules.map(ruleSummary);return parts.join(node.match==='any'?' or ':' and ')||'Add a condition'}
  function ruleSummary(rule){const op=(RULE_OPS[rule.field]||[]).find(([value])=>value===rule.op)?.[1]||'';if(rule.field==='follows')return rule.op==='is_false'?'Does not follow you':'Follows you';if(rule.field==='follower_count')return`Followers ${op} ${rule.value||0}`;if(rule.field==='tag')return`${rule.op==='not_has'?'No tag':'Tag'} “${rule.value||'…'}”`;if(rule.field==='field')return`${rule.key||'field'} ${op}${['is_set','not_set'].includes(rule.op)?'':` “${rule.value||''}”`}`;return rule.op==='any'?'Replied anything':`Reply ${op} “${rule.value||''}”`}
  function opSummary(op){const label=OP_TYPES[op.type]||'Action';if(['add_tag','remove_tag'].includes(op.type))return`${label}: ${op.value||'…'}`;if(op.type==='set_field')return`Save ${op.key||'field'} = ${op.value||'…'}`;if(op.type==='clear_field')return`Clear ${op.key||'field'}`;if(op.type==='notify')return`Notify team${op.value?`: ${op.value}`:''}`;return label}
  function branchLetter(index){return String.fromCharCode(65+index)}
  function targetName(id){return byId(id)?.title||'Choose next'}
  function byId(id){return state.nodes.find(node=>node.id===id)||null}
  function stepTitle(type){return({message:'Instagram message',condition:'Condition',delay:'Smart delay',ai:'AI assistant',handoff:'Human handoff',action:'Actions',input:'Collect info',randomizer:'Randomizer'})[type]||'Step'}
  function pluralUnit(unit,amount){const value=unit||'minute';return Number(amount)===1?value:`${value}s`}
  function uniqueId(prefix){return`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2,7)}`}
  function bindText(selector,apply){const element=document.querySelector(selector);if(!element)return;element.addEventListener('input',event=>{apply(event.target.value);markDirty();renderCanvas()})}
  function bindLines(selector,apply){const element=document.querySelector(selector);if(!element)return;element.addEventListener('input',()=>{apply(element.value.split('\n').map(value=>value.trim()).filter(Boolean));markDirty();renderCanvas()})}
  function bindCheck(selector,apply){document.querySelector(selector).addEventListener('change',event=>{apply(event.target.checked);markDirty();renderCanvas()})}
  function markDirty(){
    if(state.status==='active'){document.querySelector('#draft-state').textContent='Unpublished changes — click Publish changes';return}
    document.querySelector('#draft-state').textContent='Unsaved changes';clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveFlow(state.status),1200)
  }
  function setSaved(message='All changes saved'){document.querySelector('#draft-state').textContent=message}
  function showError(message){errorBox.textContent=message;errorBox.hidden=false;errorBox.scrollIntoView({behavior:'smooth',block:'nearest'})}
  function fail(message){loading.hidden=true;builder.hidden=true;showError(message)}
  function capitalize(value){return String(value||'').replace(/^./,letter=>letter.toUpperCase())}
  function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]))}
  // ---------- Canvas camera: pan, zoom, fit (like ManyChat / Figma) ----------
  function applyCamera(){document.querySelector('#flow-map').style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;document.querySelector('#flow-map').style.setProperty('--z',camera.z);document.querySelector('#zoom-reset').textContent=`${Math.round(camera.z*100)}%`}
  function zoomBy(factor,cx,cy){const rect=document.querySelector('#flow-canvas').getBoundingClientRect();const px=cx??rect.width/2,py=cy??rect.height/2;const next=Math.min(2,Math.max(0.25,camera.z*factor));camera.x=px-(px-camera.x)*(next/camera.z);camera.y=py-(py-camera.y)*(next/camera.z);camera.z=next;applyCamera()}
  function bounds(){const points=[...(currentLayout?.positions.values()||[])];const origin=currentLayout?.positions.get('trigger');if(origin&&!entryNode())points.push({x:origin.x+370,y:origin.y});if(!points.length)return null;return{minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x))+330,maxY:Math.max(...points.map(p=>p.y))+320}}
  function fitView(){const box=bounds();if(!box)return;const rect=document.querySelector('#flow-canvas').getBoundingClientRect();const z=Math.min(1,Math.max(0.3,Math.min((rect.width-80)/(box.maxX-box.minX),(rect.height-140)/(box.maxY-box.minY))));camera.z=z;camera.x=(rect.width-(box.maxX-box.minX)*z)/2-box.minX*z;camera.y=Math.max(64,(rect.height-(box.maxY-box.minY)*z)/2)-box.minY*z;applyCamera()}
  function centerOn(id){const point=currentLayout?.positions.get(id);if(!point)return;const rect=document.querySelector('#flow-canvas').getBoundingClientRect();const panel=document.querySelector('#flow-inspector').classList.contains('closed')||rect.width<900?0:400;camera.x=(rect.width-panel)/2-(point.x+160)*camera.z;camera.y=rect.height/3-(point.y+60)*camera.z;applyCamera()}
  function drawEdges(){if(currentLayout)document.querySelector('#flow-lines').innerHTML=currentLayout.edges.map(edge=>edgePath(edge,currentLayout.positions)).join('')}
  function setupCanvasGestures(){
    const canvas=document.querySelector('#flow-canvas');
    // Trackpad pinch / Ctrl+wheel zooms at the cursor; normal scrolling moves around the canvas.
    canvas.addEventListener('wheel',event=>{if(event.target.closest('.flow-add-panel'))return;event.preventDefault();const rect=canvas.getBoundingClientRect();if(event.ctrlKey||event.metaKey)zoomBy(Math.exp(-event.deltaY*0.0025),event.clientX-rect.left,event.clientY-rect.top);else{camera.x-=event.deltaX;camera.y-=event.deltaY;applyCamera()}},{passive:false});
    let gesture=null;
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('.flow-zoom,.flow-add-panel,.flow-add-fab,.flow-node-menu,.flow-mode-banner'))return;
      const nodeEl=event.target.closest('[data-node-id]');
      if(nodeEl){if(mode!=='edit'||event.target.closest('button,input,textarea,select,a'))return;const id=nodeEl.dataset.nodeId;gesture={kind:'node',id,el:nodeEl,startX:event.clientX,startY:event.clientY,origin:{...currentLayout.positions.get(id)},moved:false};}
      else gesture={kind:'pan',startX:event.clientX,startY:event.clientY,origin:{x:camera.x,y:camera.y},moved:false};
      gesture.pointerId=event.pointerId;
    });
    canvas.addEventListener('pointermove',event=>{
      if(!gesture)return;const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
      if(!gesture.moved&&Math.hypot(dx,dy)<4)return;if(!gesture.moved){gesture.moved=true;try{canvas.setPointerCapture(gesture.pointerId)}catch(_){}document.querySelector('.node-toolbar')?.remove();}
      if(gesture.kind==='pan'){camera.x=gesture.origin.x+dx;camera.y=gesture.origin.y+dy;applyCamera();canvas.classList.add('panning');return}
      const x=Math.round(gesture.origin.x+dx/camera.z),y=Math.round(gesture.origin.y+dy/camera.z);
      gesture.el.style.left=`${x}px`;gesture.el.style.top=`${y}px`;gesture.el.classList.add('dragging');currentLayout.positions.set(gesture.id,{x,y});drawEdges();
    });
    const finish=()=>{
      if(!gesture)return;const done=gesture;gesture=null;canvas.classList.remove('panning');
      if(!done.moved){if(done.kind==='pan'&&state.selected){state.selected=null;renderAll()}return}suppressClick=true;setTimeout(()=>{suppressClick=false},50);
      if(done.kind==='node'){const pos=currentLayout.positions.get(done.id);if(done.id==='trigger')state.triggerPos=pos;else{const node=byId(done.id);if(node)node.pos=pos}markDirty();renderCanvas()}
    };
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  }
  function onKeyDown(event){
    if(event.target.closest?.('input,textarea,select,[contenteditable]'))return;
    if(event.key==='Escape'){toggleAddPanel(false);closeStepPicker();document.querySelector('#node-menu').hidden=true;if(state.selected){state.selected=null;renderAll()}}
    if(mode!=='edit')return;
    if((event.key==='Delete'||event.key==='Backspace')&&state.selected&&state.selected!=='trigger'&&byId(state.selected)){event.preventDefault();removeNode(state.selected,{announce:true})}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&lastDeleted){event.preventDefault();state.nodes=lastDeleted;lastDeleted=null;markDirty();renderAll();window.HansoraUI.toast('Step restored')}
  }

  // ---------- Add panel, step menu, duplicate ----------
  function toggleAddPanel(force){const panel=document.querySelector('#add-panel');const open=typeof force==='boolean'?force:panel.hidden;panel.hidden=!open;document.querySelector('#add-step-fab').setAttribute('aria-expanded',String(open));document.querySelector('#add-step-fab').classList.toggle('open',open)}
  function openNodeMenu(button){const menu=document.querySelector('#node-menu');const canvas=document.querySelector('#flow-canvas').getBoundingClientRect();const rect=button.getBoundingClientRect();menu.dataset.nodeId=button.dataset.nodeMenu;menu.style.left=`${Math.max(8,rect.right-canvas.left-160)}px`;menu.style.top=`${rect.bottom-canvas.top+6}px`;menu.hidden=false;state.selected=button.dataset.nodeMenu;document.querySelectorAll('.flow-node').forEach(node=>node.classList.toggle('selected',node.dataset.nodeId===state.selected));renderInspector()}
  function duplicateNode(id){const source=byId(id);if(!source)return;const copy=structuredClone(source);copy.id=uniqueId(source.type);copy.title=`${source.title} copy`;delete copy.commentReply;(copy.actions||[]).forEach(action=>{action.id=uniqueId('action')});const pos=currentLayout?.positions.get(id);if(pos)copy.pos=freeSpot(pos.x+40,pos.y+60);state.nodes.push(copy);state.selected=copy.id;markDirty();renderAll();window.HansoraUI.toast('Step duplicated')}
  function freeSpot(x,y){const taken=[...(currentLayout?.positions.values()||[])];let top=y;while(taken.some(point=>Math.abs(point.x-x)<300&&Math.abs(point.y-top)<260))top+=300;return{x,y:top}}

  // ---------- View (live, with results) vs Edit ----------
  function enterEdit(){editSnapshot=structuredClone({nodes:state.nodes,trigger:state.trigger,name:state.name,triggerPos:state.triggerPos||null});mode='edit';renderAll()}
  function discardEdit(){if(editSnapshot){Object.assign(state,structuredClone(editSnapshot));document.querySelector('#flow-name').value=state.name}editSnapshot=null;mode='view';setSaved();renderAll()}

  // ---------- Results per step ----------
  async function loadStats(){
    if(api.isLocalPreview){stats=exampleStats();renderAll();return}
    if(!state.workflowId)return;
    try{const response=await api.authenticatedFetch('/.netlify/functions/automation-flow-stats',{method:'POST',body:JSON.stringify({business_id:businessId,workflow_id:state.workflowId})});if(!response.ok)throw new Error('stats_unavailable');stats=await response.json();}
    catch(_){stats={trigger:{comments:0,publicReplies:0,privateReplies:0,failed:0},nodes:{},unavailable:true}}
    renderAll();
  }
  function exampleStats(){
    const result={example:true,trigger:{comments:22,publicReplies:21,privateReplies:22,failed:0},nodes:{}};let reach=22;
    state.nodes.forEach(node=>{if(node.type==='message'){const clicks={};(node.actions||[]).forEach((action,index)=>{clicks[action.type==='handoff'?'handoff':action.id]=Math.max(1,Math.round(reach*(index?0.12:0.45)))});result.nodes[node.id]={sent:reach,seen:Math.round(reach*0.82),failed:0,clicks,reached:0};reach=Math.max(3,Math.round(reach*0.55))}else result.nodes[node.id]={sent:0,seen:0,failed:0,clicks:{},reached:Math.max(1,Math.round(reach*0.6))}});
    return result;
  }
  function nodeStats(id){return stats?.nodes?.[id]||{sent:0,seen:0,failed:0,clicks:{},reached:0}}
  function totalClicks(s){return Object.values(s.clicks||{}).reduce((sum,value)=>sum+value,0)}
  function pct(part,whole){return whole?`${Math.round(part/whole*100)}%`:'0%'}
  function statStrip(node){
    if(!stats||mode!=='view')return'';
    if(node.type==='trigger'){const t=stats.trigger;return`<div class="node-stats"><span><b>${t.comments}</b>Comments</span><span><b>${t.privateReplies}</b>DMs</span><span><b>${t.publicReplies}</b>Replies</span></div>`}
    const s=nodeStats(node.id);
    if(node.type==='message')return`<div class="node-stats"><span><b>${s.sent}</b>Sent</span><span><b>${pct(s.seen,s.sent)}</b>Seen</span><span><b>${pct(totalClicks(s),s.sent)}</b>Clicked</span></div>`;
    if(node.type==='ai'||node.type==='handoff')return`<div class="node-stats"><span><b>${s.reached}</b>${node.type==='ai'?'Talking to AI':'Handed over'}</span></div>`;
    return'';
  }
  function statsRow(label,total,rate){return`<div class="stats-row"><span>${label}</span><b>${total}</b><em>${rate}</em></div>`}
  function renderStatsInspector(){
    const note=stats?.example?'<p class="stats-note">Example numbers. Real results appear once this automation runs.</p>':stats?.unavailable?'<p class="stats-note">Results are not available right now.</p>':'';
    const foot='<div class="stats-foot"><button class="ui-btn primary sm" type="button" data-stats-edit>Edit automation</button></div>';
    if(!stats){inspector.innerHTML='<div class="stats-hero"><p>Results</p><h2>Loading…</h2></div>';return}
    const node=byId(state.selected);
    if(!node){const t=stats.trigger;inspector.innerHTML=`<div class="stats-hero"><p>Instagram comment</p><h2>${t.comments} comments</h2><span>matched this automation</span></div>${note}<div class="stats-table"><div class="stats-head"><span>Event</span><span>Total</span><span>Rate</span></div>${statsRow('Private DMs sent',t.privateReplies,pct(t.privateReplies,t.comments))}${statsRow('Public replies',t.publicReplies,pct(t.publicReplies,t.comments))}${statsRow('Failed',t.failed,pct(t.failed,t.comments))}</div>${foot}`}
    else if(node.type==='message'){const s=nodeStats(node.id);const clicks=totalClicks(s);inspector.innerHTML=`<div class="stats-hero"><p>${escapeHtml(node.title)}</p><h2>${s.sent} people</h2><span>reached this step</span><strong>${pct(s.sent,stats.trigger.comments||s.sent)}</strong></div>${note}<div class="stats-table"><div class="stats-head"><span>Event</span><span>Total</span><span>Rate</span></div>${statsRow('Sent',s.sent,s.sent?'100%':'0%')}${statsRow('Seen',s.seen,pct(s.seen,s.sent))}${statsRow('Clicks',clicks,pct(clicks,s.sent))}${statsRow('Failed',s.failed,pct(s.failed,s.sent+s.failed))}</div><div class="stats-message"><div class="stats-bubble">${escapeHtml(node.text||'')}</div>${(node.actions||[]).map(action=>`<div class="stats-button"><span>${escapeHtml(action.label||'Button')}</span><em>CTR ${pct(s.clicks[action.type==='handoff'?'handoff':action.id]||0,s.sent)}</em></div>`).join('')}</div>${foot}`}
    else{const s=nodeStats(node.id);inspector.innerHTML=`<div class="stats-hero"><p>${escapeHtml(node.title)}</p><h2>${s.reached} people</h2><span>${node.type==='ai'?'are talking to the AI':node.type==='handoff'?'were handed to your team':'passed this step'}</span></div>${note}${foot}`}
    inspector.querySelector('[data-stats-edit]')?.addEventListener('click',enterEdit);
  }
  function escapeAttribute(value){return escapeHtml(value).replace(/`/g,'&#96;')}
})();
