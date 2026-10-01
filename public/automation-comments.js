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

  const defaults={workflowId:null,name:'Comment to DM',status:'draft',selected:'message-opening',trigger:{type:'comment',ref:'',question:'',scope:'all',postIds:[],match:'any',keywords:[],exclude:[],publicEnabled:true,variations:['Thanks for your comment! I just sent you the details in a private message.'],firstCommentOnly:true,ignoreOwn:true},nodes:[
    {id:'message-opening',type:'message',title:'Opening DM',text:'Hi! Thanks for your interest. Tap below and I’ll send the details.',commentReply:true,replyNextId:'ai-assistant',actions:[{id:'action-details',type:'quick_reply',label:'Send me details',nextId:'delay-natural'},{id:'action-website',type:'website',label:'Visit website',url:'https://example.com'}]},
    {id:'delay-natural',type:'delay',title:'Natural pause',amount:1,unit:'minute',nextId:'message-details'},
    {id:'message-details',type:'message',title:'Send the details',text:'Here are the details you asked for. What would you like help with next?',replyNextId:'ai-assistant',actions:[{id:'action-question',type:'quick_reply',label:'Ask a question',nextId:'ai-assistant'},{id:'action-person',type:'handoff',label:'Talk to a person'}]},
    {id:'ai-assistant',type:'ai',title:'AI assistant',instruction:'Continue using the saved business knowledge and help the customer complete their goal.',handoff:true}
  ]};
  const previewStoreKey='hansora_comment_workflows_preview';
  // Triggers, like ManyChat's "New Trigger" list.
  const TRIGGERS={comment:{label:'Post or reel comment',hint:'Someone comments on your post or reel',icon:'comment'},live_comment:{label:'Live comment',hint:'Someone comments during your Live',icon:'play'},dm_keyword:{label:'DM keyword',hint:'Someone sends you a word, like PRICE',icon:'message'},story_reply:{label:'Story reply',hint:'Someone replies to your story',icon:'instagram'},story_mention:{label:'Story mention',hint:'Someone mentions you in their story',icon:'bell'},share:{label:'Shared post or reel',hint:'Someone shares a post or reel to your DMs',icon:'arrow'},ref_link:{label:'ig.me link',hint:'Someone opens your link with a code',icon:'arrow'},ice_breaker:{label:'Conversation starter',hint:'A question shown to people opening a chat',icon:'message'},default_reply:{label:'Default reply',hint:'Any message no other automation catches',icon:'message'}};
  // Step settings vocabulary (defined before the first render).
  const BLOCK_LABELS={image:'🖼 Image',video:'🎬 Video',cards:'🗂 Card',text:'💬 Text',typing:'⌨ Delay',file:'📄 PDF',audio:'🔊 Audio',dynamic:'⚡ Dynamic'};
  const RULE_FIELDS={follows:'Follows your Instagram',follower_count:'Their follower count',tag:'Has a tag',field:'A saved field (email, phone…)',reply:'What they typed'};
  const RULE_HELP={follows:'Checks if this person follows your Instagram account. Instagram only tells us after they tapped a button or wrote to you, so put this after a button like “Send me the link”.',follower_count:'How many followers this person has, for example to treat bigger accounts differently.',tag:'Tags are added by an Actions step (for example “Got link” or “VIP”).',field:'Information saved by a Collect info or Actions step, like their email or phone.',reply:'The last message they typed to you.'};
  const RULE_OPS={follows:[['is_true','Yes, they follow you'],['is_false','No, they don’t follow you']],follower_count:[['gte','at least'],['lte','at most'],['gt','more than'],['lt','less than']],tag:[['has','has tag'],['not_has','does not have tag']],field:[['equals','is'],['contains','contains'],['is_set','has any value'],['not_set','is empty']],reply:[['contains','contains'],['exact','is exactly'],['any','anything']]};
  const OP_TYPES={add_tag:'Add tag',remove_tag:'Remove tag',set_field:'Save a field',clear_field:'Clear a field',notify:'Notify my team',mark_needs_you:'Mark chat “Needs you”',assign:'Assign to a team member',start_flow:'Start another automation',webhook:'Send to another app'};
  const INPUT_KINDS={email:'email',phone:'phone number',number:'number',text:'text'};
  let otherFlows=[]; // for "Start another automation"
  let selectedEdge=null; // a clicked connection line, shown with a remove button
  let triggerListOpen=false; // the trigger list opens with "Change", like ManyChat's trigger picker
  // Undo / redo of every change (like ManyChat), and a clipboard for steps that works across automations.
  let undoStack=[],future=[],lastSnapshot=null,historyTimer=null,restoring=false;
  const clipboardKey='hansora_flow_clipboard';
  let state=structuredClone(defaults);let posts=[];let saveTimer=null;let pendingConnection=null;
  // Canvas camera (pan/zoom), ManyChat-style view vs edit mode, per-step results, and undo for deletes.
  let camera={x:40,y:24,z:1};let mode='edit';let stats=null;let editSnapshot=null;let lastDeleted=null;let currentLayout=null;let suppressClick=false;
  if(!await loadFlow())return;
  normalizeFlow();lastSnapshot=snapshot();loading.hidden=true;builder.hidden=false;
  mode=state.workflowId&&['active','paused'].includes(state.status)&&!createNew?'view':'edit';
  document.querySelector('#flow-name').value=state.name;renderAll();requestAnimationFrame(fitView);
  if(mode==='view')loadStats();

  document.querySelector('#flow-map').addEventListener('click',event=>{
    if(suppressClick){suppressClick=false;return}
    const removeEdge=event.target.closest('[data-remove-edge]');if(removeEdge){event.stopPropagation();disconnect(removeEdge.dataset.removeEdge);selectedEdge=null;markDirty();renderAll();return}
    const line=event.target.closest('[data-edge]');if(line&&mode==='edit'){event.stopPropagation();selectedEdge=line.dataset.edge;drawEdges();return}
    const tool=event.target.closest('[data-toolbar]');if(tool){event.stopPropagation();return tool.dataset.toolbar==='delete'?removeNode(state.selected,{announce:true}):duplicateNode(state.selected)}
    const connector=event.target.closest('[data-connect-kind]');
    if(connector&&mode==='view'){const node=connector.closest('[data-node-id]');if(node){state.selected=node.dataset.nodeId;renderAll()}return}
    if(connector){event.stopPropagation();const sourceId=connector.dataset.sourceId,kind=connector.dataset.connectKind,actionIndex=Number(connector.dataset.actionIndex??connector.dataset.branchIndex);const targetId=connectionTarget(sourceId,kind,actionIndex);if(targetId&&byId(targetId)){state.selected=targetId;renderAll();return}return openStepPicker(sourceId,kind,actionIndex,connector);}
    const first=event.target.closest('[data-first-step]');if(first){event.stopPropagation();return addNode(first.dataset.firstStep,{sourceId:'trigger',kind:'next'})}
    const template=event.target.closest('[data-first-template]');if(template){event.stopPropagation();const next=templateState(template.dataset.firstTemplate);state.nodes=next.nodes;state.trigger={...state.trigger,match:next.trigger.match,keywords:next.trigger.keywords,variations:next.trigger.variations};if(state.name==='Untitled automation'){state.name=next.name;document.querySelector('#flow-name').value=state.name}state.selected=null;markDirty();renderAll();requestAnimationFrame(fitView);return}
    const node=event.target.closest('[data-node-id]');if(node){state.selected=node.dataset.nodeId;renderAll();keepVisible(state.selected)}
  });
  document.querySelectorAll('[data-add-node]').forEach(button=>button.addEventListener('click',()=>{toggleAddPanel(false);addFromLibrary(button.dataset.addNode)}));

  document.querySelector('#add-step-fab').addEventListener('click',event=>{event.stopPropagation();toggleAddPanel()});
  document.addEventListener('click',event=>{if(!event.target.closest('#add-panel,#add-step-fab'))toggleAddPanel(false);if(!event.target.closest('#node-menu,[data-node-menu]'))document.querySelector('#node-menu').hidden=true});
  document.querySelector('#node-menu').addEventListener('click',event=>{const item=event.target.closest('[data-menu]');if(!item)return;const id=document.querySelector('#node-menu').dataset.nodeId;document.querySelector('#node-menu').hidden=true;if(item.dataset.menu==='delete')removeNode(id,{announce:true});else duplicateNode(id)});
  document.querySelector('#edit-flow').addEventListener('click',enterEdit);document.querySelector('#banner-edit').addEventListener('click',enterEdit);
  document.querySelector('#cancel-edit').addEventListener('click',discardEdit);
  document.querySelector('#bd-done').addEventListener('click',saveButtonDialog);
  document.querySelector('#bd-delete').addEventListener('click',()=>{const node=buttonEdit&&byId(buttonEdit.nodeId);if(node&&buttonEdit.index!==null){node.actions.splice(buttonEdit.index,1);markDirty()}document.querySelector('#button-dialog').close();buttonEdit=null;renderAll()});
  document.querySelector('#undo-flow')?.addEventListener('click',undo);document.querySelector('#redo-flow')?.addEventListener('click',redo);
  document.querySelector('#zoom-in').addEventListener('click',()=>zoomBy(1.2));document.querySelector('#zoom-out').addEventListener('click',()=>zoomBy(1/1.2));document.querySelector('#zoom-reset').addEventListener('click',()=>{camera.z=1;applyCamera()});
  document.addEventListener('keydown',onKeyDown);
  // Grammarly and similar extensions can swallow letters in languages they don't support (Armenian, Russian…),
  // so they are switched off in the builder's text boxes.
  const quietFields=root=>root.querySelectorAll?.('textarea,input[type=text],input:not([type])').forEach(field=>{if(field.dataset.gramm)return;field.setAttribute('data-gramm','false');field.setAttribute('data-gramm_editor','false');field.setAttribute('data-enable-grammarly','false')});
  quietFields(document);new MutationObserver(changes=>changes.forEach(change=>change.addedNodes.forEach(node=>{if(node.nodeType!==1)return;if(node.matches('textarea,input'))quietFields(node.parentNode);else quietFields(node)}))).observe(document.body,{childList:true,subtree:true});
  setupCanvasGestures();
  document.querySelectorAll('[data-pop-add-node]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const connection=pendingConnection;closeStepPicker();addNode(button.dataset.popAddNode,connection)}));
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#step-popover,[data-connect-kind]'))closeStepPicker()});
  document.querySelector('#flow-name').addEventListener('input',event=>{state.name=event.target.value.slice(0,200);markDirty()});
  document.querySelector('#rename-flow')?.addEventListener('click',()=>{const input=document.querySelector('#flow-name');if(input.readOnly)return;input.focus();input.select()});
  document.querySelector('#flow-name').addEventListener('keydown',event=>{if(event.key==='Enter')event.target.blur()});
  document.querySelector('#save-comment-draft').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Saving…';clearTimeout(saveTimer);const ok=await saveFlow(state.status==='paused'?'paused':'draft');button.textContent=ok?'Saved ✓':'Save';if(ok)window.HansoraUI.toast('Saved');setTimeout(()=>{button.textContent='Save';button.disabled=false},1600)});
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
    state.trigger.type=state.trigger.type||'comment';if(state.nodes.length)syncEntryFlags();
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
    const triggerLabel=document.querySelector('#flow-trigger-label');if(triggerLabel)triggerLabel.textContent=TRIGGERS[state.trigger.type||'comment']?.label||'Instagram';
  }

  function isCommentTrigger(){return['comment','live_comment'].includes(state.trigger.type||'comment')}
  function entryNode(){return state.nodes.find(node=>node.entry)||state.nodes.find(node=>node.type==='message'&&node.commentReply)||state.nodes.find(node=>node.type==='message')||state.nodes[0]||null}
  // After a comment Instagram allows one private message first; a DM automation's first step is a normal message.
  function syncEntryFlags(){const entry=entryNode();state.nodes.forEach(node=>{node.entry=node===entry;if(node.type==='message')node.commentReply=node===entry&&isCommentTrigger()})}
  // Every connection starts at a port (a dot on the right edge of a step's output) and ends at a step.
  function graphEdges(){
    const edges=[];const entry=entryNode();if(entry)edges.push({from:'trigger',to:entry.id,kind:'start'});
    state.nodes.forEach(node=>{
      if(node.type==='message'){
        (node.actions||[]).forEach((action,index)=>{if(action.type==='quick_reply'&&action.nextId)edges.push({from:node.id,to:action.nextId,kind:'action',index})});
        if(node.nextId)edges.push({from:node.id,to:node.nextId,kind:'next'});
        if(node.replyNextId)edges.push({from:node.id,to:node.replyNextId,kind:'reply'});
      }
      if(['delay','action','input'].includes(node.type)&&node.nextId)edges.push({from:node.id,to:node.nextId,kind:'next'});
      if(node.type==='condition'){if(node.yesId)edges.push({from:node.id,to:node.yesId,kind:'yes'});if(node.noId)edges.push({from:node.id,to:node.noId,kind:'no'})}
      if(node.type==='randomizer')(node.branches||[]).forEach((branch,index)=>{if(branch.nextId)edges.push({from:node.id,to:branch.nextId,kind:'branch',index})});
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
    const trigger={id:'trigger',type:'trigger',title:TRIGGERS[state.trigger.type||'comment']?.label||'Instagram comment',summary:triggerSummary()};
    nodesLayer.innerHTML=[canvasNode(trigger,layout.positions.get('trigger')),...state.nodes.map(node=>canvasNode(node,layout.positions.get(node.id)))].join('');
    currentLayout=layout;
    // Empty automation: ManyChat's "Choose first step" card next to the trigger. After a comment, Instagram only
    // allows a private message first, so that is the first step.
    if(!entryNode()&&mode==='edit'){const origin=layout.positions.get('trigger');const x=origin.x+370,y=origin.y;nodesLayer.insertAdjacentHTML('beforeend',`<div class="flow-first-step" style="left:${x}px;top:${y}px"><b>Choose first step 👇</b>${isCommentTrigger()?'<p>The first message they get is the private reply to their comment.</p>':''}<small class="first-group">Content</small>${firstStepButton('message','send','Instagram message','Text, buttons'+(isCommentTrigger()?'':', images and cards'))}${firstStepButton('input','edit','Collect info','Ask for email or phone')}<small class="first-group">AI</small>${firstStepButton('ai','sparkle','AI step','Your AI employee takes over')}<small class="first-group">Logic</small>${firstStepButton('action','spark','Actions','Tag, save a field, notify your team')}${firstStepButton('condition','branch','Condition','Tag? Saved field? Yes / No')}${firstStepButton('randomizer','refresh','Randomizer','A/B split')}${firstStepButton('delay','clock','Smart delay','Wait, then continue')}${isCommentTrigger()?`<small class="first-group">Template</small><button type="button" data-first-template="follow-link"><span class="flow-lib-icon condition">${window.HansoraUI.icon('branch')}</span><span><b>“Follow to get the link”</b><small>Message → follows you? → link</small></span></button>`:''}</div>`)}
    const selectedPos=layout.positions.get(state.selected);
    if(mode==='edit'&&selectedPos&&byId(state.selected))nodesLayer.insertAdjacentHTML('beforeend',`<div class="node-toolbar" style="left:${selectedPos.x+310}px;top:${selectedPos.y-8}px" role="toolbar" aria-label="Step actions"><button type="button" data-toolbar="duplicate" title="Duplicate" aria-label="Duplicate step">${window.HansoraUI.icon('copy')}</button><button type="button" data-toolbar="delete" class="danger" title="Delete" aria-label="Delete step">${window.HansoraUI.icon('trash')}</button></div>`);
    drawEdges();
    const steps=state.nodes.length+1,links=layout.edges.length;document.querySelector('#canvas-summary').textContent=`${steps} step${steps===1?'':'s'} · ${links} connection${links===1?'':'s'}`;
  }
  // ManyChat-style step card: content, then one row per output with a dot (port) on the right edge.
  function canvasNode(node,position){
    const selected=state.selected===node.id?' selected':'';const style=`left:${position.x}px;top:${position.y}px`;const labels={trigger:'Instagram trigger',message:node.commentReply?'Private reply':'Instagram message',condition:'Condition',delay:'Smart delay',ai:'AI assistant',handoff:'Human handoff',action:'Actions',input:'Collect info',randomizer:'Randomizer'};const icons={trigger:'instagram',message:'send',condition:'branch',delay:'clock',ai:'sparkle',handoff:'handoff',action:'spark',input:'edit',randomizer:'refresh'};
    const out=(kind,label,{index=null,tone='',sub=''}={})=>{const target=connectionTarget(node.id,kind,index);const hint=sub||(target?`→ ${targetName(target)}`:'');return`<div class="node-out ${tone}${target?' linked':''}"><span><b>${escapeHtml(label)}</b>${hint?`<small>${escapeHtml(hint)}</small>`:''}</span><button type="button" class="port" data-port data-source-id="${escapeAttribute(node.id)}" data-kind="${kind}"${index===null?'':` data-index="${index}"`} title="${target?'Drag to change where this goes':'Drag to a step, or click to add one'}" aria-label="Connect ${escapeAttribute(label)}"></button></div>`};
    let body='',outs='';
    if(node.type==='trigger'){body=`${postThumbs()}<p>${escapeHtml(node.summary)}</p><div class="flow-trigger-tags">${triggerChips().map(value=>`<span>${escapeHtml(value)}</span>`).join('')}</div>`;outs=out('start','Then',{tone:'muted'})}
    if(node.type==='message'){
      const s=nodeStats(node.id);const viewing=mode==='view'&&stats;
      body=`${(node.blocks||[]).length?`<div class="flow-trigger-tags block-chips">${node.blocks.map(block=>`<span>${escapeHtml(block.type==='cards'?`🗂 ${(block.cards||[]).length} card${(block.cards||[]).length===1?'':'s'}`:block.type==='typing'?`⌨ ${Number(block.seconds)||0}s`:BLOCK_LABELS[block.type]||block.type)}</span>`).join('')}</div>`:''}${node.followUp?.enabled&&!node.commentReply?'<span class="terminal-chip">↻ Follow-up if no tap</span>':''}<div class="message-bubble">${escapeHtml(node.text||'Write a message…')}</div>`;
      outs=(node.actions||[]).map((action,index)=>{const ctr=viewing?`CTR ${pct(s.clicks[action.type==='handoff'?'handoff':action.id]||0,s.sent)}`:'';if(action.type==='quick_reply')return out('action',action.label||'Untitled button',{index,sub:ctr});return`<div class="node-out ${action.type==='website'?'link':'team'}"><span><b>${escapeHtml(action.label||'Button')}</b><small>${escapeHtml(ctr||(action.type==='website'?'↗ Opens the website':'● Hands the chat to your team'))}</small></span></div>`}).join('');
      const conversational=(node.actions||[]).some(action=>['quick_reply','handoff'].includes(action.type));
      if(conversational||node.commentReply||node.replyNextId)outs+=out('reply','If they type instead',{tone:'muted'});
      if(!conversational&&!node.commentReply)outs+=out('next','Next step',{tone:'muted'});
    }
    if(node.type==='condition'){body=`<p class="condition-summary">${escapeHtml(nodeSummary(node))}</p>`;outs=out('yes','Yes',{tone:'yes',sub:connectionTarget(node.id,'yes')?'':'They match'})+out('no','No',{tone:'no',sub:connectionTarget(node.id,'no')?'':'They don’t match'})}
    if(node.type==='delay'){body=`<div class="delay-display"><b>${Number(node.amount||1)}</b><span>${escapeHtml(pluralUnit(node.unit,node.amount))}</span></div>`;outs=out('next','After the delay',{tone:'muted'})}
    if(node.type==='action'){body=`<ul class="node-lines">${(node.ops||[]).map(op=>`<li>${escapeHtml(opSummary(op))}</li>`).join('')||'<li class="muted">Add an action</li>'}</ul>`;outs=out('next','Next step',{tone:'muted'})}
    if(node.type==='input'){body=`<div class="message-bubble">${escapeHtml(node.text||'Ask a question…')}</div><span class="terminal-chip">Saves ${escapeHtml(INPUT_KINDS[node.kind]||'text')} → ${escapeHtml(node.saveTo||node.kind||'answer')}</span>`;outs=out('next','After a valid answer',{tone:'muted'})}
    if(node.type==='randomizer')outs=(node.branches||[]).map((branch,index)=>out('branch',`${branchLetter(index)} · ${Number(branch.percent)||0}%`,{index})).join('');
    if(node.type==='ai')body=`<p>${escapeHtml(node.instruction||'Answer with business knowledge.')}</p><span class="terminal-chip">AI continues the conversation</span>`;
    if(node.type==='handoff')body=`<p>${escapeHtml(node.note||'Pause AI and notify the team.')}</p><span class="terminal-chip">Conversation moves to Inbox</span>`;
    return`<article class="flow-node ${node.type}${selected}" style="${style}" data-node-id="${escapeAttribute(node.id)}" tabindex="0">${node.type==='trigger'?'':'<span class="node-in" aria-hidden="true"></span>'}<div class="flow-node-head"><span class="flow-node-icon">${window.HansoraUI.icon(icons[node.type])}</span><div><small>${labels[node.type]}</small><strong>${escapeHtml(node.title)}</strong></div></div>${statStrip(node)}${body?`<div class="flow-node-body">${body}</div>`:''}${outs?`<div class="node-outs">${outs}</div>`:''}</article>`;
  }
  function firstStepButton(type,icon,title,hint){return`<button type="button" data-first-step="${type}"><span class="flow-lib-icon ${type}">${window.HansoraUI.icon(icon)}</span><span><b>${title}</b><small>${hint}</small></span></button>`}
  function postThumbs(){if(state.trigger.scope!=='selected'||!state.trigger.postIds.length)return'';const previews=state.trigger.postPreviews||{};return`<div class="trigger-posts">${state.trigger.postIds.slice(0,4).map(id=>{const post=previews[id]||{};return post.thumb?`<img src="${escapeAttribute(post.thumb)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'Post'}))">`:'<span>Post</span>'}).join('')}${state.trigger.postIds.length>4?`<span>+${state.trigger.postIds.length-4}</span>`:''}</div>`}
  // Lines are drawn between the real dot positions, so they follow the cards when they move or grow.
  function edgeKey(edge){return`${edge.from}|${edge.kind}|${edge.index??''}`}
  function mapPoint(clientX,clientY){const m=document.querySelector('#flow-map').getBoundingClientRect();return{x:(clientX-m.left)/camera.z,y:(clientY-m.top)/camera.z}}
  function portEl(sourceId,kind,index){return[...document.querySelectorAll('#flow-nodes .port')].find(el=>el.dataset.sourceId===sourceId&&el.dataset.kind===kind&&String(el.dataset.index??'')===String(index??''))}
  function portCenter(sourceId,kind,index){const el=portEl(sourceId,kind,index);if(!el)return null;const r=el.getBoundingClientRect();return mapPoint(r.left+r.width/2,r.top+r.height/2)}
  function inPoint(id){const el=[...document.querySelectorAll('#flow-nodes .flow-node')].find(item=>item.dataset.nodeId===id);if(!el)return null;const r=el.getBoundingClientRect();return mapPoint(r.left,r.top+30*camera.z)}
  function curve(a,b){if(b.x>a.x+40){const c=Math.max(50,(b.x-a.x)*.45);return`M ${a.x} ${a.y} C ${a.x+c} ${a.y}, ${b.x-c} ${b.y}, ${b.x} ${b.y}`}const lift=Math.max(80,Math.abs(b.y-a.y)/2);return`M ${a.x} ${a.y} C ${a.x+120} ${a.y}, ${b.x-120} ${b.y+(b.y<a.y?lift:-lift)}, ${b.x} ${b.y}`}
  function edgeColor(kind){return kind==='yes'?'var(--green)':kind==='no'?'var(--red)':kind==='action'||kind==='branch'?'#b779ff':'var(--accent)'}
  function drawEdges(){
    const svg=document.querySelector('#flow-lines');if(!currentLayout||!svg)return;
    let html=currentLayout.edges.map(edge=>{const a=portCenter(edge.from,edge.kind,edge.index),b=inPoint(edge.to);if(!a||!b)return'';const d=curve(a,b),key=edgeKey(edge);return`<path class="edge${selectedEdge===key?' selected':''}" d="${d}" style="--edge:${edgeColor(edge.kind)}"/><path class="edge-hit" d="${d}" data-edge="${escapeAttribute(key)}"/><circle cx="${b.x}" cy="${b.y}" r="4" style="--edge:${edgeColor(edge.kind)}"/>`}).join('');
    if(!entryNode()&&mode==='edit'){const a=portCenter('trigger','start');const card=document.querySelector('.flow-first-step');if(a&&card){const r=card.getBoundingClientRect();const b=mapPoint(r.left,r.top+40*camera.z);html+=`<path class="flow-first-edge" d="${curve(a,b)}"/>`}}
    svg.innerHTML=html;
    document.querySelector('.edge-remove')?.remove();
    const chosen=selectedEdge&&currentLayout.edges.find(edge=>edgeKey(edge)===selectedEdge);
    if(chosen&&mode==='edit'){const a=portCenter(chosen.from,chosen.kind,chosen.index),b=inPoint(chosen.to);if(a&&b)document.querySelector('#flow-nodes').insertAdjacentHTML('beforeend',`<button type="button" class="edge-remove" data-remove-edge="${escapeAttribute(selectedEdge)}" style="left:${(a.x+b.x)/2}px;top:${(a.y+b.y)/2}px" title="Remove this connection" aria-label="Remove this connection">✕</button>`)}
  }
  function disconnect(key){const [from,kind,raw]=String(key).split('|');const index=raw===''?null:Number(raw);
    if(from==='trigger'){state.nodes.forEach(node=>{node.entry=false;if(node.type==='message')node.commentReply=false});return}
    const node=byId(from);if(!node)return;
    if(kind==='action'&&node.actions?.[index])node.actions[index].nextId=null;else if(kind==='branch'&&node.branches?.[index])node.branches[index].nextId=null;else if(kind==='reply')node.replyNextId=null;else if(kind==='yes')node.yesId=null;else if(kind==='no')node.noId=null;else node.nextId=null}
  function inspectorFooter(){if(mode!=='edit')return;inspector.insertAdjacentHTML('beforeend',`<div class="inspector-foot"><span id="inspector-saved">${escapeHtml(document.querySelector('#draft-state').textContent||'All changes saved')}</span><button class="ui-btn primary sm" type="button" data-close-inspector>Done</button></div>`);inspector.querySelectorAll('[data-close-inspector]').forEach(button=>button.addEventListener('click',()=>{state.selected=null;renderAll()}))}
  function renderInspector(){
    // Floating panel: open while a step is selected, gone when you click the empty canvas (like ManyChat).
    document.querySelector('#flow-inspector').classList.toggle('closed',!state.selected);
    document.querySelector('#comments-builder').classList.toggle('panel-open',Boolean(state.selected));
    if(!state.selected){inspector.hidden=true;emptyInspector.hidden=true;return}
    emptyInspector.hidden=true;inspector.hidden=false;
    if(mode==='view')return renderStatsInspector();
    if(state.selected==='trigger'){renderTriggerInspector();return inspectorFooter()}
    const node=state.nodes.find(item=>item.id===state.selected);if(!node){inspector.hidden=true;emptyInspector.hidden=false;return}
    if(node.type==='message')renderMessageInspector(node);else if(node.type==='condition')renderConditionInspector(node);else if(node.type==='delay')renderDelayInspector(node);else if(node.type==='ai')renderAiInspector(node);else if(node.type==='action')renderActionInspector(node);else if(node.type==='input')renderInputInspector(node);else if(node.type==='randomizer')renderRandomizerInspector(node);else renderHandoffInspector(node);
    inspectorFooter();
  }
  function inspectorHead(kicker,title){return`<div class="inspector-head"><div><p>${kicker}</p><h2>${escapeHtml(title)}</h2></div><button type="button" data-close-inspector aria-label="Close settings">×</button></div>`}
  // "When…": choose the trigger (like ManyChat's New Trigger list), then its settings.
  function renderTriggerInspector(){
    const type=state.trigger.type||'comment';
    const current=TRIGGERS[type]||TRIGGERS.comment;
    const chooser=!triggerListOpen?`<section class="inspector-section"><label>Start this automation when</label><div class="trigger-current"><span class="flow-lib-icon trigger">${window.HansoraUI.icon(current.icon)}</span><span><b>${current.label}</b><small>${current.hint}</small></span><button class="ui-btn ghost sm" type="button" id="change-trigger">Change</button></div></section>`:`<section class="inspector-section"><label>Start this automation when</label><div class="trigger-grid">${Object.entries(TRIGGERS).map(([key,item])=>`<button type="button" data-trigger-type="${key}" class="${key===type?'active':''}"><span class="flow-lib-icon trigger">${window.HansoraUI.icon(item.icon)}</span><span><b>${item.label}</b><small>${item.hint}</small></span></button>`).join('')}</div></section>`;
    if(type==='comment'){renderCommentTriggerSettings();inspector.querySelector('.inspector-head').insertAdjacentHTML('afterend',chooser);bindTriggerChooser();return}
    const words=`<section class="inspector-section"><label>${type==='dm_keyword'?'When the message':type==='story_reply'?'When the reply':'When the comment'}</label><select id="trigger-match">${type==='dm_keyword'?'':'<option value="any">Anything</option>'}<option value="contains">Contains a word or phrase</option><option value="exact">Is exactly</option></select><div class="inspector-field" id="keyword-wrap"><label>Words or phrases (one per line)</label><textarea id="trigger-keywords" rows="3" placeholder="price\nlink">${escapeHtml(state.trigger.keywords.join('\n'))}</textarea></div><div class="inspector-field"><label>Ignore when it contains</label><textarea id="trigger-exclude" rows="2" placeholder="spam">${escapeHtml(state.trigger.exclude.join('\n'))}</textarea></div></section>`;
    const extra={
      dm_keyword:words+'<section class="inspector-section"><p class="inspector-note">Runs instead of the AI for these messages. Button taps inside a running automation never start it.</p></section>',
      story_reply:words,
      live_comment:words+'<section class="inspector-section"><p class="inspector-note">During your Live, the commenter gets your first message privately.</p></section>',
      story_mention:'<section class="inspector-section"><p class="inspector-note">Starts when someone mentions your account in their story. Great for a “thanks for sharing” message with a reward.</p></section>',
      share:'<section class="inspector-section"><p class="inspector-note">Starts when someone sends one of your posts or reels (or any post) to your DMs.</p></section>',
      ref_link:`<section class="inspector-section"><div class="inspector-field"><label>Link code</label><input id="trigger-ref" value="${escapeAttribute(state.trigger.ref||'')}" maxlength="60" placeholder="summer"></div><p class="inspector-note">Share this link in your bio, stories or ads: <b>https://ig.me/m/YOUR_USERNAME?ref=${escapeHtml(state.trigger.ref||'code')}</b>. Whoever opens it starts this automation.</p></section>`,
      ice_breaker:`<section class="inspector-section"><div class="inspector-field"><label>Question people can tap</label><input id="trigger-question" value="${escapeAttribute(state.trigger.question||'')}" maxlength="80" placeholder="How do I order?"></div><p class="inspector-note">Shown to people who open a new chat with you (up to 4 live starters). It appears in Instagram after you set this automation live.</p></section>`,
      default_reply:'<section class="inspector-section"><p class="inspector-note">Runs when a message is not caught by any other automation, at most once per person every 24 hours. After that your AI employee answers as usual.</p></section>'
    }[type]||'';
    inspector.innerHTML=inspectorHead('TRIGGER',TRIGGERS[type]?.label||'Trigger')+chooser+extra;
    bindTriggerChooser();closeInspectorButton();
    const match=document.querySelector('#trigger-match');
    if(match){if(type==='dm_keyword'&&state.trigger.match==='any')state.trigger.match='contains';match.value=state.trigger.match;document.querySelector('#keyword-wrap').hidden=state.trigger.match==='any';match.addEventListener('change',()=>{state.trigger.match=match.value;markDirty();renderAll()});bindLines('#trigger-keywords',values=>state.trigger.keywords=values);bindLines('#trigger-exclude',values=>state.trigger.exclude=values)}
    bindText('#trigger-ref',value=>state.trigger.ref=value.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60));bindText('#trigger-question',value=>state.trigger.question=value.slice(0,80));
  }
  function bindTriggerChooser(){document.querySelector('#change-trigger')?.addEventListener('click',()=>{triggerListOpen=true;renderInspector()});document.querySelectorAll('[data-trigger-type]').forEach(button=>button.addEventListener('click',()=>{triggerListOpen=false;state.trigger.type=button.dataset.triggerType;if(state.trigger.type==='dm_keyword'&&state.trigger.match==='any')state.trigger.match='contains';syncEntryFlags();markDirty();renderAll()}))}
  function renderCommentTriggerSettings(){
    inspector.innerHTML=inspectorHead('STARTING STEP','Instagram comment trigger')+`<section class="inspector-section"><label>Run when someone comments on</label><div class="inspector-tabs" id="scope-tabs"><button data-value="all">All posts</button><button data-value="selected">Specific</button><button data-value="next">Next post</button></div><button class="post-pick${state.trigger.postIds.length?'':' empty'}" id="choose-posts" type="button" ${state.trigger.scope==='selected'?'':'hidden'}>${state.trigger.postIds.length?`<span class="inspector-posts">${postThumbs()}</span><span><b>${state.trigger.postIds.length} post${state.trigger.postIds.length===1?'':'s'} chosen</b><small>Click to change</small></span>`:`<span class="post-pick-icon">📷</span><span><b>Choose posts or reels</b><small>Pick which posts start this automation</small></span>`}</button></section><section class="inspector-section"><label>Comment rule</label><select id="trigger-match"><option value="any">Any comment</option><option value="contains">Contains a word or phrase</option><option value="exact">Exactly matches a phrase</option></select><div class="inspector-field" id="keyword-wrap"><label>Include words or phrases</label><textarea id="trigger-keywords" rows="3" placeholder="price, catalog, available">${escapeHtml(state.trigger.keywords.join('\n'))}</textarea></div><div class="inspector-field"><label>Exclude words or phrases</label><textarea id="trigger-exclude" rows="2" placeholder="spam, scam">${escapeHtml(state.trigger.exclude.join('\n'))}</textarea></div></section><section class="inspector-section"><div class="inspector-toggle"><span><b>Public reply</b><small>Rotate up to three replies naturally</small></span><input id="public-enabled" type="checkbox" ${state.trigger.publicEnabled?'checked':''}></div><div id="public-variations">${state.trigger.variations.map((value,index)=>variationHtml(value,index)).join('')}</div><button class="inspector-add" id="add-variation" type="button">+ Add reply variation</button></section><section class="inspector-section"><label class="inspector-toggle"><span><b>Only their first comment</b><small>If someone comments again on the same post, they don’t get the DM twice</small></span><input id="first-comment" type="checkbox" ${state.trigger.firstCommentOnly?'checked':''}></label><label class="inspector-toggle"><span><b>Ignore your own comments</b><small>Your replies under the post don’t start this automation</small></span><input id="ignore-own" type="checkbox" ${state.trigger.ignoreOwn?'checked':''}></label></section>`;
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
    inspector.innerHTML=inspectorHead(node.commentReply?'OPENING DM':'MESSAGE STEP',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="inspector-field"><label>Message text</label><textarea id="node-message" rows="6" placeholder="Write the message…">${escapeHtml(node.text||'')}</textarea></div>${node.commentReply?'<p class="inspector-note">Instagram allows only this one private reply until the customer replies or taps a conversational button.</p>':''}</section><section class="inspector-section"><div class="section-heading"><span><b>Buttons</b><small>Up to 3 inside this message</small></span><em>${(node.actions||[]).length}/3</em></div><div id="action-editors">${(node.actions||[]).map((action,index)=>actionHtml(node,action,index)).join('')}</div><button class="inspector-add" id="add-action" type="button">+ Add button</button></section>${node.commentReply?'<section class="inspector-section"><p class="inspector-note">This is the private reply to a comment: Instagram allows one text message with buttons here. Add images, cards and follow-ups in the next message.</p></section>':blocksEditorHtml(node)+followUpHtml(node)}<section class="inspector-section"><label>${node.commentReply?'If they type instead':'Automatic continuation'}</label>${node.commentReply?targetControl('reply-target',node.replyNextId,'End the flow'):targetControl('next-target',node.nextId,'End after this message')}<p class="inspector-note">${node.commentReply?'Typed replies can go directly to AI, a condition, or another message.':'Choose another message or a delay to continue without waiting for a tap.'}</p></section>`;
    bindText('#node-title',value=>node.title=value||'Instagram message');bindText('#node-message',value=>node.text=value);
    document.querySelector('#add-action').addEventListener('click',()=>{if((node.actions||[]).length>=3)return window.HansoraUI.toast('Instagram allows up to 3 buttons');openButtonDialog(node,null)});
    document.querySelector('#action-editors').addEventListener('input',event=>updateAction(node,event));document.querySelector('#action-editors').addEventListener('change',event=>updateAction(node,event));document.querySelector('#action-editors').addEventListener('click',event=>{const button=event.target.closest('[data-remove-action]');if(button){node.actions.splice(Number(button.dataset.removeAction),1);markDirty();renderAll();return}const connect=event.target.closest('[data-create-action-step]');if(connect)openStepPicker(node.id,'action',Number(connect.dataset.createActionStep));const edit=event.target.closest('[data-edit-button]');if(edit)openButtonDialog(node,Number(edit.dataset.editButton))});
    const target=document.querySelector(node.commentReply?'#reply-target':'#next-target');target.addEventListener('change',()=>{if(node.commentReply)node.replyNextId=target.value||null;else node.nextId=target.value||null;markDirty();renderCanvas()});bindRemoveNode(node);
    if(!node.commentReply){bindBlocksEditor(node);bindFollowUp(node)}
  }
  // Extra content sent before the text, in order (like ManyChat's content blocks).
  function blocksEditorHtml(node){
    const blocks=Array.isArray(node.blocks)?node.blocks:[];
    const blockHtml=(block,index)=>{let body='';
      if(['image','video','audio','file'].includes(block.type))body=`<input data-block-field="url" data-index="${index}" value="${escapeAttribute(block.url||'')}" placeholder="https://… (${({image:'jpg or png',video:'mp4',audio:'mp3 or m4a',file:'pdf'})[block.type]} link)">`;
      if(block.type==='dynamic')body=`<input data-block-field="url" data-index="${index}" value="${escapeAttribute(block.url||'')}" placeholder="https://your-server.com/hansora"><p class="rule-help">Hansora asks this address what to send, with the customer’s name, tags and saved fields. Answer with JSON like {"messages":[{"text":"Hi Ani!"},{"image":"https://…"}]}. Up to 5 messages.</p>`;
      if(block.type==='text')body=`<textarea data-block-field="text" data-index="${index}" rows="2" placeholder="Another message">${escapeHtml(block.text||'')}</textarea>`;
      if(block.type==='typing')body=`<div class="rule-row"><input type="number" min="1" max="10" data-block-field="seconds" data-index="${index}" value="${Number(block.seconds)||2}"><span>seconds of “typing…”</span></div>`;
      if(block.type==='cards')body=(block.cards||[]).map((card,cardIndex)=>`<div class="card-editor"><div class="rule-row"><b>Card ${cardIndex+1}</b>${(block.cards||[]).length>1?`<button type="button" data-remove-card="${index}:${cardIndex}" aria-label="Remove card">×</button>`:''}</div><input data-card-field="title" data-index="${index}" data-card="${cardIndex}" value="${escapeAttribute(card.title||'')}" placeholder="Title" maxlength="80"><input data-card-field="subtitle" data-index="${index}" data-card="${cardIndex}" value="${escapeAttribute(card.subtitle||'')}" placeholder="Subtitle (optional)" maxlength="80"><input data-card-field="image" data-index="${index}" data-card="${cardIndex}" value="${escapeAttribute(card.image||'')}" placeholder="Image link https://…"><div class="rule-row"><input data-card-field="label" data-index="${index}" data-card="${cardIndex}" value="${escapeAttribute(card.buttons?.[0]?.label||'')}" placeholder="Button text" maxlength="20"><input data-card-field="url" data-index="${index}" data-card="${cardIndex}" value="${escapeAttribute(card.buttons?.[0]?.url||'')}" placeholder="https://…"></div></div>`).join('')+((block.cards||[]).length<10?`<button class="inspector-add" type="button" data-add-card="${index}">+ Add card</button>`:'');
      return`<div class="rule-editor"><div class="rule-row"><b>${BLOCK_LABELS[block.type]||block.type}</b><button type="button" data-move-block="${index}:-1" aria-label="Move up" ${index?'':'disabled'}>↑</button><button type="button" data-remove-block="${index}" aria-label="Remove">×</button></div>${body}</div>`};
    return`<section class="inspector-section"><div class="section-heading"><span><b>Content before the text</b><small>Sent in this order, then the text and buttons</small></span></div><div id="block-editors">${blocks.map(blockHtml).join('')}</div><p class="bd-sub" style="margin-top:6px">Add one of the content blocks:</p><div class="content-grid">${[['text','Text','Another message before this one'],['image','Image','Boost engagement with visuals'],['file','PDF','Send a PDF file'],['typing','Delay','Wait a few seconds, showing “typing…”'],['input','Data Collection','Collect emails, phones and more']].map(([type,title,hint])=>`<button type="button" data-add-block="${type}"><b>${BLOCK_LABELS[type]?BLOCK_LABELS[type].split(' ')[0]:'📝'} ${title}</b><small>${hint}</small></button>`).join('')}<button type="button" id="more-blocks"><b>••• More</b><small>Audio, video, card, dynamic</small></button></div><div class="content-grid" id="more-block-list" hidden>${[['audio','Audio','Send a voice snippet'],['video','Video','Share a video'],['cards','Card','Images with buttons (up to 10)'],['dynamic','Dynamic','Content from your server']].map(([type,title,hint])=>`<button type="button" data-add-block="${type}"><b>${BLOCK_LABELS[type].split(' ')[0]} ${title}</b><small>${hint}</small></button>`).join('')}</div></section>`;
  }
  function bindBlocksEditor(node){
    const root=document.querySelector('#block-editors');if(!root)return;node.blocks=Array.isArray(node.blocks)?node.blocks:[];
    document.querySelector('#more-blocks')?.addEventListener('click',()=>{const list=document.querySelector('#more-block-list');list.hidden=!list.hidden});
    document.querySelectorAll('[data-add-block]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.addBlock==='input'){
      // Data Collection: a "Collect info" step right after this message (asks, checks the answer, saves it).
      const conversational=(node.actions||[]).some(action=>['quick_reply','handoff'].includes(action.type));
      if(conversational){addNode('input',null);window.HansoraUI.toast('Collect info step added — drag a button’s ● to it');return}
      return addNode('input',{sourceId:node.id,kind:'next'})}
      if(node.blocks.length>=10)return;const type=button.dataset.addBlock;node.blocks.push(type==='cards'?{type,cards:[{title:'',subtitle:'',image:'',buttons:[{label:'',url:''}]}]}:type==='typing'?{type,seconds:2}:{type,url:'',text:''});markDirty();renderAll()}));
    root.addEventListener('input',event=>{const index=Number(event.target.dataset.index);const block=node.blocks[index];if(!block)return;if(event.target.dataset.blockField){const field=event.target.dataset.blockField;block[field]=field==='seconds'?Math.max(1,Math.min(10,Number(event.target.value)||1)):event.target.value}if(event.target.dataset.cardField){const card=block.cards[Number(event.target.dataset.card)];const field=event.target.dataset.cardField;if(['label','url'].includes(field)){card.buttons=card.buttons?.length?card.buttons:[{label:'',url:''}];card.buttons[0][field]=event.target.value}else card[field]=event.target.value}markDirty();renderCanvas()});
    root.addEventListener('click',event=>{const remove=event.target.closest('[data-remove-block]'),move=event.target.closest('[data-move-block]'),addCard=event.target.closest('[data-add-card]'),removeCard=event.target.closest('[data-remove-card]');
      if(remove)node.blocks.splice(Number(remove.dataset.removeBlock),1);
      else if(move){const [from,delta]=move.dataset.moveBlock.split(':').map(Number);const to=from+delta;if(to>=0){const [item]=node.blocks.splice(from,1);node.blocks.splice(to,0,item)}}
      else if(addCard)node.blocks[Number(addCard.dataset.addCard)].cards.push({title:'',subtitle:'',image:'',buttons:[{label:'',url:''}]});
      else if(removeCard){const [block,card]=removeCard.dataset.removeCard.split(':').map(Number);node.blocks[block].cards.splice(card,1)}
      else return;markDirty();renderAll()});
  }
  function followUpHtml(node){const followUp=node.followUp||{};const hasButtons=(node.actions||[]).some(action=>['quick_reply','handoff'].includes(action.type));if(!hasButtons)return'';return`<section class="inspector-section"><label class="inspector-toggle"><span><b>Follow up if they don’t tap</b><small>Send a reminder with the same buttons</small></span><input id="followup-enabled" type="checkbox" ${followUp.enabled?'checked':''}></label><div id="followup-fields" ${followUp.enabled?'':'hidden'}><div class="delay-fields"><label>After<input id="followup-amount" type="number" min="1" max="59" value="${Number(followUp.amount)||1}"></label><label>Unit<select id="followup-unit"><option value="minute">Minutes</option><option value="hour">Hours</option></select></label></div><div class="inspector-field"><label>Reminder text</label><textarea id="followup-text" rows="2" placeholder="Still interested? Tap below 👇">${escapeHtml(followUp.text||'')}</textarea></div><p class="inspector-note">Instagram allows messages only within 24 hours of the person’s last message, so the longest wait is 23 hours.</p></div></section>`}
  function bindFollowUp(node){const toggle=document.querySelector('#followup-enabled');if(!toggle)return;node.followUp=node.followUp||{enabled:false,amount:1,unit:'hour',text:''};toggle.addEventListener('change',()=>{node.followUp.enabled=toggle.checked;markDirty();renderAll()});const unit=document.querySelector('#followup-unit');unit.value=node.followUp.unit||'hour';unit.addEventListener('change',()=>{node.followUp.unit=unit.value;markDirty()});document.querySelector('#followup-amount').addEventListener('input',event=>{node.followUp.amount=Math.max(1,Math.min(node.followUp.unit==='hour'?23:59,Number(event.target.value)||1));markDirty()});bindText('#followup-text',value=>node.followUp.text=value)}
  function actionHtml(node,action,index){
    const host=value=>{try{return new URL(value).hostname}catch(_){return''}};
    const destination=action.type==='website'?(action.url?`↗ Opens ${host(action.url)||'the website'}`:'↗ Add the website link'):action.type==='handoff'?'● Hands the chat to your team':action.nextId?`→ ${targetName(action.nextId)}`:'Choose what happens when pressed';
    return`<button type="button" class="button-row${action.type==='quick_reply'&&!action.nextId?' unset':''}" data-edit-button="${index}"><span><b>${escapeHtml(action.label||'Untitled button')}</b><small>${escapeHtml(destination)}</small></span><em>Edit</em></button>`;
  }
  // "Edit button" (like ManyChat): button text, then "When this button is pressed" — a new connected step of that
  // kind, a website, start another automation, talk to a person, or an existing step.
  const BUTTON_CHOICES=[['message','Instagram message','send','Send another message'],['ai','AI Step','sparkle','Your AI employee takes over'],['website','Open website','arrow','A link opens in the browser'],['action','Perform Actions','spark','Tag, save a field, notify your team'],['condition','Condition','branch','Yes / No paths'],['randomizer','Randomizer','refresh','A/B split'],['delay','Smart Delay','clock','Wait, then continue'],['input','Collect info','edit','Ask for email or phone'],['start_flow','Start another automation','chevron','Hand over to another automation'],['handoff','Talk to a person','handoff','Pause the AI and alert your team'],['existing','Go to an existing step','branch','Connect to a step you already have']];
  let buttonEdit=null;
  function openButtonDialog(node,index){
    const action=index===null?null:node.actions[index];
    buttonEdit={nodeId:node.id,index,label:action?.label||'',choice:action?(action.type==='website'?'website':action.type==='handoff'?'handoff':action.nextId?'keep':'message'):'message',url:action?.url||'',flowId:'',existingId:action?.nextId||''};
    renderButtonDialog();const dialog=document.querySelector('#button-dialog');if(!dialog.open)dialog.showModal();setTimeout(()=>document.querySelector('#bd-label')?.focus(),30);
  }
  function renderButtonDialog(){
    const edit=buttonEdit;if(!edit)return;const node=byId(edit.nodeId);if(!node)return;
    document.querySelector('#bd-title').textContent=edit.index===null?'New button':'Edit button';
    document.querySelector('#bd-delete').hidden=edit.index===null;
    const keep=edit.index!==null&&node.actions[edit.index]?.type==='quick_reply'&&node.actions[edit.index]?.nextId;
    const choices=[...(keep?[['keep',`Keep: ${targetName(node.actions[edit.index].nextId)}`,'check','Where it goes now']]:[]),...BUTTON_CHOICES];
    const flows=otherFlows.filter(flow=>flow.id!==state.workflowId);
    // Choices that need one more answer show it right under the clicked card, so it is never hidden below the fold.
    const detail=edit.choice==='website'?`<div class="bd-detail"><label class="bd-field">Website link<input id="bd-url" type="url" inputmode="url" value="${escapeAttribute(edit.url)}" placeholder="https://your-site.com"><small>Opens in the browser. Website buttons don’t open Instagram’s 24-hour reply window.</small></label><button class="ui-btn primary sm" type="button" data-bd-save>Save button</button></div>`
      :edit.choice==='start_flow'?`<div class="bd-detail">${flows.length?`<label class="bd-field">Automation to start<select id="bd-flow"><option value="">Choose an automation</option>${flows.map(flow=>`<option value="${escapeAttribute(flow.id)}" ${flow.id===edit.flowId?'selected':''}>${escapeHtml(flow.name)}${flow.status==='active'?'':' (not live)'}</option>`).join('')}</select><small>When pressed, this automation ends and the chosen one starts from its first step.</small></label><button class="ui-btn primary sm" type="button" data-bd-save>Save button</button>`:'<p class="bd-note">You don’t have another automation yet. Create one first, then come back to pick it here.</p>'}</div>`
      :edit.choice==='existing'?`<div class="bd-detail"><label class="bd-field">Step<select id="bd-existing">${targetOptions(edit.existingId,'Choose a step')}</select><small>The button jumps to a step that is already in this automation.</small></label><button class="ui-btn primary sm" type="button" data-bd-save>Save button</button></div>`:'';
    const activeIndex=choices.findIndex(([value])=>value===edit.choice);
    const twoColumns=!window.matchMedia('(max-width:600px)').matches;
    const insertAfter=activeIndex<0?-1:twoColumns?Math.min(activeIndex|1,choices.length-1):activeIndex;
    const cards=choices.map(([value,title,icon,hint],index)=>`<button type="button" data-bd-choice="${value}" class="${edit.choice===value?'active':''}"><span class="flow-lib-icon ${value==='keep'?'message':value}">${window.HansoraUI.icon(icon)}</span><span><b>${escapeHtml(title)}</b><small>${hint}</small></span></button>${index===insertAfter?detail:''}`).join('');
    document.querySelector('#bd-body').innerHTML=`<label class="bd-field">Button text<input id="bd-label" maxlength="20" value="${escapeAttribute(edit.label)}" placeholder="e.g. Send me the link"><small>${20-String(edit.label).length} characters left (Instagram allows 20)</small></label><p class="bd-sub">When this button is pressed</p><div class="bd-choices">${cards}</div>`;
    document.querySelector('#bd-label').addEventListener('input',event=>{edit.label=event.target.value.slice(0,20);event.target.classList.remove('invalid');event.target.nextElementSibling.textContent=`${20-edit.label.length} characters left (Instagram allows 20)`});
    document.querySelectorAll('[data-bd-choice]').forEach(button=>button.addEventListener('click',()=>{
      edit.choice=button.dataset.bdChoice;
      if(['website','start_flow','existing'].includes(edit.choice)){const scroll=document.querySelector('#bd-body').scrollTop;renderButtonDialog();const body=document.querySelector('#bd-body');body.scrollTop=scroll;const box=body.querySelector('.bd-detail');box?.scrollIntoView({block:'nearest',behavior:'smooth'});box?.querySelector('input,select')?.focus({preventScroll:true});return}
      saveButtonDialog();
    }));
    document.querySelector('[data-bd-save]')?.addEventListener('click',saveButtonDialog);
    document.querySelector('#bd-url')?.addEventListener('input',event=>{edit.url=event.target.value.trim()});
    document.querySelector('#bd-url')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();saveButtonDialog()}});
    document.querySelector('#bd-flow')?.addEventListener('change',event=>{edit.flowId=event.target.value});
    document.querySelector('#bd-existing')?.addEventListener('change',event=>{edit.existingId=event.target.value});
  }
  function saveButtonDialog(){
    const edit=buttonEdit;const node=edit&&byId(edit.nodeId);if(!node)return;
    const label=String(edit.label||'').trim();
    if(!label){const input=document.querySelector('#bd-label');input?.classList.add('invalid');input?.focus();document.querySelectorAll('[data-bd-choice]').forEach(button=>button.classList.toggle('active',button.dataset.bdChoice===edit.choice));return window.HansoraUI.toast('Type the button text first')}
    if(edit.choice==='website'&&edit.url&&!/^https?:\/\//i.test(edit.url))edit.url=`https://${edit.url}`;
    if(edit.choice==='website'&&!/^https:\/\/[^\s.]+\.[^\s]+$/i.test(edit.url||'')){document.querySelector('#bd-url')?.focus();return window.HansoraUI.toast('Add a website link, e.g. https://your-site.com')}
    if(edit.choice==='start_flow'&&!edit.flowId){document.querySelector('#bd-flow')?.focus();return window.HansoraUI.toast('Choose which automation to start')}
    if(edit.choice==='existing'&&!edit.existingId){document.querySelector('#bd-existing')?.focus();return window.HansoraUI.toast('Choose the step')}
    node.actions=node.actions||[];
    let index=edit.index;
    if(index===null){if(node.actions.length>=3)return window.HansoraUI.toast('Instagram allows up to 3 buttons');node.actions.push({id:uniqueId('action'),type:'quick_reply',label,nextId:null});index=node.actions.length-1}
    const action=node.actions[index];action.label=label;
    if(edit.choice==='website'){action.type='website';action.url=edit.url;action.nextId=null}
    else if(edit.choice==='handoff'){action.type='handoff';action.nextId=null;delete action.url}
    else if(edit.choice==='keep'){}
    else if(edit.choice==='existing'){action.type='quick_reply';action.nextId=edit.existingId;delete action.url}
    else{
      action.type='quick_reply';delete action.url;
      const type=edit.choice==='start_flow'?'action':edit.choice;
      const id=addNode(type,{sourceId:node.id,kind:'action',actionIndex:index},{select:false});
      if(edit.choice==='start_flow'){const created=byId(id);created.title='Start another automation';created.ops=[{type:'start_flow',value:edit.flowId}]}
    }
    document.querySelector('#button-dialog').close();buttonEdit=null;markDirty();renderAll();
  }
  function updateAction(node,event){const index=Number(event.target.dataset.index);const field=event.target.dataset.actionField;if(!Number.isInteger(index)||!field)return;node.actions[index][field]=event.target.value||null;if(field==='type'){node.actions[index].nextId=null;node.actions[index].url='';}markDirty();if(field==='type')renderInspector();renderCanvas()}
  // ManyChat-style condition: rules (follows you, follower count, tag, saved field, reply) with ALL / ANY.
  function renderConditionInspector(node){
    if(!Array.isArray(node.rules))node.rules=[{field:'reply',op:node.operator||'contains',value:node.value||''}]; // older condition, same meaning
    node.match=node.match==='any'?'any':'all';
    const ruleHtml=(rule,index)=>{const ops=RULE_OPS[rule.field]||RULE_OPS.reply;const needsValue=!['follows'].includes(rule.field)&&!['is_set','not_set','any'].includes(rule.op);return`<div class="rule-editor"><div class="rule-row"><select data-rule-field="field" data-index="${index}">${Object.entries(RULE_FIELDS).map(([value,label])=>`<option value="${value}" ${value===rule.field?'selected':''}>${label}</option>`).join('')}</select><button type="button" data-remove-rule="${index}" aria-label="Remove condition">×</button></div>${rule.field==='field'?`<input data-rule-field="key" data-index="${index}" value="${escapeAttribute(rule.key||'')}" placeholder="Field name, e.g. email">`:''}<select data-rule-field="op" data-index="${index}">${ops.map(([value,label])=>`<option value="${value}" ${value===rule.op?'selected':''}>${label}</option>`).join('')}</select>${needsValue?`<input data-rule-field="value" data-index="${index}" value="${escapeAttribute(rule.value??'')}" placeholder="${rule.field==='follower_count'?'1000':rule.field==='tag'?'Tag name':'Value'}" ${rule.field==='follower_count'?'inputmode="numeric"':''}>`:''}<p class="rule-help">${escapeHtml(RULE_HELP[rule.field]||'')}</p></div>`};
    const hasFollow=node.rules.some(rule=>rule.field==='follows');
    inspector.innerHTML=inspectorHead('CONDITION',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="section-heading"><span><b>Check</b><small>Each person goes down Yes or No</small></span></div>${node.rules.length>1?`<div class="inspector-tabs" id="rule-match"><button data-value="all" class="${node.match==='all'?'active':''}">Yes if ALL match</button><button data-value="any" class="${node.match==='any'?'active':''}">Yes if ANY matches</button></div>`:''}<div id="rule-editors">${node.rules.map(ruleHtml).join('')}</div><button class="inspector-add" id="add-rule" type="button">+ Add another check</button></section><section class="inspector-section"><label class="route-label yes">YES — they match, go to</label>${targetControl('condition-yes',node.yesId,'Nothing (the automation ends)')}<label class="route-label no">NO — they don’t match, go to</label>${targetControl('condition-no',node.noId,'Nothing (the automation ends)')}<p class="inspector-note">You can also drag from the ● next to Yes or No on the canvas to any step.</p>${hasFollow?`<div class="inspector-field"><label>If they keep getting “No”</label><select id="condition-pass"><option value="0">Keep asking every time</option><option value="2">Send them down Yes after 2 tries</option><option value="3">Send them down Yes after 3 tries</option><option value="5">Send them down Yes after 5 tries</option></select><p class="inspector-note">Useful for “follow to get the link”: if Instagram is slow to show the follow, the person still gets the link after a few tries instead of getting stuck.</p></div>`:''}</section>`;
    bindText('#node-title',value=>{node.title=value||'Condition';node.autoTitle=false});
    const retitle=()=>{if(node.autoTitle){node.title=autoConditionTitle(node);const input=document.querySelector('#node-title');if(input&&document.activeElement!==input)input.value=node.title}};
    document.querySelectorAll('#rule-match button').forEach(button=>button.addEventListener('click',()=>{node.match=button.dataset.value;markDirty();renderAll()}));
    const editors=document.querySelector('#rule-editors');
    editors.addEventListener('change',event=>{const index=Number(event.target.dataset.index),field=event.target.dataset.ruleField;if(!field)return;const rule=node.rules[index];rule[field]=event.target.value;if(field==='field'){rule.op=RULE_OPS[rule.field][0][0];rule.value='';delete rule.key}retitle();markDirty();renderAll()});
    editors.addEventListener('input',event=>{const index=Number(event.target.dataset.index),field=event.target.dataset.ruleField;if(!['value','key'].includes(field))return;node.rules[index][field]=event.target.value;retitle();markDirty();renderCanvas()});
    editors.addEventListener('click',event=>{const button=event.target.closest('[data-remove-rule]');if(!button)return;node.rules.splice(Number(button.dataset.removeRule),1);if(!node.rules.length)node.rules.push({field:'follows',op:'is_true'});markDirty();renderAll()});
    document.querySelector('#add-rule').addEventListener('click',()=>{if(node.rules.length<5)node.rules.push({field:'tag',op:'has',value:''});markDirty();renderAll()});
    const pass=document.querySelector('#condition-pass');if(pass){pass.value=String(node.passAfter||0);pass.addEventListener('change',()=>{node.passAfter=Number(pass.value)||0;markDirty();renderCanvas()})}
    bindTarget('#condition-yes',value=>node.yesId=value);bindTarget('#condition-no',value=>node.noId=value);bindRemoveNode(node)}
  function renderActionInspector(node){
    const opHtml=(op,index)=>`<div class="rule-editor"><div class="rule-row"><select data-op-field="type" data-index="${index}">${Object.entries(OP_TYPES).map(([value,label])=>`<option value="${value}" ${value===op.type?'selected':''}>${label}</option>`).join('')}</select><button type="button" data-remove-op="${index}" aria-label="Remove action">×</button></div>${['set_field','clear_field'].includes(op.type)?`<input data-op-field="key" data-index="${index}" value="${escapeAttribute(op.key||'')}" placeholder="Field name, e.g. interest">`:''}${['add_tag','remove_tag'].includes(op.type)?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="Tag name, e.g. Lead">`:''}${op.type==='set_field'?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="Value">`:''}${op.type==='notify'?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="Message for your team">`:''}${op.type==='assign'?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="Team member name, e.g. Anna"><p class="inspector-note">The AI stops, the chat moves to “Your team” with this name, and you get an alert.</p>`:''}${op.type==='start_flow'?`<select data-op-field="value" data-index="${index}"><option value="">Choose an automation</option>${otherFlows.filter(flow=>flow.id!==state.workflowId).map(flow=>`<option value="${escapeAttribute(flow.id)}" ${flow.id===op.value?'selected':''}>${escapeHtml(flow.name)}${flow.status==='active'?'':' (not live)'}</option>`).join('')}</select><p class="inspector-note">This automation ends and the chosen one starts for the same person. It must be live.</p>`:''}${op.type==='webhook'?`<input data-op-field="value" data-index="${index}" value="${escapeAttribute(op.value||'')}" placeholder="https://hooks.zapier.com/…"><p class="inspector-note">Sends the customer’s name, contact details, tags and saved fields to this https address (Zapier, Make, your CRM).</p>`:''}</div>`;
    inspector.innerHTML=inspectorHead('ACTIONS',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="section-heading"><span><b>Actions</b><small>Run instantly, the customer sees nothing</small></span></div><div id="op-editors">${(node.ops||[]).map(opHtml).join('')}</div><button class="inspector-add" id="add-op" type="button">+ Add action</button><p class="inspector-note">Tags and saved fields stay on the customer: use them in conditions and they appear in the Inbox.</p></section><section class="inspector-section"><label>Next step</label>${targetControl('op-next',node.nextId,'End the flow')}</section>`;
    bindText('#node-title',value=>node.title=value||'Actions');
    const editors=document.querySelector('#op-editors');
    editors.addEventListener('change',event=>{const field=event.target.dataset.opField;if(field==='value'&&event.target.tagName==='SELECT'){node.ops[Number(event.target.dataset.index)].value=event.target.value;markDirty();renderCanvas();return}if(field!=='type')return;node.ops[Number(event.target.dataset.index)]={type:event.target.value};markDirty();renderAll()});
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
  function renderDelayInspector(node){inspector.innerHTML=inspectorHead('SMART DELAY',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="delay-fields"><label>Wait<input id="delay-amount" type="number" min="1" max="${node.unit==='second'?50:30}" value="${Number(node.amount||1)}"></label><label>Unit<select id="delay-unit"><option value="second">Seconds</option><option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option></select></label></div></section><section class="inspector-section"><label>After the delay</label>${targetControl('delay-next',node.nextId,'Choose a step')}<button class="inspector-add" id="create-delay-step" type="button">+ Create connected step</button></section>`;bindText('#node-title',value=>node.title=value||'Smart delay');document.querySelector('#delay-amount').addEventListener('input',event=>{node.amount=Math.max(1,Number(event.target.value)||1);markDirty();renderCanvas()});const unit=document.querySelector('#delay-unit');unit.value=node.unit||'minute';unit.addEventListener('change',()=>{node.unit=unit.value;markDirty();renderCanvas()});bindTarget('#delay-next',value=>node.nextId=value);document.querySelector('#create-delay-step').addEventListener('click',()=>openStepPicker(node.id,'next'));bindRemoveNode(node)}
  function renderAiInspector(node){inspector.innerHTML=inspectorHead('AI ASSISTANT',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="inspector-field"><label>Instruction at this point</label><textarea id="ai-instruction" rows="6">${escapeHtml(node.instruction||'')}</textarea></div><label class="inspector-toggle"><span><b>Handoff when uncertain</b><small>Pause AI instead of inventing an answer</small></span><input id="ai-handoff" type="checkbox" ${node.handoff?'checked':''}></label></section><section class="inspector-section"><p class="inspector-note">The assistant continues naturally using the saved business knowledge, tools, orders, and calendar.</p></section>`;bindText('#node-title',value=>node.title=value||'AI assistant');bindText('#ai-instruction',value=>node.instruction=value);bindCheck('#ai-handoff',value=>node.handoff=value);bindRemoveNode(node)}
  function renderHandoffInspector(node){inspector.innerHTML=inspectorHead('HUMAN HANDOFF',node.title,node)+`<section class="inspector-section"><div class="inspector-field"><label>Step name</label><input id="node-title" value="${escapeAttribute(node.title)}" maxlength="80"></div><div class="inspector-field"><label>Internal note</label><textarea id="handoff-note" rows="4">${escapeHtml(node.note||'A customer needs a person.')}</textarea></div></section><section class="inspector-section"><p class="inspector-note">AI pauses, the conversation is marked “Needs attention,” and your configured owner notification is sent.</p></section>`;bindText('#node-title',value=>node.title=value||'Human handoff');bindText('#handoff-note',value=>node.note=value);bindRemoveNode(node)}

  function targetControl(id,value,emptyLabel){return`<select id="${id}">${targetOptions(value,emptyLabel)}</select>`}
  function targetOptions(value,emptyLabel){return`<option value="">${escapeHtml(emptyLabel)}</option>${state.nodes.map(node=>`<option value="${escapeAttribute(node.id)}" ${node.id===value?'selected':''}>${escapeHtml(node.title)} · ${escapeHtml(stepTitle(node.type))}</option>`).join('')}`}
  function bindTarget(selector,apply){document.querySelector(selector).addEventListener('change',event=>{apply(event.target.value||null);markDirty();renderCanvas()})}
  function bindRemoveNode(){closeInspectorButton()}
  function closeInspectorButton(){document.querySelector('[data-close-inspector]')?.addEventListener('click',()=>{state.selected=null;renderAll()})}
  function removeNode(id,{announce=false}={}){if(mode!=='edit')return;commitHistory();if(announce)window.HansoraUI.toast('Step deleted · press ⌘Z / Ctrl+Z to undo');state.nodes=state.nodes.filter(node=>node.id!==id);state.nodes.forEach(node=>{if(node.nextId===id)node.nextId=null;if(node.replyNextId===id)node.replyNextId=null;if(node.yesId===id)node.yesId=null;if(node.noId===id)node.noId=null;(node.actions||[]).forEach(action=>{if(action.nextId===id)action.nextId=null});(node.branches||[]).forEach(branch=>{if(branch.nextId===id)branch.nextId=null})});state.selected=null;markDirty();renderAll()}
  // ManyChat-style: the step menu opens right next to the "+" that was clicked, and closes on any outside click.
  function openStepPicker(sourceId,kind,actionIndex,anchor,dropPoint=null){
    pendingConnection={sourceId,kind,actionIndex:Number.isInteger(actionIndex)?actionIndex:null,pos:dropPoint};
    const pop=document.querySelector('#step-popover');const canvas=document.querySelector('#flow-canvas').getBoundingClientRect();const rect=(anchor||document.querySelector('#add-step-fab')).getBoundingClientRect();
    pop.querySelectorAll('[data-pop-add-node]').forEach(button=>{button.hidden=false});
    pop.hidden=false;const width=300,height=pop.offsetHeight||420;
    pop.style.left=`${Math.max(8,Math.min(canvas.width-width-8,rect.right-canvas.left+10))}px`;pop.style.top=`${Math.max(8,Math.min(canvas.height-height-8,rect.top-canvas.top-20))}px`;
  }
  function closeStepPicker(){const pop=document.querySelector('#step-popover');if(pop)pop.hidden=true;pendingConnection=null}
  function connectionTarget(sourceId,kind,actionIndex){if(sourceId==='trigger')return entryNode()?.id||null;const source=byId(sourceId);if(!source)return null;if(kind==='action')return source.actions?.[actionIndex]?.nextId||null;if(kind==='reply')return source.replyNextId||null;if(kind==='yes')return source.yesId||null;if(kind==='no')return source.noId||null;if(kind==='branch')return source.branches?.[actionIndex]?.nextId||null;return source.nextId||null}
  function addFromLibrary(type){const sourceId=state.selected==='trigger'?'trigger':state.selected;let kind='next';const source=state.nodes.find(node=>node.id===sourceId);if(source?.type==='condition')kind=source.yesId?'no':'yes';addNode(type,{sourceId,kind})}
  function addNode(type,connection,{select=true}={}){
    const id=uniqueId(type);const node={id,type,title:stepTitle(type)};
    if(type==='message')Object.assign(node,{text:'Write your message here.',actions:[],nextId:null,replyNextId:null});if(type==='condition')Object.assign(node,{operator:'contains',value:'',yesId:null,noId:null});if(type==='delay')Object.assign(node,{amount:1,unit:'minute',nextId:null});if(type==='ai')Object.assign(node,{instruction:'Continue using the saved business knowledge.',handoff:true});if(type==='handoff')node.note='Pause AI and notify the team.';
    if(type==='condition')Object.assign(node,{title:'Follows you?',autoTitle:true,match:'all',rules:[{field:'follows',op:'is_true'}],passAfter:0});
    if(type==='action')Object.assign(node,{ops:[{type:'add_tag',value:''}],nextId:null});
    if(type==='input')Object.assign(node,{text:'What is your email?',kind:'email',saveTo:'email',retryText:'That doesn’t look like an email. Please try again.',nextId:null});
    if(type==='randomizer')Object.assign(node,{branches:[{id:uniqueId('branch'),percent:50,nextId:null},{id:uniqueId('branch'),percent:50,nextId:null}]});
    const sourcePos=connection&&currentLayout?.positions.get(connection.sourceId);if(connection?.pos)node.pos=connection.pos;else if(sourcePos)node.pos=freeSpot(sourcePos.x+370,sourcePos.y);
    state.nodes.push(node);attachConnection(connection,id);pendingConnection=null;if(select){state.selected=id;markDirty();renderAll();requestAnimationFrame(()=>centerOn(id))}return id;
  }
  function attachConnection(connection,targetId){
    if(!connection)return;const source=state.nodes.find(node=>node.id===connection.sourceId);
    if(connection.sourceId==='trigger'){const target=state.nodes.find(node=>node.id===targetId);if(target){state.nodes.forEach(node=>{node.entry=node===target});syncEntryFlags()}return}
    if(!source)return;if(connection.kind==='action'&&source.actions?.[connection.actionIndex])source.actions[connection.actionIndex].nextId=targetId;else if(connection.kind==='reply')source.replyNextId=targetId;else if(connection.kind==='yes')source.yesId=targetId;else if(connection.kind==='no')source.noId=targetId;else if(connection.kind==='branch'&&source.branches?.[connection.actionIndex])source.branches[connection.actionIndex].nextId=targetId;else source.nextId=targetId;
  }

  async function openPostPicker(){
    const dialog=document.querySelector('#post-picker-dialog');const grid=document.querySelector('#post-picker-grid');grid.innerHTML='<p class="ui-empty">Loading your posts…</p>';dialog.showModal();
    try{if(api.isLocalPreview)posts=[1,2,3,4,5,6].map(index=>({id:`post-${index}`,caption:`Instagram post ${index}`,thumbnail_url:`data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='hsl(${index*55},55%,45%)'/><text x='60' y='68' font-size='26' text-anchor='middle' fill='white' font-family='sans-serif'>${index}</text></svg>`)}`}));else{const response=await api.authenticatedFetch('/.netlify/functions/automation-instagram-media',{method:'POST',body:JSON.stringify({business_id:businessId})});const result=await response.json();if(!response.ok)throw new Error(result.error||'instagram_media_unavailable');posts=result.media||[]}grid.innerHTML=posts.length?posts.map(post=>`<label>${post.thumbnail_url||post.media_url?`<img src="${escapeAttribute(post.thumbnail_url||post.media_url)}" alt="" class="post-thumb">`:''}<input type="checkbox" value="${escapeAttribute(post.id)}" ${state.trigger.postIds.includes(post.id)?'checked':''}><span>${escapeHtml((post.caption||'Post or reel').slice(0,55))}</span></label>`).join(''):'<p class="ui-empty">No posts or reels found.</p>'}catch(error){grid.innerHTML=`<p class="ui-alert">${escapeHtml(api.displayError(error))}</p>`}
  }
  function showPreview(){
    const thread=document.querySelector('#flow-preview-thread');const comment=state.trigger.match==='exact'&&state.trigger.keywords[0]?state.trigger.keywords[0]:state.trigger.match==='contains'&&state.trigger.keywords[0]?`Can I get the ${state.trigger.keywords[0]}?`:'How much is this?';const rows=[`<div class="customer">${escapeHtml(comment)}</div>`];if(state.trigger.publicEnabled&&state.trigger.variations[0])rows.push(`<div>${escapeHtml(state.trigger.variations[0])}</div>`);
    let node=entryNode(),guard=0;while(node&&guard++<12){if(node.type==='message'){(node.blocks||[]).forEach(block=>{if(block.type==='image'&&block.url)rows.push(`<div class="preview-media"><img src="${escapeAttribute(block.url)}" alt=""></div>`);else if(block.type==='typing')rows.push('<p class="preview-system">typing…</p>');else if(block.type==='text')rows.push(`<div>${escapeHtml(block.text||'')}</div>`);else if(block.type==='cards')rows.push(`<div class="preview-cards">${(block.cards||[]).map(card=>`<span>${card.image?`<img src="${escapeAttribute(card.image)}" alt="">`:''}<b>${escapeHtml(card.title||'')}</b>${card.buttons?.[0]?.label?`<button>${escapeHtml(card.buttons[0].label)} ↗</button>`:''}</span>`).join('')}</div>`);else if(block.type==='video')rows.push('<p class="preview-system">🎬 Video</p>')});rows.push(`<div>${escapeHtml(node.text||'')} ${(node.actions||[]).map(action=>`<button>${escapeHtml(action.label)} ${action.type==='website'?'↗':''}</button>`).join('')}</div>`);const action=(node.actions||[]).find(item=>item.type==='quick_reply'&&item.nextId);node=byId(action?.nextId||node.nextId||node.replyNextId);}else if(node.type==='delay'){rows.push(`<p class="preview-system">Wait ${Number(node.amount||1)} ${escapeHtml(pluralUnit(node.unit,node.amount))}</p>`);node=byId(node.nextId);}else if(node.type==='condition'){rows.push(`<p class="preview-system">Check: ${escapeHtml(nodeSummary(node))} → Yes</p>`);node=byId(node.yesId||node.noId);}else if(node.type==='action'){rows.push(`<p class="preview-system">${escapeHtml((node.ops||[]).map(opSummary).join(' · ')||'Actions')}</p>`);node=byId(node.nextId);}else if(node.type==='input'){rows.push(`<div>${escapeHtml(node.text||'')}</div><div class="customer">${node.kind==='email'?'ani@example.com':node.kind==='phone'?'+374 99 123456':node.kind==='number'?'3':'My answer'}</div>`);node=byId(node.nextId);}else if(node.type==='randomizer'){rows.push('<p class="preview-system">Randomizer picks a path</p>');node=byId(node.branches?.[0]?.nextId);}else if(node.type==='ai'){rows.push('<div>AI assistant continues with your business knowledge.</div>');node=null;}else if(node.type==='handoff'){rows.push('<p class="preview-system">Conversation handed to your team</p>');node=null;}else node=null;}
    thread.innerHTML=rows.join('');document.querySelector('#flow-preview-dialog').showModal();
  }
  async function loadOtherFlows(){
    try{if(api.isLocalPreview){otherFlows=(JSON.parse(localStorage.getItem(previewStoreKey)||'[]')||[]).map(flow=>({id:flow.workflowId,name:flow.name,status:flow.status}));return}
      const result=await api.db.from('automation_comment_workflows').select('id,name,status').eq('business_id',businessId).neq('status','archived').order('updated_at',{ascending:false});otherFlows=result.data||[]}catch(_){otherFlows=[]}
  }
  async function loadFlow(){
    loadOtherFlows();
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
  function stateFromRow(row){return{workflowId:row.id,folder:row.safety_config?.folder||'',name:row.name,status:row.status,selected:null,createdAt:row.created_at,updatedAt:row.updated_at,metrics:{runs:Number(row.triggered_count||0)},trigger:{type:row.safety_config?.trigger_type||'comment',ref:row.safety_config?.trigger?.ref||'',question:row.safety_config?.trigger?.question||'',scope:row.post_scope,postIds:row.selected_post_ids||[],postPreviews:row.safety_config?.post_previews||{},match:row.match_type,keywords:row.keywords||[],exclude:row.safety_config?.exclude_keywords||[],publicEnabled:row.safety_config?.public_reply_enabled!==false,variations:row.public_reply_variations||[],firstCommentOnly:row.safety_config?.first_comment_only!==false,ignoreOwn:row.safety_config?.ignore_own!==false},triggerPos:row.safety_config?.layout?.trigger||null,nodes:Array.isArray(row.dm_steps)?row.dm_steps:structuredClone(defaults.nodes)}}
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
    if(!validateFlow(status==='active'))return false;state.status=status;state.name=document.querySelector('#flow-name').value.trim()||'Comment to DM';const commentType=state.trigger.type==='comment';const keywordType=['comment','live_comment','dm_keyword','story_reply'].includes(state.trigger.type);const payload={business_id:businessId,name:state.name,status,post_scope:commentType?state.trigger.scope:'all',selected_post_ids:commentType?state.trigger.postIds:[],match_type:keywordType?state.trigger.match:'any',keywords:keywordType?state.trigger.keywords:[],public_reply_variations:commentType&&state.trigger.publicEnabled?state.trigger.variations.filter(value=>value.trim()).slice(0,3):[],dm_steps:state.nodes,safety_config:{exclude_keywords:state.trigger.exclude,public_reply_enabled:state.trigger.publicEnabled,first_comment_only:state.trigger.firstCommentOnly,ignore_own:state.trigger.ignoreOwn,flow_version:3,trigger_type:state.trigger.type||'comment',trigger:{ref:String(state.trigger.ref||'').trim().slice(0,60),question:String(state.trigger.question||'').trim().slice(0,80)},folder:state.folder||'',post_previews:state.trigger.scope==='selected'?(state.trigger.postPreviews||{}):{},layout:state.triggerPos?{trigger:state.triggerPos}:{}},...(status==='active'?{activated_at:new Date().toISOString()}:{})};
    try{if(api.isLocalPreview){const now=new Date().toISOString();state.workflowId=state.workflowId||`preview-${Date.now()}`;state.createdAt=state.createdAt||now;state.updatedAt=now;state.metrics=state.metrics||{runs:0,dms:0,engaged:0,failed:0};let flows=[];try{flows=JSON.parse(localStorage.getItem(previewStoreKey)||'[]')}catch(_){}if(!Array.isArray(flows))flows=[];const index=flows.findIndex(flow=>flow.workflowId===state.workflowId);const saved=structuredClone(state);if(index>=0)flows[index]=saved;else flows.unshift(saved);localStorage.setItem(previewStoreKey,JSON.stringify(flows));localStorage.setItem('hansora_comment_flow_preview',JSON.stringify(state));syncWorkflowUrl()}else if(state.workflowId){const result=await api.db.from('automation_comment_workflows').update(payload).eq('id',state.workflowId).eq('business_id',businessId).select('id').single();if(result.error)throw result.error}else{const result=await api.db.from('automation_comment_workflows').insert(payload).select('id').single();if(result.error)throw result.error;state.workflowId=result.data.id;syncWorkflowUrl()}setSaved();renderStatus();return true}catch(error){showError(api.displayError(error));return false}
  }
  function syncWorkflowUrl(){if(!state.workflowId)return;const url=new URL(location.href);url.searchParams.set('workflow',state.workflowId);url.searchParams.delete('new');url.searchParams.delete('template');history.replaceState({},'',url)}
  async function activateFlow(){if(!validateFlow(true))return;if(!api.isLocalPreview){const connection=await api.db.from('automation_channel_connections').select('status').eq('business_id',businessId).eq('channel_type','instagram_comments').maybeSingle();if(connection.error)return showError(api.displayError(connection.error));if(!connection.data||!['connecting','connected'].includes(connection.data.status))return showError('Connect your Instagram account before setting this flow live.')}if(!await saveFlow('active'))return;if(!api.isLocalPreview){const result=await api.db.from('automation_channel_connections').update({status:'connected'}).eq('business_id',businessId).eq('channel_type','instagram_comments');if(result.error)return showError(api.displayError(result.error))}state.status='active';editSnapshot=null;mode='view';state.selected=null;setSaved('Flow is live');renderAll();
    if(!api.isLocalPreview)api.authenticatedFetch('/.netlify/functions/automation-instagram-sync',{method:'POST',body:JSON.stringify({business_id:businessId,trigger_type:state.trigger.type})}).then(response=>response.json()).then(result=>{if(result.conversation_starters_error&&state.trigger.type==='ice_breaker')showError(`Instagram did not accept the conversation starter: ${result.conversation_starters_error}`)}).catch(()=>null);loadStats();window.HansoraUI.toast('Your comment automation is live')}
  function validateFlow(forActivation){
    const type=state.trigger.type||'comment';const usesWords=['comment','live_comment','dm_keyword','story_reply'].includes(type);
    if(forActivation&&type==='comment'&&state.trigger.scope==='selected'&&!state.trigger.postIds.length)return validationError('Choose at least one Instagram post or reel.');
    if(forActivation&&usesWords&&(state.trigger.match!=='any'||type==='dm_keyword')&&!state.trigger.keywords.length)return validationError('Add at least one word or phrase to the trigger.');
    if(forActivation&&type==='ref_link'&&!String(state.trigger.ref||'').trim())return validationError('Add a link code for the ig.me link.');
    if(forActivation&&type==='ice_breaker'&&!String(state.trigger.question||'').trim())return validationError('Write the conversation starter question.');
    const opening=entryNode();if(forActivation&&!opening)return validationError('Add the first step before setting the automation live.');
    if(forActivation&&isCommentTrigger()&&opening.type==='message'&&!String(opening.text||'').trim())return validationError('Write the first message (the private reply to the comment).');
    if(forActivation&&type==='comment'&&opening.type==='message'&&!((opening.actions||[]).some(action=>['quick_reply','handoff'].includes(action.type))||opening.replyNextId))return validationError('The first DM needs a button (like “Send me the link”) or a route for typed replies — Instagram allows no more messages until they tap or reply.');for(const node of state.nodes){for(const action of node.actions||[]){if(action.type==='quick_reply'&&!action.nextId)return validationError(`Choose what happens after “${action.label||'Untitled button'}”.`);if(action.type==='website'&&!/^https:\/\//i.test(String(action.url||'')))return validationError(`Add a secure https:// link for “${action.label||'Website button'}”.`);}
      if(!forActivation)continue;
      if(node.type==='condition'&&Array.isArray(node.rules)){for(const rule of node.rules){if(['tag','follower_count'].includes(rule.field)&&!String(rule.value??'').trim())return validationError(`“${node.title}”: fill in the ${rule.field==='tag'?'tag name':'follower number'}.`);if(rule.field==='field'&&!String(rule.key||'').trim())return validationError(`“${node.title}”: choose which saved field to check.`);if(rule.field==='reply'&&rule.op!=='any'&&!String(rule.value||'').trim())return validationError(`“${node.title}”: add the words to look for in the reply.`)}}
      if(node.type==='action'){if(!(node.ops||[]).length)return validationError(`“${node.title}”: add at least one action.`);for(const op of node.ops){if(['add_tag','remove_tag'].includes(op.type)&&!String(op.value||'').trim())return validationError(`“${node.title}”: fill in the tag name.`);if(['set_field','clear_field'].includes(op.type)&&!String(op.key||'').trim())return validationError(`“${node.title}”: fill in the field name.`);if(op.type==='assign'&&!String(op.value||'').trim())return validationError(`“${node.title}”: write the team member’s name.`);if(op.type==='start_flow'&&!op.value)return validationError(`“${node.title}”: choose which automation to start.`);if(op.type==='webhook'&&!/^https:\/\//i.test(String(op.value||'')))return validationError(`“${node.title}”: the app address must start with https://.`)}}
      if(node.type==='input'&&!String(node.text||'').trim())return validationError(`“${node.title}”: write the question to ask.`);
      if(node.type==='randomizer'){const total=(node.branches||[]).reduce((sum,branch)=>sum+(Number(branch.percent)||0),0);if(total!==100)return validationError(`“${node.title}”: the paths must add up to 100% (now ${total}%).`);if((node.branches||[]).some(branch=>Number(branch.percent)>0&&!branch.nextId))return validationError(`“${node.title}”: choose where every path goes.`)}
    }errorBox.hidden=true;return true
  }
  function validationError(message){showError(message);return false}
  function triggerSummary(){const type=state.trigger.type||'comment';const words=state.trigger.keywords.join(', ')||'add keywords';
    if(type==='dm_keyword')return`Message ${state.trigger.match==='exact'?'is exactly':'contains'}: ${words}`;
    if(type==='story_reply')return state.trigger.match==='any'?'Any reply to your stories':`Story reply ${state.trigger.match==='exact'?'is exactly':'contains'}: ${words}`;
    if(type==='live_comment')return state.trigger.match==='any'?'Any comment during your Live':`Live comment ${state.trigger.match==='exact'?'is exactly':'contains'}: ${words}`;
    if(type==='story_mention')return'When someone mentions you in their story';
    if(type==='share')return'When someone shares a post or reel with you';
    if(type==='ref_link')return state.trigger.ref?`Link: ig.me/m/…?ref=${state.trigger.ref}`:'Add a link code';
    if(type==='ice_breaker')return state.trigger.question?`“${state.trigger.question}”`:'Write the question';
    if(type==='default_reply')return'Any message no other automation catches';
    const scope={all:'All posts and reels',selected:`${state.trigger.postIds.length||'No'} selected posts`,next:'Your next post or reel'}[state.trigger.scope];const match=state.trigger.match==='any'?'Any comment':`${capitalize(state.trigger.match)}: ${state.trigger.keywords.join(', ')||'add keywords'}`;return`${scope} · ${match}`}
  function triggerChips(){const output=[];if((state.trigger.type||'comment')!=='comment')return output;if(state.trigger.scope==='selected'&&!state.trigger.postIds.length)output.push('⚠ Choose a post');if(state.trigger.publicEnabled)output.push(`${state.trigger.variations.filter(Boolean).length} public replies`);if(state.trigger.firstCommentOnly)output.push('First comment only');return output}
  function nodeSummary(node){if(node.type!=='condition')return'';if(!Array.isArray(node.rules))return`Reply ${node.operator||'contains'} ${node.value||'a value'}`;const parts=node.rules.map(ruleSummary);return parts.join(node.match==='any'?' or ':' and ')||'Add a condition'}
  function ruleSummary(rule){const op=(RULE_OPS[rule.field]||[]).find(([value])=>value===rule.op)?.[1]||'';if(rule.field==='follows')return rule.op==='is_false'?'Does not follow you':'Follows you';if(rule.field==='follower_count')return`Followers ${op} ${rule.value||0}`;if(rule.field==='tag')return`${rule.op==='not_has'?'No tag':'Tag'} “${rule.value||'…'}”`;if(rule.field==='field')return`${rule.key||'field'} ${op}${['is_set','not_set'].includes(rule.op)?'':` “${rule.value||''}”`}`;return rule.op==='any'?'Replied anything':`Reply ${op} “${rule.value||''}”`}
  function autoConditionTitle(node){const rule=(node.rules||[])[0]||{};const more=(node.rules||[]).length>1?' …':'';if(rule.field==='follows')return(rule.op==='is_false'?'Not following you?':'Follows you?')+more;if(rule.field==='tag')return`Tag “${rule.value||'…'}”?${more}`;if(rule.field==='follower_count')return`${rule.value||'…'}+ followers?${more}`;if(rule.field==='field')return`${rule.key||'Field'} saved?${more}`;return`Replied “${rule.value||'…'}”?${more}`.slice(0,60)}
  function opSummary(op){const label=OP_TYPES[op.type]||'Action';if(['add_tag','remove_tag'].includes(op.type))return`${label}: ${op.value||'…'}`;if(op.type==='set_field')return`Save ${op.key||'field'} = ${op.value||'…'}`;if(op.type==='clear_field')return`Clear ${op.key||'field'}`;if(op.type==='notify')return`Notify team${op.value?`: ${op.value}`:''}`;if(op.type==='assign')return`Assign to ${op.value||'…'}`;if(op.type==='start_flow')return`Start “${otherFlows.find(flow=>flow.id===op.value)?.name||'…'}”`;if(op.type==='webhook')return`Send to ${(()=>{try{return new URL(op.value).hostname}catch(_){return'another app'}})()}`;return label}
  function branchLetter(index){return String.fromCharCode(65+index)}
  function targetName(id){return byId(id)?.title||'Choose next'}
  function byId(id){return state.nodes.find(node=>node.id===id)||null}
  function stepTitle(type){return({message:'Instagram message',condition:'Condition',delay:'Smart delay',ai:'AI assistant',handoff:'Human handoff',action:'Actions',input:'Collect info',randomizer:'Randomizer'})[type]||'Step'}
  function pluralUnit(unit,amount){const value=unit||'minute';return Number(amount)===1?value:`${value}s`}
  function uniqueId(prefix){return`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2,7)}`}
  function bindText(selector,apply){const element=document.querySelector(selector);if(!element)return;element.addEventListener('input',event=>{apply(event.target.value);markDirty();renderCanvas()})}
  function bindLines(selector,apply){const element=document.querySelector(selector);if(!element)return;element.addEventListener('input',()=>{apply(element.value.split('\n').map(value=>value.trim()).filter(Boolean));markDirty();renderCanvas()})}
  function bindCheck(selector,apply){document.querySelector(selector).addEventListener('change',event=>{apply(event.target.checked);markDirty();renderCanvas()})}
  function snapshot(){return JSON.stringify({nodes:state.nodes,trigger:state.trigger,name:state.name,triggerPos:state.triggerPos||null})}
  function commitHistory(){clearTimeout(historyTimer);historyTimer=null;if(restoring)return;const current=snapshot();if(current===lastSnapshot)return;if(lastSnapshot)undoStack.push(lastSnapshot);if(undoStack.length>100)undoStack.shift();lastSnapshot=current;future=[];updateHistoryButtons()}
  function restore(from,to){commitHistory();if(!from.length)return;to.push(snapshot());const saved=JSON.parse(from.pop());restoring=true;Object.assign(state,{nodes:saved.nodes,trigger:saved.trigger,name:saved.name,triggerPos:saved.triggerPos});document.querySelector('#flow-name').value=state.name;if(state.selected&&state.selected!=='trigger'&&!byId(state.selected))state.selected=null;lastSnapshot=snapshot();markDirty();restoring=false;renderAll();updateHistoryButtons()}
  function undo(){if(mode==='edit')restore(undoStack,future)}
  function redo(){if(mode==='edit')restore(future,undoStack)}
  function updateHistoryButtons(){const u=document.querySelector('#undo-flow'),r=document.querySelector('#redo-flow');if(u)u.disabled=!undoStack.length&&snapshot()===lastSnapshot;if(r)r.disabled=!future.length}
  function copyStep(){const node=byId(state.selected);if(!node)return false;try{localStorage.setItem(clipboardKey,JSON.stringify(node))}catch(_){}window.HansoraUI.toast('Step copied · ⌘V / Ctrl+V to paste, also in another automation');return true}
  function pasteStep(){let node=null;try{node=JSON.parse(localStorage.getItem(clipboardKey)||'null')}catch(_){}if(!node?.type)return false;const copy=structuredClone(node);copy.id=uniqueId(copy.type);delete copy.entry;delete copy.commentReply;delete copy.pos;['nextId','replyNextId','yesId','noId'].forEach(key=>{if(key in copy)copy[key]=null});(copy.actions||[]).forEach(action=>{action.id=uniqueId('action');if('nextId' in action)action.nextId=null});(copy.branches||[]).forEach(branch=>{branch.id=uniqueId('branch');branch.nextId=null});const anchor=currentLayout?.positions.get(state.selected)||currentLayout?.positions.get('trigger')||{x:40,y:40};copy.pos=freeSpot(anchor.x+60,anchor.y+80);state.nodes.push(copy);state.selected=copy.id;markDirty();renderAll();requestAnimationFrame(()=>centerOn(copy.id));window.HansoraUI.toast('Step pasted — connect it with a + ');return true}
  function markDirty(){
    if(!restoring){clearTimeout(historyTimer);historyTimer=setTimeout(commitHistory,350);document.querySelector('#undo-flow')?.removeAttribute('disabled')}
    if(state.status==='active'){document.querySelector('#draft-state').textContent='Unpublished changes — click Publish changes';return}
    document.querySelector('#draft-state').textContent='Saving…';const footer=document.querySelector('#inspector-saved');if(footer)footer.textContent='Saving…';clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveFlow(state.status),900)
  }
  function setSaved(message='All changes saved'){document.querySelector('#draft-state').textContent=message;const footer=document.querySelector('#inspector-saved');if(footer)footer.textContent=`✓ ${message}`}
  function showError(message){errorBox.textContent=message;errorBox.hidden=false;errorBox.scrollIntoView({behavior:'smooth',block:'nearest'})}
  function fail(message){loading.hidden=true;builder.hidden=true;showError(message)}
  function capitalize(value){return String(value||'').replace(/^./,letter=>letter.toUpperCase())}
  function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]))}
  // ---------- Canvas camera: pan, zoom, fit (like ManyChat / Figma) ----------
  function applyCamera(){document.querySelector('#flow-map').style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;document.querySelector('#flow-map').style.setProperty('--z',camera.z);document.querySelector('#zoom-reset').textContent=`${Math.round(camera.z*100)}%`}
  function zoomBy(factor,cx,cy){const rect=document.querySelector('#flow-canvas').getBoundingClientRect();const px=cx??rect.width/2,py=cy??rect.height/2;const next=Math.min(2,Math.max(0.25,camera.z*factor));camera.x=px-(px-camera.x)*(next/camera.z);camera.y=py-(py-camera.y)*(next/camera.z);camera.z=next;applyCamera()}
  function bounds(){const points=[...(currentLayout?.positions.values()||[])];const origin=currentLayout?.positions.get('trigger');if(origin&&!entryNode())points.push({x:origin.x+370,y:origin.y});if(!points.length)return null;return{minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x))+330,maxY:Math.max(...points.map(p=>p.y))+320}}
  function fitView(){const box=bounds();if(!box)return;const rect=document.querySelector('#flow-canvas').getBoundingClientRect();const z=Math.min(1,Math.max(0.3,Math.min((rect.width-80)/(box.maxX-box.minX),(rect.height-140)/(box.maxY-box.minY))));camera.z=z;camera.x=(rect.width-(box.maxX-box.minX)*z)/2-box.minX*z;camera.y=Math.max(64,(rect.height-(box.maxY-box.minY)*z)/2)-box.minY*z;applyCamera()}
  // A selected step never hides under the settings panel: slide the canvas just enough.
  function keepVisible(id){const point=currentLayout?.positions.get(id);if(!point)return;const rect=document.querySelector('#flow-canvas').getBoundingClientRect();if(window.innerWidth<=900)return;const right=(point.x+330)*camera.z+camera.x,limit=rect.width-410;if(right>limit){camera.x-=right-limit;applyCamera()}const left=point.x*camera.z+camera.x;if(left<20){camera.x+=20-left;applyCamera()}}
  function centerOn(id){const point=currentLayout?.positions.get(id);if(!point)return;const rect=document.querySelector('#flow-canvas').getBoundingClientRect();const panel=document.querySelector('#flow-inspector').classList.contains('closed')||window.innerWidth<=900?0:400;camera.x=(rect.width-panel)/2-(point.x+160)*camera.z;camera.y=rect.height/3-(point.y+60)*camera.z;applyCamera()}
  function setupCanvasGestures(){
    const canvas=document.querySelector('#flow-canvas');
    // Trackpad pinch / Ctrl+wheel zooms at the cursor; normal scrolling moves around the canvas.
    canvas.addEventListener('wheel',event=>{if(event.target.closest('.flow-add-panel,.flow-step-popover'))return;event.preventDefault();const rect=canvas.getBoundingClientRect();if(event.ctrlKey||event.metaKey)zoomBy(Math.exp(-event.deltaY*0.0025),event.clientX-rect.left,event.clientY-rect.top);else{camera.x-=event.deltaX;camera.y-=event.deltaY;applyCamera();drawEdges()}},{passive:false});
    let gesture=null;
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      // Controls that handle their own clicks never start a drag (toolbar, menus, lines, the first-step card…).
      // Grabbing a line moves its end to another step (like ManyChat); a plain click still selects it for ✕.
      const hit=event.target.closest('.edge-hit');
      if(hit&&mode==='edit'){const [sourceId,portKind,index]=String(hit.dataset.edge).split('|');gesture={kind:'link',sourceId,portKind,index:index===''?null:Number(index),port:portEl(sourceId,portKind,index===''?null:Number(index)),fromEdge:hit.dataset.edge,startX:event.clientX,startY:event.clientY,moved:false,pointerId:event.pointerId};return}
      if(event.target.closest('.flow-zoom,.flow-add-panel,.flow-add-fab,.flow-node-menu,.flow-mode-banner,.node-toolbar,.flow-first-step,.flow-step-popover,.edge-hit,.edge-remove'))return;
      const port=event.target.closest('[data-port]');
      if(port){if(mode!=='edit'){gesture=null;return}event.preventDefault();gesture={kind:'link',sourceId:port.dataset.sourceId,portKind:port.dataset.kind,index:port.dataset.index===undefined?null:Number(port.dataset.index),port,startX:event.clientX,startY:event.clientY,moved:false,pointerId:event.pointerId};return}
      const nodeEl=event.target.closest('[data-node-id]');
      if(nodeEl){if(mode!=='edit'||event.target.closest('button,input,textarea,select,a'))return;const id=nodeEl.dataset.nodeId;gesture={kind:'node',id,el:nodeEl,startX:event.clientX,startY:event.clientY,origin:{...currentLayout.positions.get(id)},moved:false};}
      else gesture={kind:'pan',startX:event.clientX,startY:event.clientY,origin:{x:camera.x,y:camera.y},moved:false};
      gesture.pointerId=event.pointerId;
    });
    canvas.addEventListener('pointermove',event=>{
      if(!gesture)return;const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
      if(!gesture.moved&&Math.hypot(dx,dy)<5)return;if(!gesture.moved){gesture.moved=true;try{canvas.setPointerCapture(gesture.pointerId)}catch(_){}document.querySelector('.node-toolbar')?.remove();if(gesture.fromEdge){document.querySelector('.edge-remove')?.remove();document.querySelectorAll('#flow-lines [data-edge]').forEach(path=>{if(path.dataset.edge===gesture.fromEdge){path.previousElementSibling?.classList.add('moving');path.nextElementSibling?.classList.add('moving')}})}}
      if(gesture.kind==='link'){
        // Drawing a new connection: a dashed line follows the pointer; the step under it lights up.
        const a=portCenter(gesture.sourceId,gesture.portKind,gesture.index),b=mapPoint(event.clientX,event.clientY);const svg=document.querySelector('#flow-lines');
        let temp=svg.querySelector('.temp-link');if(!temp){svg.insertAdjacentHTML('beforeend','<path class="temp-link"/>');temp=svg.querySelector('.temp-link')}
        if(a)temp.setAttribute('d',curve(a,b));
        document.querySelectorAll('.flow-node.link-target').forEach(item=>item.classList.remove('link-target'));
        const over=document.elementFromPoint(event.clientX,event.clientY)?.closest('.flow-node');if(over&&over.dataset.nodeId!=='trigger'&&over.dataset.nodeId!==gesture.sourceId)over.classList.add('link-target');
        return;
      }
      if(gesture.kind==='pan'){camera.x=gesture.origin.x+dx;camera.y=gesture.origin.y+dy;applyCamera();canvas.classList.add('panning');return}
      const x=Math.round(gesture.origin.x+dx/camera.z),y=Math.round(gesture.origin.y+dy/camera.z);
      gesture.el.style.left=`${x}px`;gesture.el.style.top=`${y}px`;gesture.el.classList.add('dragging');currentLayout.positions.set(gesture.id,{x,y});drawEdges();
    });
    const finish=event=>{
      if(!gesture)return;const done=gesture;gesture=null;canvas.classList.remove('panning');
      if(done.kind==='link'){
        if(done.fromEdge&&!done.moved)return; // a click on the line: the click handler selects it
        suppressClick=true;setTimeout(()=>{suppressClick=false},60);
        document.querySelector('#flow-lines .temp-link')?.remove();document.querySelectorAll('.flow-node.link-target').forEach(item=>item.classList.remove('link-target'));
        const connection={sourceId:done.sourceId,kind:done.portKind==='start'?'next':done.portKind,actionIndex:done.index};
        if(!done.moved){const target=connectionTarget(done.sourceId,done.portKind,done.index);if(target&&byId(target)){state.selected=target;selectedEdge=null;renderAll();keepVisible(target);return}return openStepPicker(done.sourceId,connection.kind,done.index,done.port)}
        const over=event&&document.elementFromPoint(event.clientX,event.clientY)?.closest('.flow-node');const targetId=over?.dataset.nodeId;
        if(targetId&&targetId!=='trigger'&&targetId!==done.sourceId){attachConnection(connection,targetId);selectedEdge=null;markDirty();renderAll();return}
        if(done.fromEdge){drawEdges();return} // a moved line dropped on empty space keeps its old step
        // Dropped on empty space: choose a step, created right where the line was dropped.
        const point=event?mapPoint(event.clientX,event.clientY):null;
        return openStepPicker(done.sourceId,connection.kind,done.index,event?{getBoundingClientRect:()=>({right:event.clientX,top:event.clientY})}:done.port,point?{x:Math.round(point.x),y:Math.round(point.y-30)}:null);
      }
      if(!done.moved){if(done.kind==='pan'&&(state.selected||selectedEdge)){state.selected=null;selectedEdge=null;renderAll()}return}suppressClick=true;setTimeout(()=>{suppressClick=false},50);
      if(done.kind==='node'){const pos=currentLayout.positions.get(done.id);if(done.id==='trigger')state.triggerPos=pos;else{const node=byId(done.id);if(node)node.pos=pos}markDirty();renderCanvas()}
    };
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',()=>finish(null));
  }
  function onKeyDown(event){
    if(event.target.closest?.('input,textarea,select,[contenteditable]'))return;
    if(event.key==='Escape'){toggleAddPanel(false);closeStepPicker();document.querySelector('#node-menu').hidden=true;if(state.selected){state.selected=null;renderAll()}}
    if(mode!=='edit')return;
    if((event.key==='Delete'||event.key==='Backspace')&&state.selected&&state.selected!=='trigger'&&byId(state.selected)){event.preventDefault();removeNode(state.selected,{announce:true})}
    const mod=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();
    if(mod&&key==='z'){event.preventDefault();return event.shiftKey?redo():undo()}
    if(mod&&key==='y'){event.preventDefault();return redo()}
    if(mod&&key==='c'&&!String(window.getSelection?.()||'')&&state.selected&&state.selected!=='trigger'){if(copyStep())event.preventDefault()}
    if(mod&&key==='v'){if(pasteStep())event.preventDefault()}
  }

  // ---------- Add panel, step menu, duplicate ----------
  function toggleAddPanel(force){const panel=document.querySelector('#add-panel');const open=typeof force==='boolean'?force:panel.hidden;panel.hidden=!open;if(open)panel.scrollTop=0;document.querySelector('#add-step-fab').setAttribute('aria-expanded',String(open));document.querySelector('#add-step-fab').classList.toggle('open',open)}
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
    try{const response=await api.authenticatedFetch('/.netlify/functions/automation-flow-stats',{method:'POST',body:JSON.stringify({business_id:businessId,workflow_id:state.workflowId})});if(!response.ok)throw new Error('stats_unavailable');stats=await response.json();if(!stats?.trigger)throw new Error('stats_unavailable');stats.nodes=stats.nodes||{};}
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
