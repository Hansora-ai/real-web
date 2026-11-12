/* Hansora website chat bubble. A business adds it to its own website with one line:
     <script src="https://hansora.co/chat.js" data-key="hw_…" async></script>
   Visitors chat with the business's Hansora AI employee; the team's replies from the Hansora inbox appear here too.
   Everything is drawn inside a shadow root, so the website's own styles can't break it (and it can't break theirs).
   Talks only to /.netlify/functions/automation-website-chat on the Hansora site that served this file. */
(function () {
  "use strict";
  var script = document.currentScript || document.querySelector('script[src*="chat.js"][data-key]');
  if (!script || window.__hansoraChatLoaded) return;
  window.__hansoraChatLoaded = true;
  var KEY = String(script.getAttribute("data-key") || "");
  var PREVIEW = script.hasAttribute("data-preview");
  var API = (function () { try { return new URL(script.src).origin + "/.netlify/functions/automation-website-chat"; } catch (_) { return "/.netlify/functions/automation-website-chat"; } })();
  if (!/^hw_[0-9a-f]{24}$/.test(KEY) && !PREVIEW) return;

  var TEXT = {
    en: { open: "Open chat", close: "Close chat", placeholder: "Write a message…", send: "Send", online: "Usually replies in seconds", team: "Team", formTitle: "Before we start", formNote: "So we can reach you if the chat closes.", name: "Your name", phone: "Phone number", email: "Email", start: "Start chat", skip: "Skip", required: "Please fill in", error: "Message not sent. Please try again.", slow: "You're writing quickly — please wait a moment.", limit: "We can't take more messages right now. Please try again later.", offline: "The chat is offline right now.", powered: "Powered by Hansora AI" },
    ru: { open: "Открыть чат", close: "Закрыть чат", placeholder: "Напишите сообщение…", send: "Отправить", online: "Обычно отвечаем за секунды", team: "Команда", formTitle: "Перед началом", formNote: "Чтобы мы могли связаться с вами, если чат закроется.", name: "Ваше имя", phone: "Номер телефона", email: "Email", start: "Начать чат", skip: "Пропустить", required: "Пожалуйста, заполните", error: "Сообщение не отправлено. Попробуйте ещё раз.", slow: "Вы пишете очень быстро — подождите немного.", limit: "Сейчас мы не можем принять больше сообщений. Попробуйте позже.", offline: "Чат сейчас не работает.", powered: "Работает на Hansora AI" },
    hy: { open: "Բացել չատը", close: "Փակել չատը", placeholder: "Գրեք հաղորդագրություն…", send: "Ուղարկել", online: "Սովորաբար պատասխանում ենք վայրկյանների ընթացքում", team: "Թիմ", formTitle: "Սկսելուց առաջ", formNote: "Որպեսզի կարողանանք կապվել ձեզ հետ, եթե չատը փակվի։", name: "Ձեր անունը", phone: "Հեռախոսահամար", email: "Էլ. փոստ", start: "Սկսել չատը", skip: "Բաց թողնել", required: "Խնդրում ենք լրացնել", error: "Հաղորդագրությունը չուղարկվեց։ Փորձեք կրկին։", slow: "Դուք շատ արագ եք գրում․ մի պահ սպասեք։", limit: "Այս պահին չենք կարող ընդունել ավելի շատ հաղորդագրություններ։ Փորձեք ավելի ուշ։", offline: "Չատն այս պահին անջատված է։", powered: "Hansora AI-ի միջոցով" },
    es: { open: "Abrir chat", close: "Cerrar chat", placeholder: "Escribe un mensaje…", send: "Enviar", online: "Solemos responder en segundos", team: "Equipo", formTitle: "Antes de empezar", formNote: "Para poder contactarte si el chat se cierra.", name: "Tu nombre", phone: "Teléfono", email: "Email", start: "Empezar chat", skip: "Omitir", required: "Por favor, completa", error: "No se envió el mensaje. Inténtalo de nuevo.", slow: "Escribes muy rápido; espera un momento.", limit: "Ahora no podemos recibir más mensajes. Inténtalo más tarde.", offline: "El chat no está disponible ahora.", powered: "Con la tecnología de Hansora AI" },
    fr: { open: "Ouvrir le chat", close: "Fermer le chat", placeholder: "Écrivez un message…", send: "Envoyer", online: "Répond généralement en quelques secondes", team: "Équipe", formTitle: "Avant de commencer", formNote: "Pour vous recontacter si le chat se ferme.", name: "Votre nom", phone: "Téléphone", email: "E-mail", start: "Commencer", skip: "Passer", required: "Veuillez remplir", error: "Message non envoyé. Réessayez.", slow: "Vous écrivez très vite, patientez un instant.", limit: "Nous ne pouvons plus recevoir de messages pour le moment. Réessayez plus tard.", offline: "Le chat est hors ligne.", powered: "Propulsé par Hansora AI" },
    de: { open: "Chat öffnen", close: "Chat schließen", placeholder: "Nachricht schreiben…", send: "Senden", online: "Antwortet meist in Sekunden", team: "Team", formTitle: "Bevor wir starten", formNote: "Damit wir Sie erreichen, falls der Chat schließt.", name: "Ihr Name", phone: "Telefonnummer", email: "E-Mail", start: "Chat starten", skip: "Überspringen", required: "Bitte ausfüllen", error: "Nachricht nicht gesendet. Bitte erneut versuchen.", slow: "Sie schreiben sehr schnell – bitte kurz warten.", limit: "Wir können gerade keine weiteren Nachrichten annehmen. Bitte später erneut versuchen.", offline: "Der Chat ist gerade offline.", powered: "Bereitgestellt von Hansora AI" }
  };
  var lang = (function () {
    var page = String(document.documentElement.lang || "").slice(0, 2).toLowerCase();
    var browser = String(navigator.language || "en").slice(0, 2).toLowerCase();
    if (page === "am") page = "hy";
    return TEXT[page] ? page : TEXT[browser] ? browser : "en";
  })();
  var T = TEXT[lang];

  function store(name, value) {
    var key = "hansora_chat_" + name + "_" + KEY;
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (_) { return null; }
    return value;
  }
  function randomId() {
    var bytes = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  var visitor = store("visitor");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(visitor || "")) visitor = store("visitor", "v" + randomId());

  var config = null, cursor = null, seen = {}, open = false, unread = 0, typing = false, waitingForReply = false, detailsDone = false, timer = null, hasChat = false;
  var host = document.createElement("div");
  host.id = "hansora-chat";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483000;bottom:0;right:0;width:0;height:0";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function api(method, params, body) {
    var url = API + (method === "GET" ? "?" + new URLSearchParams(params).toString() : "");
    return fetch(url, { method: method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "omit" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { data.__status = r.status; return data; }); });
  }

  function css(color, side) {
    return ":host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}"
      + ".launcher{position:fixed;bottom:20px;" + side + ":20px;width:60px;height:60px;border-radius:50%;border:0;background:" + color + ";color:#fff;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}"
      + ".launcher:hover{transform:scale(1.06)}.launcher svg{width:28px;height:28px}"
      + ".badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}"
      + ".panel{position:fixed;bottom:92px;" + side + ":20px;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;color:#111827;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}"
      + ".panel.open{display:flex}"
      + ".head{background:" + color + ";color:#fff;padding:16px 18px;display:flex;align-items:center;gap:12px}"
      + ".avatar{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;flex:none}"
      + ".title{font-weight:700;font-size:16px;line-height:1.2}.sub{font-size:12px;opacity:.85;margin-top:2px;display:flex;align-items:center;gap:6px}.dot{width:7px;height:7px;border-radius:50%;background:#4ade80}"
      + ".x{margin-left:auto;background:rgba(255,255,255,.18);border:0;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1}"
      + ".list{flex:1;overflow-y:auto;padding:16px;background:#f6f7f9;display:flex;flex-direction:column;gap:8px}"
      + ".msg{max-width:82%;padding:10px 13px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}"
      + ".msg a{color:inherit;text-decoration:underline}"
      + ".bot{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:5px}"
      + ".me{align-self:flex-end;background:" + color + ";color:#fff;border-bottom-right-radius:5px}"
      + ".who{display:block;font-size:11px;font-weight:700;opacity:.6;margin-bottom:3px}"
      + ".msg img{display:block;max-width:100%;border-radius:10px;margin-bottom:6px}"
      + ".typing{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:12px 14px;display:flex;gap:4px}"
      + ".typing i{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:b 1.2s infinite}.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}"
      + "@keyframes b{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}"
      + ".note{align-self:center;font-size:12px;color:#b91c1c;text-align:center;padding:4px 8px}"
      + ".bar{display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#fff}"
      + ".bar textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.4;max-height:110px;outline:none;color:#111827;background:#fff}"
      + ".bar textarea:focus{border-color:" + color + "}"
      + ".bar button{border:0;border-radius:12px;background:" + color + ";color:#fff;width:44px;cursor:pointer;display:flex;align-items:center;justify-content:center}.bar button:disabled{opacity:.5;cursor:default}"
      + ".form{padding:18px;display:flex;flex-direction:column;gap:10px;background:#fff;border-top:1px solid #e5e7eb}"
      + ".form h4{margin:0;font-size:15px}.form p{margin:0 0 4px;font-size:12px;color:#6b7280}"
      + ".form input{border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;font-size:14px;color:#111827;background:#fff;outline:none}.form input:focus{border-color:" + color + "}"
      + ".row{display:flex;gap:8px}.row button{flex:1;border-radius:10px;padding:10px;font-size:14px;font-weight:700;cursor:pointer;border:0}"
      + ".go{background:" + color + ";color:#fff}.skip{background:#f3f4f6;color:#374151}"
      + ".brand{text-align:center;font-size:11px;color:#9ca3af;padding:6px 0 8px;background:#fff}.brand a{color:#9ca3af;text-decoration:none}"
      // Phones: the chat fills the screen. (Not in the dashboard preview, which is narrow but shows the normal bubble.)
      + (PREVIEW ? "" : "@media (max-width:480px){.panel{bottom:0;" + side + ":0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.panel.open~.launcher{display:none}}");
  }

  var ui = {};
  function build() {
    var color = /^#[0-9a-f]{6}$/i.test(config.color) ? config.color : "#7c3aed";
    var side = config.position === "left" ? "left" : "right";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483000;bottom:0;" + side + ":0;width:0;height:0";
    var style = el("style"); style.textContent = css(color, side); root.appendChild(style);

    ui.panel = el("div", "panel"); ui.panel.setAttribute("role", "dialog"); ui.panel.setAttribute("aria-label", config.title);
    var head = el("div", "head");
    head.appendChild(el("div", "avatar", (config.title || "?").trim().charAt(0).toUpperCase()));
    var names = el("div"); names.appendChild(el("div", "title", config.title));
    var sub = el("div", "sub"); sub.appendChild(el("span", "dot")); sub.appendChild(document.createTextNode(T.online)); names.appendChild(sub);
    head.appendChild(names);
    var x = el("button", "x", "×"); x.setAttribute("aria-label", T.close); x.onclick = function () { toggle(false); }; head.appendChild(x);
    ui.panel.appendChild(head);
    ui.list = el("div", "list"); ui.list.setAttribute("aria-live", "polite"); ui.panel.appendChild(ui.list);
    ui.form = buildForm(); ui.panel.appendChild(ui.form);
    ui.bar = el("div", "bar");
    ui.input = el("textarea"); ui.input.rows = 1; ui.input.placeholder = T.placeholder; ui.input.maxLength = 1000; ui.input.setAttribute("aria-label", T.placeholder);
    ui.input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    ui.input.addEventListener("input", function () { ui.input.style.height = "auto"; ui.input.style.height = Math.min(110, ui.input.scrollHeight) + "px"; });
    ui.sendBtn = el("button"); ui.sendBtn.setAttribute("aria-label", T.send);
    ui.sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
    ui.sendBtn.onclick = send;
    ui.bar.appendChild(ui.input); ui.bar.appendChild(ui.sendBtn); ui.panel.appendChild(ui.bar);
    if (config.branding !== false) { var brand = el("div", "brand"); var a = el("a", "", T.powered); a.href = "https://hansora.co/automation"; a.target = "_blank"; a.rel = "noopener"; brand.appendChild(a); ui.panel.appendChild(brand); }
    root.appendChild(ui.panel);

    ui.launcher = el("button", "launcher"); ui.launcher.setAttribute("aria-label", T.open);
    ui.launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.1A8.5 8.5 0 1 1 21 12z"/></svg>';
    ui.badge = el("span", "badge"); ui.badge.style.display = "none"; ui.launcher.appendChild(ui.badge);
    ui.launcher.onclick = function () { toggle(!open); };
    root.appendChild(ui.launcher);
    if (config.greeting) addMessage({ id: "greeting", from: "ai", text: config.greeting }, true);
    showForm();
  }

  function buildForm() {
    var form = el("form", "form"); form.noValidate = true;
    form.appendChild(el("h4", "", T.formTitle)); form.appendChild(el("p", "", T.formNote));
    ui.fields = {};
    (config.detail_fields || []).forEach(function (field) {
      var input = el("input"); input.name = field; input.placeholder = T[field] + (config.ask_details === "required" ? " *" : "");
      input.type = field === "email" ? "email" : field === "phone" ? "tel" : "text"; input.autocomplete = field === "name" ? "name" : field === "phone" ? "tel" : "email";
      input.setAttribute("aria-label", T[field]); ui.fields[field] = input; form.appendChild(input);
    });
    var row = el("div", "row");
    if (config.ask_details === "optional") { var skip = el("button", "skip", T.skip); skip.type = "button"; skip.onclick = function () { detailsDone = true; store("details", "skipped"); showForm(); }; row.appendChild(skip); }
    var go = el("button", "go", T.start); go.type = "submit"; row.appendChild(go);
    form.appendChild(row);
    ui.formNote = el("p"); ui.formNote.style.color = "#b91c1c"; form.appendChild(ui.formNote);
    form.onsubmit = function (e) { e.preventDefault(); submitDetails(); };
    return form;
  }

  function needForm() { return config.ask_details !== "off" && (config.detail_fields || []).length && !detailsDone; }
  function showForm() {
    var need = needForm();
    ui.form.style.display = need ? "flex" : "none";
    ui.bar.style.display = need ? "none" : "flex";
  }
  function details() {
    var out = {}; Object.keys(ui.fields || {}).forEach(function (k) { out[k] = ui.fields[k].value.trim(); }); return out;
  }
  function submitDetails() {
    var d = details();
    var missing = config.ask_details === "required" ? (config.detail_fields || []).filter(function (f) { return !d[f]; }) : [];
    if (missing.length) { ui.formNote.textContent = T.required + ": " + missing.map(function (f) { return T[f]; }).join(", "); return; }
    if (PREVIEW) { detailsDone = true; showForm(); return; }
    api("POST", null, { key: KEY, visitor: visitor, action: "details", details: d }).then(function (r) {
      if (r.__status >= 400) { ui.formNote.textContent = r.field ? T.required + ": " + T[r.field] : T.error; return; }
      detailsDone = true; store("details", "given"); showForm(); ui.input.focus();
    }).catch(function () { ui.formNote.textContent = T.error; });
  }

  function linkify(node, text) {
    var re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el("a", "", m[0]); a.href = m[0]; a.target = "_blank"; a.rel = "noopener nofollow"; node.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  function addMessage(m, quiet) {
    if (seen[m.id]) return;
    seen[m.id] = true;
    var mine = m.from === "visitor";
    var bubble = el("div", "msg " + (mine ? "me" : "bot"));
    if (m.from === "team") bubble.appendChild(el("span", "who", T.team));
    if (m.image) { var img = el("img"); img.src = m.image; img.alt = m.text || ""; img.loading = "lazy"; bubble.appendChild(img); }
    if (m.text) linkify(bubble, m.text);
    ui.list.insertBefore(bubble, ui.typing && ui.typing.parentNode ? ui.typing : null);
    if (!mine) { hasChat = true; if (!open && !quiet) { unread++; renderBadge(); } }
    scroll();
  }
  function note(text) { var n = el("div", "note", text); ui.list.appendChild(n); scroll(); setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 6000); }
  function scroll() { ui.list.scrollTop = ui.list.scrollHeight; }
  function renderBadge() { ui.badge.textContent = unread > 9 ? "9+" : String(unread); ui.badge.style.display = unread ? "flex" : "none"; }
  function setTyping(on) {
    if (on && !ui.typing) { ui.typing = el("div", "typing"); ui.typing.innerHTML = "<i></i><i></i><i></i>"; }
    if (on && !ui.typing.parentNode) { ui.list.appendChild(ui.typing); scroll(); }
    if (!on && ui.typing && ui.typing.parentNode) ui.typing.parentNode.removeChild(ui.typing);
  }

  function toggle(state) {
    open = state;
    ui.panel.classList.toggle("open", open);
    ui.launcher.setAttribute("aria-label", open ? T.close : T.open);
    try { sessionStorage.setItem("hansora_chat_open_" + KEY, open ? "1" : "0"); } catch (_) {}
    // Focus the message box when a visitor opens the chat (never in the dashboard preview: it would take the cursor
    // away from the settings the owner is typing in).
    if (open) { unread = 0; renderBadge(); scroll(); if (!PREVIEW) setTimeout(function () { (needForm() ? (ui.form.querySelector("input") || ui.input) : ui.input).focus(); }, 50); }
    schedule(0);
  }

  function send() {
    var text = ui.input.value.trim();
    if (!text || ui.sendBtn.disabled) return;
    var clientId = randomId();
    var local = { id: "local-" + clientId, from: "visitor", text: text };
    addMessage(local);
    ui.input.value = ""; ui.input.style.height = "auto";
    if (PREVIEW) return;
    ui.sendBtn.disabled = true; waitingForReply = true; setTyping(true);
    api("POST", null, { key: KEY, visitor: visitor, message: text, client_id: clientId, page: location.href.slice(0, 300) }).then(function (r) {
      ui.sendBtn.disabled = false;
      if (r.__status >= 400) {
        waitingForReply = false; setTyping(false);
        if (r.error === "details_missing") { detailsDone = false; showForm(); return; }
        note(r.__status === 429 ? (r.error === "too_fast" ? T.slow : T.limit) : r.error === "chat_offline" ? T.offline : T.error);
        return;
      }
      if (r.message && r.message.id) seen[r.message.id] = true;
      hasChat = true; schedule(1200);
    }).catch(function () { ui.sendBtn.disabled = false; waitingForReply = false; setTyping(false); note(T.error); });
  }

  function poll() {
    if (PREVIEW) return;
    var params = { key: KEY, visitor: visitor };
    if (cursor) params.after = cursor;
    api("GET", params).then(function (r) {
      if (r.__status >= 400) return;
      (r.messages || []).forEach(function (m) { addMessage(m, !cursor); });
      if (r.cursor) cursor = r.cursor;
      typing = Boolean(r.typing);
      var gotReply = (r.messages || []).some(function (m) { return m.from !== "visitor"; });
      if (gotReply) waitingForReply = false;
      setTyping(typing || waitingForReply);
    }).catch(function () {}).then(function () { schedule(); });
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (PREVIEW) return;
    // Open: every 2.5 s (faster while a reply is coming). Closed: every 25 s, only once there is a chat (team replies).
    var wait = ms != null ? ms : open ? (typing || waitingForReply ? 1500 : 2500) : hasChat ? 25000 : 0;
    if (!wait && ms == null) return;
    timer = setTimeout(poll, wait);
  }

  function start(cfg, first) {
    config = cfg;
    if (!config || (!config.enabled && !PREVIEW)) return;
    detailsDone = Boolean(first && first.details_done) || store("details") === "skipped" || store("details") === "given";
    (document.body || document.documentElement).appendChild(host);
    build();
    if (first) {
      (first.messages || []).forEach(function (m) { addMessage(m, true); });
      cursor = first.cursor || null;
      hasChat = (first.messages || []).length > 0;
    }
    var wasOpen = false; try { wasOpen = sessionStorage.getItem("hansora_chat_open_" + KEY) === "1"; } catch (_) {}
    if (PREVIEW || wasOpen) toggle(true); else schedule();
  }

  if (PREVIEW) {
    var cfg = {}; try { cfg = JSON.parse(script.getAttribute("data-config") || "{}"); } catch (_) {}
    cfg.enabled = true; start(cfg, null);
    window.HansoraChatPreview = { update: function (next) { root.innerHTML = ""; ui = {}; seen = {}; start(Object.assign({ enabled: true }, next), null); } };
    return;
  }
  api("GET", { key: KEY, visitor: visitor }).then(function (r) { if (r.__status < 400 && r.config) start(r.config, r); }).catch(function () {});
})();
