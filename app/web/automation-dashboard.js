(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const ui = window.HansoraUI;
  const $ = selector => document.querySelector(selector);
  const loading = $('#dashboard-loading');
  const errorBox = $('#dashboard-error');
  const empty = $('#dashboard-empty');
  const list = $('#agent-list');
  const user = await api.requireUser('/automation-dashboard.html');
  if (!user) return;
  const preview = api.isLocalPreview && location.protocol !== 'file:';
  const setupHref = `automation-setup.html${preview ? '?preview=1' : ''}`;
  $('#create-link').href = setupHref; $('#empty-create').href = setupHref;
  const CHANNEL_ICONS = { instagram_dm:['instagram','Instagram DMs'], instagram_comments:['comment','Instagram comments'], whatsapp:['whatsapp','WhatsApp'], telegram:['telegram','Telegram'], messenger:['messenger','Messenger'], tiktok:['tiktok','TikTok'], phone:['phone','Phone calls'] };

  let businesses;
  if (api.isLocalPreview) {
    businesses = [{ id:'preview', name:'Luma Studio', category:'Home services', status:'draft', updated_at:new Date().toISOString(), automation_agents:[{display_name:'Luma Assistant', status:'active', supported_languages:['en','es','ru']}], automation_channel_connections:[{channel_type:'instagram_dm',status:'connected',connected_account_label:'@luma.studio'},{channel_type:'instagram_comments',status:'connecting'},{channel_type:'whatsapp',status:'not_connected'},{channel_type:'phone',status:'not_connected'}] }];
  } else {
    const result = await api.db.from('automation_businesses').select('id,name,category,status,updated_at,automation_agents(id,display_name,status,supported_languages),automation_channel_connections(channel_type,status,connected_account_label)').order('updated_at', { ascending:false });
    if (result.error) { loading.hidden = true; errorBox.textContent = api.displayError(result.error); errorBox.hidden = false; return; }
    businesses = result.data || [];
  }
  loading.hidden = true;
  if (!businesses.length) { empty.hidden = false; return; }

  list.innerHTML = businesses.map(business => {
    const agent = Array.isArray(business.automation_agents) ? business.automation_agents[0] : business.automation_agents;
    const name = agent?.display_name || business.name;
    const status = String(agent?.status || business.status || 'draft');
    const languages = (agent?.supported_languages || []).map(api.languageName).join(' · ') || 'Languages not set';
    const channels = business.automation_channel_connections || [];
    const live = channels.filter(channel => channel.status === 'connected').length;
    const icons = Object.entries(CHANNEL_ICONS).map(([type, [icon, label]]) => {
      const channel = channels.find(item => item.channel_type === type);
      const state = channel?.status === 'connected' ? 'on' : channel?.status === 'connecting' ? 'half' : '';
      return `<span class="ui-channel-dot ${state}" title="${label}${state === 'on' ? ' · live' : state === 'half' ? ' · finishing setup' : ' · not connected'}">${ui.icon(icon)}</span>`;
    }).join('');
    const updated = new Intl.DateTimeFormat(undefined, { dateStyle:'medium' }).format(new Date(business.updated_at));
    const igLabel = channels.find(item => item.channel_type === 'instagram_dm' && item.connected_account_label)?.connected_account_label || '';
    const href = `automation-agent.html?id=${encodeURIComponent(business.id)}${preview ? '&preview=1' : ''}`;
    return `<a class="ui-card ui-employee" href="${href}" data-business="${escapeHtml(business.id)}">
      <div class="ui-employee-top"><div class="ui-avatar sm" data-avatar><b>${escapeHtml(name.trim().charAt(0).toUpperCase() || 'A')}</b><span class="ui-presence${status === 'active' ? ' on' : ''}"></span></div><span class="ui-badge dot ${status === 'active' ? 'green live' : status === 'paused' ? 'amber' : 'blue'}">${escapeHtml(capitalize(status))}</span></div>
      <h2>${escapeHtml(name)}</h2><p>${escapeHtml(business.name)}${business.category ? ` · ${escapeHtml(api.businessType(business.category)?.label || business.category)}` : ''}</p>
      <p class="ui-employee-ig" data-ig ${igLabel ? '' : 'hidden'}>${ui.icon('instagram')}<span>${escapeHtml(igLabel)}</span></p>
      <div class="ui-employee-channels">${icons}<span>${live} of ${Object.keys(CHANNEL_ICONS).length} live</span></div>
      <div class="ui-employee-foot"><span>${escapeHtml(languages)}</span><span>Edited ${escapeHtml(updated)}</span></div>
    </a>`;
  }).join('') + `<a class="ui-employee-new" href="${setupHref}"><span>${ui.icon('sparkle')}</span><strong>New AI employee</strong><small>For another business or brand</small></a>`;
  list.hidden = false;
  ui.stagger(document);
  if (!api.isLocalPreview) loadInstagramCards();

  // Connected Instagram photo + @name on each card, so several AI employees are easy to tell apart.
  async function loadInstagramCards() {
    const ids = businesses.filter(business => (business.automation_channel_connections || []).some(item => item.channel_type === 'instagram_dm' && item.status !== 'not_connected')).map(business => business.id);
    if (!ids.length) return;
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-instagram-profile', { method:'POST', body:JSON.stringify({ business_ids:ids }) });
      const result = await response.json().catch(() => ({}));
      Object.entries(result?.profiles || {}).forEach(([id, profile]) => {
        const card = list.querySelector(`[data-business="${CSS.escape(id)}"]`);
        if (!card || !profile) return;
        if (profile.username) { const line = card.querySelector('[data-ig]'); line.querySelector('span').textContent = `@${profile.username}`; line.hidden = false; }
        if (profile.picture) {
          const image = new Image(); image.className = 'ui-avatar-photo'; image.alt = ''; image.referrerPolicy = 'no-referrer';
          image.onload = () => card.querySelector('[data-avatar]').prepend(image);
          image.src = profile.picture;
        }
      });
    } catch (error) { console.warn('Instagram profile lookup failed', error); }
  }

  function capitalize(value) { return String(value || '').replace(/_/g, ' ').replace(/^./, character => character.toUpperCase()); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }
})();
