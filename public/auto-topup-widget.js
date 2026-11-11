/* Auto top-up button for the pricing pages (pricing.html, pricing_ru.html, pricing_arm.html).
   The page opens and works as before. Only after it has loaded, this script asks the server whether the signed-in
   person has ever bought; if so, a small "Auto top-up" button appears under the International / Russian card switch.
   It opens a popup to choose a pack and a level, saved through /.netlify/functions/auto-topup (see
   lib/business/auto-topup.mjs). Signed-out visitors and people who never bought see nothing and wait for nothing. */
(function () {
  "use strict";
  var SUPABASE_URL = "https://qmaealblegvcwodlmeht.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c";

  var TEXT = {
    en: { chip: "Auto top-up", on: "On", title: "Auto top-up", intro: "Never run out mid-project. When your credits drop below the level you pick, we charge your saved card for the pack you choose. Not a monthly plan: nothing is charged while you have enough credits. At most {max} top-ups a day.",
      pack: "Pack", level: "Top up when credits fall below", turnOn: "Turn on auto top-up", save: "Save", off: "Turn off", remove: "Remove saved card", close: "Close",
      note: "You will save your card on a secure Dodo Payments page. Nothing is charged until your credits run low.", credits: "credits",
      saving: "Saving…", opening: "Opening secure checkout…", saved: "Saved. Auto top-up is on.", turnedOff: "Auto top-up is off. Your card stays saved.", removed: "Saved card removed.",
      waiting: "Card saved. Switching on auto top-up…", failed: "Your last top-up failed ({code}).", pausedFail: "Auto top-up was switched off after failed charges ({code}). Check your card, then turn it on again.",
      error: "Could not save right now. Please try again.", unavailable: "Auto top-up is not available yet.", confirmRemove: "Remove your saved card? Auto top-up will stop." },
    ru: { chip: "Автопополнение", on: "Вкл.", title: "Автопополнение", intro: "Не останавливайтесь посреди проекта. Когда кредитов станет меньше выбранного уровня, мы спишем с сохранённой карты выбранный пакет. Это не ежемесячная подписка: пока кредитов хватает, ничего не списывается. Не больше {max} пополнений в день.",
      pack: "Пакет", level: "Пополнять, когда кредитов меньше", turnOn: "Включить автопополнение", save: "Сохранить", off: "Выключить", remove: "Удалить карту", close: "Закрыть",
      note: "Карта сохраняется на защищённой странице Dodo Payments (международные карты). Ничего не списывается, пока кредиты не закончатся.", credits: "кредитов",
      saving: "Сохраняем…", opening: "Открываем безопасную оплату…", saved: "Сохранено. Автопополнение включено.", turnedOff: "Автопополнение выключено. Карта остаётся сохранённой.", removed: "Сохранённая карта удалена.",
      waiting: "Карта сохранена. Включаем автопополнение…", failed: "Последнее пополнение не прошло ({code}).", pausedFail: "Автопополнение выключено после неудачных списаний ({code}). Проверьте карту и включите снова.",
      error: "Не удалось сохранить. Попробуйте ещё раз.", unavailable: "Автопополнение пока недоступно.", confirmRemove: "Удалить сохранённую карту? Автопополнение остановится." },
    hy: { chip: "Ավտոլիցքավորում", on: "Միացված", title: "Ավտոլիցքավորում", intro: "Մի կանգնեք նախագծի կեսին։ Երբ կրեդիտները իջնեն ընտրված մակարդակից, մենք պահպանված քարտից կգանձենք ընտրված փաթեթը։ Սա ամսական բաժանորդագրություն չէ․ քանի դեռ կրեդիտները բավարար են, ոչինչ չի գանձվում։ Օրական առավելագույնը {max} լիցքավորում։",
      pack: "Փաթեթ", level: "Լիցքավորել, երբ կրեդիտները պակաս են", turnOn: "Միացնել ավտոլիցքավորումը", save: "Պահպանել", off: "Անջատել", remove: "Հեռացնել քարտը", close: "Փակել",
      note: "Քարտը պահպանվում է Dodo Payments-ի անվտանգ էջում։ Ոչինչ չի գանձվում, մինչև կրեդիտները չնվազեն։", credits: "կրեդիտ",
      saving: "Պահպանում ենք…", opening: "Բացում ենք անվտանգ վճարումը…", saved: "Պահպանված է։ Ավտոլիցքավորումը միացված է։", turnedOff: "Ավտոլիցքավորումն անջատված է։ Քարտը մնում է պահպանված։", removed: "Պահպանված քարտը հեռացված է։",
      waiting: "Քարտը պահպանված է։ Միացնում ենք ավտոլիցքավորումը…", failed: "Վերջին լիցքավորումը չհաջողվեց ({code})։", pausedFail: "Ավտոլիցքավորումն անջատվել է անհաջող գանձումներից հետո ({code})։ Ստուգեք քարտը և նորից միացրեք։",
      error: "Չհաջողվեց պահպանել։ Փորձեք կրկին։", unavailable: "Ավտոլիցքավորումը դեռ հասանելի չէ։", confirmRemove: "Հեռացնե՞լ պահպանված քարտը։ Ավտոլիցքավորումը կդադարի։" }
  };
  function T() {
    var lang = String(document.documentElement.lang || "en").slice(0, 2);
    if (lang === "am") lang = "hy";
    return TEXT[lang] || TEXT.en;
  }

  var state = null;
  var chip = null;
  var modal = null;

  function client() {
    if (window.__HANSORA_SB__) return window.__HANSORA_SB__;
    if (window.supabase && window.supabase.createClient) return (window.__HANSORA_SB__ = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
    return null;
  }
  async function token() {
    var sb = client();
    if (!sb || !sb.auth) return "";
    var res = await sb.auth.getSession();
    return (res && res.data && res.data.session && res.data.session.access_token) || "";
  }
  async function call(method, body) {
    var t = await token();
    if (!t) throw new Error("missing_session");
    var headers = { Authorization: "Bearer " + t };
    if (body) headers["Content-Type"] = "application/json";
    var res = await fetch("/.netlify/functions/auto-topup", { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || "auto_topup_failed");
    return json;
  }

  function injectStyles() {
    if (document.getElementById("autoTopupWidgetStyles")) return;
    var css = ""
      + ".atw-chip{margin-top:8px;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(167,139,250,.45);border-radius:999px;padding:6px 12px;background:rgba(139,92,246,.14);color:#fff;font-size:11px;font-weight:900;cursor:pointer;transition:background .16s}"
      + ".atw-chip:hover{background:rgba(139,92,246,.26)}"
      + ".atw-chip .atw-dot{width:7px;height:7px;border-radius:50%;background:rgba(226,232,240,.45)}"
      + ".atw-chip.is-on .atw-dot{background:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.2)}"
      + ".atw-row{display:block}"
      + ".atw-modal{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:16px}"
      + ".atw-modal.is-open{display:flex}"
      + ".atw-backdrop{position:absolute;inset:0;background:rgba(3,6,14,.72);backdrop-filter:blur(6px)}"
      + ".atw-panel{position:relative;width:100%;max-width:460px;max-height:calc(100vh - 32px);overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:20px;background:linear-gradient(180deg,#151326,#0d0c18);color:#fff;padding:22px;text-align:left;box-shadow:0 30px 80px rgba(0,0,0,.5)}"
      + ".atw-panel h3{margin:0 0 8px;font-size:20px;font-weight:800}"
      + ".atw-panel p{margin:0;font-size:13px;line-height:1.5;color:rgba(255,255,255,.75)}"
      + ".atw-x{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font-size:18px;cursor:pointer}"
      + ".atw-panel label{display:block;margin-top:14px;font-size:12px;color:rgba(255,255,255,.7)}"
      + ".atw-panel select{display:block;width:100%;margin-top:6px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.35);color:#fff;padding:10px 12px;font-size:14px}"
      + ".atw-note{margin-top:12px!important;font-size:12px!important;color:rgba(255,255,255,.55)!important}"
      + ".atw-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:18px}"
      + ".atw-primary{border:0;border-radius:12px;padding:10px 16px;font-weight:800;font-size:14px;color:#fff;background:linear-gradient(90deg,#8b5cf6,#0ea5e9);cursor:pointer}"
      + ".atw-secondary{border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:10px 16px;font-size:14px;color:#fff;background:transparent;cursor:pointer}"
      + ".atw-link{border:0;background:none;color:rgba(255,255,255,.65);font-size:12px;text-decoration:underline;cursor:pointer;padding:0}"
      + ".atw-panel button:disabled{opacity:.55;cursor:default}"
      + ".atw-msg{margin-top:12px!important;min-height:1em}"
      + ".atw-msg.is-error{color:#fca5a5!important}";
    var style = document.createElement("style");
    style.id = "autoTopupWidgetStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderChip() {
    var t = T();
    var on = Boolean(state && state.settings && state.settings.enabled);
    chip.classList.toggle("is-on", on);
    chip.innerHTML = '<span class="atw-dot" aria-hidden="true"></span>🔁 ' + t.chip + (on ? " · " + t.on : "");
  }

  function buildModal() {
    modal = document.createElement("div");
    modal.className = "atw-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<div class="atw-backdrop" data-atw-close></div>'
      + '<section class="atw-panel" role="dialog" aria-modal="true" aria-labelledby="atwTitle">'
      + '<button type="button" class="atw-x" data-atw-close>×</button>'
      + '<h3 id="atwTitle"></h3><p data-atw="intro"></p>'
      + '<label><span data-atw="packLabel"></span><select data-atw="pack"></select></label>'
      + '<label><span data-atw="levelLabel"></span><select data-atw="level"></select></label>'
      + '<p class="atw-note" data-atw="note"></p>'
      + '<div class="atw-actions"><button type="button" class="atw-primary" data-atw="save"></button>'
      + '<button type="button" class="atw-secondary" data-atw="off" hidden></button>'
      + '<button type="button" class="atw-link" data-atw="remove" hidden></button></div>'
      + '<p class="atw-msg" data-atw="msg" role="status" aria-live="polite"></p>'
      + '</section>';
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-atw-close]").forEach(function (el) { el.addEventListener("click", close); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    el("save").addEventListener("click", function () {
      act({ action: "setup", pack_credits: Number(el("pack").value), threshold_credits: Number(el("level").value), return_path: location.pathname }, T().saved);
    });
    el("off").addEventListener("click", function () { act({ action: "off" }, T().turnedOff); });
    el("remove").addEventListener("click", function () { if (window.confirm(T().confirmRemove)) act({ action: "remove_card" }, T().removed); });
  }
  function el(name) { return modal.querySelector('[data-atw="' + name + '"]'); }
  function message(text, isError) {
    var m = el("msg");
    m.textContent = text || "";
    m.classList.toggle("is-error", Boolean(isError));
  }

  function renderModal() {
    var t = T();
    var s = state.settings || {};
    var fmt = function (n) { return Number(n * 10).toLocaleString(); };
    modal.querySelector("#atwTitle").textContent = t.title;
    modal.querySelector(".atw-x").setAttribute("aria-label", t.close);
    el("intro").textContent = t.intro.replace("{max}", state.max_per_day || 3);
    el("packLabel").textContent = t.pack;
    el("levelLabel").textContent = t.level;
    el("pack").innerHTML = (state.packs || []).map(function (p) { return '<option value="' + p.credits + '">' + fmt(p.credits) + " " + t.credits + " — $" + (p.amount_cents / 100).toFixed(2) + "</option>"; }).join("");
    el("pack").value = String(s.pack_credits);
    el("level").innerHTML = (state.thresholds || []).map(function (v) { return '<option value="' + v + '">' + fmt(v) + " " + t.credits + "</option>"; }).join("");
    el("level").value = String(s.threshold_credits);
    el("note").textContent = t.note;
    el("note").hidden = Boolean(s.card_saved);
    el("save").textContent = s.enabled ? t.save : t.turnOn;
    el("save").disabled = !state.available;
    el("off").textContent = t.off;
    el("off").hidden = !s.enabled;
    el("remove").textContent = t.remove;
    el("remove").hidden = !s.card_saved;
    if (!state.available) message(t.unavailable);
    else if (!s.enabled && s.card_saved && s.last_error && s.failures) message(t.pausedFail.replace("{code}", s.last_error), true);
    else if (s.enabled && s.last_error) message(t.failed.replace("{code}", s.last_error), true);
    else message("");
  }

  function open() {
    if (!modal) buildModal();
    renderModal();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function close() {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  async function act(body, doneText) {
    var t = T();
    var buttons = [el("save"), el("off"), el("remove")];
    buttons.forEach(function (b) { b.disabled = true; });
    message(t.saving);
    try {
      var next = await call("POST", body);
      if (next.checkout_url) { message(t.opening); location.href = next.checkout_url; return; }
      state = next;
      renderModal();
      renderChip();
      message(doneText);
    } catch (error) {
      message(error.message === "auto_topup_unavailable" ? t.unavailable : t.error, true);
    } finally {
      buttons.forEach(function (b) { b.disabled = false; });
      if (state && !state.available) el("save").disabled = true;
    }
  }

  async function start() {
    var toggle = document.querySelector(".payment-method-box .payment-method-toggle");
    if (!toggle) return;
    // Wait (briefly, in the background) for the page's Supabase library; nothing on the page waits for this.
    for (var i = 0; i < 20 && !client(); i++) await new Promise(function (r) { setTimeout(r, 250); });
    if (!(await token().catch(function () { return ""; }))) return;
    try { state = await call("GET"); } catch (_) { return; }
    if (!state || !state.has_purchase) return;
    injectStyles();
    var row = document.createElement("div");
    row.className = "atw-row";
    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "atw-chip";
    chip.addEventListener("click", open);
    row.appendChild(chip);
    toggle.insertAdjacentElement("afterend", row);
    renderChip();
    // pricing.html switches between English and Russian with the card switch: keep the label in step.
    new MutationObserver(function () { renderChip(); if (modal && modal.classList.contains("is-open")) renderModal(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

    // Back from the card-saving checkout: the webhook switches it on within a few seconds.
    if (new URLSearchParams(location.search).get("auto_topup") === "saved") {
      var params = new URLSearchParams(location.search);
      params.delete("auto_topup");
      history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
      open();
      for (var n = 0; n < 10 && !(state.settings && state.settings.enabled); n++) {
        message(T().waiting);
        await new Promise(function (r) { setTimeout(r, 3000); });
        try { state = await call("GET"); } catch (_) {}
      }
      renderModal();
      renderChip();
      if (state.settings && state.settings.enabled) message(T().saved);
    }
  }

  function later() {
    var go = function () { start().catch(function () {}); };
    if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 2000 });
    else setTimeout(go, 300);
  }
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later);
})();
