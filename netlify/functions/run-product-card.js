// netlify/functions/run-product-card.js
// HANSORA Product Selling Card launcher via KIE GPT Image 2.0 createTask.
// New standalone feature file. Does not modify existing search-models or GPT Image files.
// Credits: 1 for 1K/2K, 1.5 for 4K. Server-side debit only, idempotent per run_id.

const CREATE_URL = process.env.KIE_CREATE_URL || "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY || "";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SITE_BASE = (process.env.SITE_BASE || "https://hansora.co").replace(/\/+$/, "");
const CALLBACK_URL = `${SITE_BASE}/.netlify/functions/product-card-check`;

const VERSION_TAG = "product_card_gpt_image_2_v2";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(body),
  };
}

function getHeader(event, key) {
  return event.headers?.[key] || event.headers?.[key.toLowerCase()] || event.headers?.[key.toUpperCase()] || null;
}

function getUID(event, body) {
  const qs = new URLSearchParams(event.queryStringParameters || {});
  return ((getHeader(event, "x-user-id") || "") || (body && (body.uid || "")) || (qs.get("uid") || "")).trim();
}

async function getUidFromBearer(event) {
  const auth = (getHeader(event, "authorization") || "").trim();
  if (!auth) return "";
  const match = auth.match(/Bearer\s+(.+)/i);
  if (!match) return "";
  const token = (match[1] || "").trim();
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return "";
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return "";
    const user = await res.json().catch(() => null);
    return (user && (user.id || user.user?.id) ? String(user.id || user.user.id) : "").trim();
  } catch (_error) {
    return "";
  }
}

function cleanText(value, max = 300) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanList(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/\n|;|•|,/g);
  return raw.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 6);
}

function cleanFeatureList(body) {
  const values = [
    body.benefits,
    body.features,
    body.feature,
    body.benefit,
    body.feature_text,
    body.featureText,
    body.benefit_text,
    body.benefitText,
    body.feature_1,
    body.feature_2,
    body.feature_3,
    body.feature_4,
    body.feature_5,
    body.benefit_1,
    body.benefit_2,
    body.benefit_3,
    body.benefit_4,
    body.benefit_5,
  ];
  const seen = new Set();
  const items = [];
  for (const value of values) {
    for (const item of cleanList(value)) {
      const key = item.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
      }
      if (items.length >= 6) return items;
    }
  }
  return items;
}

function detectCopyScriptRule(parts) {
  const text = parts.filter(Boolean).join(" ").trim();
  if (!text) {
    return {
      label: "English fallback",
      rule: "No headline or feature language was provided, so all generated card text must be simple English/Latin only.",
      forbidden: "Do not add Chinese, Japanese, Korean, Cyrillic/Russian, Arabic, Armenian, Hindi, Thai, or any other non-English/non-Latin text."
    };
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return {
      label: "Chinese/Hanzi",
      rule: "All generated card text must stay in Chinese/Hanzi exactly as supplied by the user. Do not translate it.",
      forbidden: "Do not add English, Russian, Arabic, Japanese kana, Korean, or any other language unless it was typed by the user."
    };
  }
  if (/[\u3040-\u30ff]/.test(text)) {
    return {
      label: "Japanese",
      rule: "All generated card text must stay in Japanese exactly as supplied by the user. Do not translate it.",
      forbidden: "Do not add English, Chinese-only marketing text, Korean, Russian, Arabic, or any other language unless it was typed by the user."
    };
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    return {
      label: "Korean",
      rule: "All generated card text must stay in Korean exactly as supplied by the user. Do not translate it.",
      forbidden: "Do not add English, Chinese, Japanese, Russian, Arabic, or any other language unless it was typed by the user."
    };
  }
  if (/[\u0400-\u04ff]/.test(text)) {
    return {
      label: "Cyrillic/Russian",
      rule: "All generated card text must stay in Cyrillic/Russian exactly as supplied by the user. Do not translate it.",
      forbidden: "Do not add English, Chinese, Japanese, Korean, Arabic, or any other language unless it was typed by the user."
    };
  }
  if (/[\u0600-\u06ff]/.test(text)) {
    return {
      label: "Arabic",
      rule: "All generated card text must stay in Arabic exactly as supplied by the user. Do not translate it.",
      forbidden: "Do not add English, Chinese, Japanese, Korean, Russian, or any other language unless it was typed by the user."
    };
  }
  if (/[\u0530-\u058f]/.test(text)) {
    return {
      label: "Armenian",
      rule: "All generated card text must stay in Armenian exactly as supplied by the user. Any extra small design text must also be Armenian.",
      forbidden: "Do not add English, Chinese, Japanese, Korean, Russian, Arabic, or any other language unless it was typed by the user."
    };
  }
  if (/[A-Za-z]/.test(text)) {
    return {
      label: "Latin-script user language",
      rule: "The user typed Latin letters in the headline/features. All generated card text must use that same Latin-script language. For example, if the user typed 'perfect smell', the card text must be English/Latin only.",
      forbidden: "Never add Chinese characters. Never add Japanese, Korean, Cyrillic/Russian, Arabic, Hindi, Thai, or any non-Latin script anywhere on the card unless that script was typed in the user's headline/features."
    };
  }
  return {
    label: "user-provided script",
    rule: "All generated card text must use only the same language/script typed by the user. User-provided text should appear exactly as typed; any extra small design text must stay in that same language/script.",
    forbidden: "Do not add any other language or random foreign-language text."
  };
}

function generatedCopyLanguage(scriptRule) {
  if (!scriptRule || scriptRule.label === "English fallback") {
    return "English/Latin";
  }
  if (scriptRule.label === "Latin-script user language") return "the same Latin-script language as the user's headline/features";
  return scriptRule.label;
}

function languageLockBlock(scriptRule) {
  const isFallback = !scriptRule || scriptRule.label === "English fallback";
  const isLatin = scriptRule && scriptRule.label === "Latin-script user language";
  if (isFallback) {
    return [
      "The user did NOT type any headline or feature text.",
      "Write 100% of the card text in ENGLISH, using only Latin letters (A-Z), numbers, and standard punctuation.",
      "Use real, correctly spelled English words only. Do not use Chinese characters or any other non-Latin script.",
      "Ignore the language printed on the product, packaging, label, logo, or photo when choosing the text language — it stays English regardless.",
    ];
  }
  if (isLatin) {
    return [
      "The user typed the headline/features in a Latin-script language (for example English).",
      "Write 100% of the card text in that SAME language, using only Latin letters.",
      "Use real, correctly spelled words in that language only. Do not use Chinese characters or any other non-Latin script.",
      "Ignore the language printed on the product, packaging, label, logo, or photo when choosing the text language.",
    ];
  }
  return [
    `The user typed the headline/features in ${scriptRule.label}.`,
    `Write 100% of the generated and missing card text in ${scriptRule.label}, matching the user's language exactly.`,
    "Do not translate the user's text and do not switch generated text to another language.",
  ];
}

function languageRulesBlock(scriptRule, generatedLanguage) {
  const isFallback = !scriptRule || scriptRule.label === "English fallback";
  const isLatin = scriptRule && scriptRule.label === "Latin-script user language";
  const common = [
    "Do not add a second language, bilingual subtitle, or foreign-language decorative tagline.",
    "Leave blank or clean design space rather than filling it with wrong-language text.",
    "Real text already printed on the uploaded product may stay as-is; do not invent new packaging or logo text.",
  ];
  if (isFallback) {
    return [
      "All generated text (headline, features, badges, footer, any small label) must be English / Latin only.",
      ...common,
    ];
  }
  if (isLatin) {
    return [
      `All generated text (headline, features, badges, footer, any small label) must use ${generatedLanguage}.`,
      "Preserve the user's exact spelling, capitalization, and punctuation; do not translate their text.",
      ...common,
    ];
  }
  return [
    `All generated and missing text must use ${scriptRule.label} only, matching the user's language.`,
    "Preserve the user's exact script, spelling, and punctuation; do not translate their text.",
    ...common,
  ];
}

function normalizeAspectRatio(value) {
  if (!value) return "1:1";
  const s = String(value).trim().toLowerCase();
  const allowed = new Set(["1:1", "4:5", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2"]);
  const coerced = s.replace(/(\d)[_\-:](\d)/g, "$1:$2");
  return allowed.has(coerced) ? coerced : "1:1";
}

function normalizeResolution(value, aspectRatio) {
  let resolution = String(value || "1K").trim().toUpperCase();
  if (!["1K", "2K", "4K"].includes(resolution)) resolution = "1K";
  if (aspectRatio === "1:1" && resolution === "4K") return "2K";
  return resolution;
}

function normalizeChoice(value, allowed, fallback) {
  const s = cleanText(value, 60).toLowerCase();
  return allowed.has(s) ? s : fallback;
}

function productTypeGuide(type) {
  const guides = {
    auto: "First analyze the uploaded product photo and infer the correct product category before designing. Do not assume it is a bottle, supplement, clothing, cosmetic, food, electronics, or home product unless the image supports that category.",
    clothing_shoes: "Fashion logic: show fabric, silhouette, fit, texture, stitching, material, sole or garment shape. Do not use supplement facts, nutrition icons, droplets, pills, or medical badges.",
    bottle_liquid: "Bottle/liquid logic: make the bottle or liquid container the hero object, keep label readable, add clean splash/ingredient/refreshing visual accents only when they match the product.",
    supplement: "Supplement/wellness logic: keep packaging label readable, use clean benefit callouts and ingredient-style accents. Do not add fake FDA, doctor, lab, flag, certification, cure, disease-treatment, or medical guarantee claims.",
    cosmetic: "Beauty/skincare logic: use soft premium beauty lighting, cream/serum texture accents, clean skin-care mood, label-readable hero packaging. Do not create supplement facts or electronics-style callouts.",
    food: "Food logic: appetizing product-card layout with relevant ingredients, freshness cues, serving mood and clean packaging. Do not add pills, medical claims, tech UI, or unrelated human fitness props.",
    electronics: "Electronics logic: show device shape, screen/details, feature callouts, precise highlights, modern tech background. Do not add food splashes, supplement badges, or beauty props.",
    home: "Home product logic: place the product in a clean realistic interior or studio setting, emphasize material, scale, comfort, build, and lifestyle context. Do not use supplement/food/beauty graphics.",
    other: "General physical product logic: infer the product function from the photo, keep the product identity accurate, and build a clean high-converting card around its real visual category.",
  };
  return guides[type] || guides.auto;
}

function styleGuide(style) {
  const guides = {
    amazon: "Ecommerce marketplace card: clean, bright, readable, strong product hero, short feature bullets with small icons, white or light premium background. Do not add an Amazon logo unless it is explicitly uploaded or typed by the user.",
    instagram: "Social media ad poster: bold composition, high contrast, modern shapes, premium gradients, strong headline hierarchy, scroll-stopping but still clean and readable.",
    premium: "Premium luxury card: expensive lighting, refined typography, soft shadows, elegant spacing, minimal but high-end commercial layout.",
    clean: "Clean white ecommerce card: product-first, polished white/light background, subtle shadows, simple callouts, high clarity, no clutter.",
    dark: "Dark dramatic product ad: deep background, cinematic rim light, glowing accent shapes, premium contrast, readable text hierarchy.",
    fitness: "Fitness/performance card: energetic, athletic composition, bold type, performance-style callouts, dynamic but clean. Use human only if requested.",
    beauty: "Beauty/skincare card: soft luminous background, elegant cosmetic mood, smooth gradients, refined type, gentle premium product photography.",
  };
  return guides[style] || guides.amazon;
}

function humanGuide(mode) {
  const guides = {
    none: "Strict no-human mode: do not show any human, hands, faces, arms, legs, body parts, silhouettes, mannequins, or people-like figures. The product must remain the only hero subject with graphic callouts and a polished ad-card layout.",
    holding: "With-human mode is mandatory. The final image is invalid if it looks like no-human mode. You must visibly include a highly realistic, natural human presence that fits the exact product: real-looking skin, natural anatomy, believable hands/feet/body posture, correct scale, realistic lighting, and no mannequin/plastic/fake model look. First identify the product category, then choose the correct human interaction: shoes should be worn on realistic feet/legs or held naturally by realistic hands, clothing should be worn by a realistic model or held to show fabric/fit, bags/accessories should be held/worn/carried by a realistic person, bottles/cosmetics/supplements should be held in realistic hands, food can be held or placed near a natural lifestyle human context, electronics can be held/used. Keep the product dominant, fully visible, label-readable, and not replaced. Do not cover important logos, labels, shape, or product details. Do not create a product-only card when with-human mode is selected.",
    using: "Include a realistic human using the product in a believable way for its category. Keep the product clear, recognizable, and visually dominant.",
    beside: "Include a realistic human positioned beside or behind the product as a supporting lifestyle element. The product remains the main subject.",
  };
  return guides[mode] || guides.none;
}

function buildProductCardPrompt(body) {
  const allowedTypes = new Set(["auto", "clothing_shoes", "bottle_liquid", "supplement", "cosmetic", "food", "electronics", "home", "other"]);
  const allowedStyles = new Set(["amazon", "instagram", "premium", "clean", "dark", "fitness", "beauty"]);
  const allowedHuman = new Set(["none", "holding", "using", "beside"]);

  const productType = normalizeChoice(body.product_type, allowedTypes, "auto");
  const cardStyle = normalizeChoice(body.card_style, allowedStyles, "amazon");
  const humanMode = normalizeChoice(body.human_mode, allowedHuman, "none");

  const brandName = cleanText(body.brand_name, 80);
  const headline = cleanText(body.headline, 90);
  const subheadline = cleanText(body.subheadline, 120);
  const cta = cleanText(body.cta, 60);
  const extraNotes = cleanText(body.extra_notes, 300);
  const benefits = cleanFeatureList(body);
  const scriptRule = detectCopyScriptRule([headline, ...benefits]);
  const generatedLanguage = generatedCopyLanguage(scriptRule);
  const needsGeneratedHeadline = !headline;
  const needsGeneratedBenefits = benefits.length === 0;

  const textLines = [];
  if (brandName) textLines.push(`Brand name text exactly as typed: "${brandName}"`);
  if (headline) textLines.push(`Main headline text exactly as typed: "${headline}"`);
  else textLines.push(`Main headline is missing: generate one short product-related headline in ${generatedLanguage} only.`);
  if (subheadline) textLines.push(`Subheadline text exactly as typed: "${subheadline}"`);
  if (benefits.length) textLines.push(`Benefit/feature callout text exactly as typed, use up to 5: ${benefits.map((b) => `"${b}"`).join(", ")}`);
  else textLines.push(`Features are missing: generate 2-4 short product-related feature callouts in ${generatedLanguage} only.`);
  if (cta) textLines.push(`Call-to-action text exactly as typed: "${cta}"`);

  const prompt = `
LANGUAGE LOCK — HIGHEST PRIORITY RULE, READ AND OBEY THIS BEFORE ANYTHING ELSE:
${languageLockBlock(scriptRule).map((line) => `- ${line}`).join("\n")}
- This applies to EVERY visible text area: headline, subheadline, feature/benefit callouts, icon labels, badges, footer, captions, taglines, separators, and any small decorative typography.
- If any generated text appears in the wrong language (especially Chinese when the user did not type Chinese), the image is INVALID and must be redone in the correct language.

Create one high-converting product selling card from the uploaded product photo.

CRITICAL PRODUCT UNDERSTANDING:
- First analyze every uploaded reference image carefully. Identify what the product actually is before designing.
- Use the uploaded image(s) as the only source of truth for product identity.
- Automatically adapt the layout, props, accents, typography style, and selling-card composition to the exact product category you see.
- Never assume the product is a bottle, supplement, cosmetic, clothing item, or any other category unless the uploaded image proves it.
- Preserve the real product identity: shape, color, packaging, label, logo placement, cap/closure, material, texture, proportions, construction details, and distinctive markings.
- If multiple references are provided, treat them as the same product from different angles/details. Combine them only to preserve the correct identity. Do not create a collage or copy a reference-sheet layout.
- Do not replace the product with a different item. Do not turn shoes into a bottle, clothing into supplements, cosmetics into food, furniture into electronics, or any other wrong category.

CATEGORY LOGIC:
${productTypeGuide(productType)}

CARD STYLE:
${styleGuide(cardStyle)}

HUMAN / LIFESTYLE RULE:
${humanGuide(humanMode)}

TEXT TO RENDER ON THE CARD:
${textLines.map((line) => `- ${line}`).join("\n")}

TEXT LANGUAGE (decided ONLY from the user's headline and features — detected: ${scriptRule.label}):
${languageRulesBlock(scriptRule, generatedLanguage).map((line) => `- ${line}`).join("\n")}
- Brand name, CTA, subheadline, extra notes, product-label text, image content, and app/market locale must NOT change the language of generated text.

TEXT ACCURACY RULES:
- Render the user-provided text listed above as the primary card text: large, readable, correctly spelled, and cleanly placed.
- Keep generated copy short and product-related. If there is too much text, prioritize brand, headline, 3 best benefits, CTA, and drop filler.
- Do not invent random claims, prices, fake ratings, fake reviews, fake discounts, fake official logos, fake certifications, medical authority badges, flag badges, marketplace logos, legal seals, QR codes, watermarks, or extra brand names.

DESIGN REQUIREMENTS:
- Build a polished commercial ad card, not a plain product cutout and not a raw background-removal result.
- Strong visual hierarchy: hero product first, headline second, benefits third, CTA last.
- Add category-appropriate graphic accents only: icons, soft shapes, ingredient cues, material closeups, lifestyle elements, or feature callout lines.
- For shoes: emphasize silhouette, sole, material, stitching, texture, comfort/performance, and fashion context.
- For hoodies/clothing: emphasize garment shape, fabric, fit, texture, seams, and lifestyle/fashion mood.
- For bottles/creams/supplements/snacks: preserve package label and shape, use only category-appropriate accents.
- For phones/electronics: emphasize device details, screen/body, technical precision, and modern feature callouts.
- For furniture/home/accessories: emphasize scale, material, use context, comfort, build, and realistic environment.
- Keep the product clean, sharp, centered or intentionally composed, with realistic lighting and premium shadows.
- Leave comfortable safe margins around the product and important text. The product must not touch or be cropped by the image edges; keep at least 8-12% breathing room unless the product is intentionally and professionally cropped without losing identity.
- Avoid clutter, distorted product geometry, broken labels, bad typography, misspelled words, repeated letters, watermarks, QR codes, stock image marks, messy backgrounds, and unrelated props.
- Make the final image look like a professional Amazon/ecommerce/social product ad card ready for selling.
${extraNotes ? `\nEXTRA USER NOTES:\n- ${extraNotes}` : ""}

FINAL LANGUAGE CHECK BEFORE YOU RENDER (DO NOT SKIP):
- Re-read every text element you placed on the card.
- Confirm 100% of it is written in ${generatedLanguage}.
- ${languageLockBlock(scriptRule)[1] || languageLockBlock(scriptRule)[0]}
- If any character is in the wrong language, delete it and rewrite it in ${generatedLanguage} before finishing.
`.trim();

  return { prompt, productType, cardStyle, humanMode, copy: { brandName, headline, subheadline, benefits, cta, extraNotes } };
}

async function fetchUserGenByRunId(uid, runId) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !runId) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,meta,provider,kind,prompt,result_url,created_at&limit=1`;
    const res = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (_error) {
    return null;
  }
}

async function seedUserGeneration(uid, runId, prompt, provider, metaExtra) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { row_id: null };
  try {
    const meta = { source: "product-card", run_id: runId, model: "gpt-image-2", status: "pending", ...(metaExtra || {}) };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_generations`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ user_id: uid, provider, kind: "image", prompt, result_url: null, meta }),
    });
    if (!res.ok) return { row_id: null };
    const rows = await res.json().catch(() => null);
    return { row_id: Array.isArray(rows) && rows[0]?.id ? rows[0].id : null };
  } catch (_error) {
    return { row_id: null };
  }
}

async function patchUserGenerationMetaById(id, meta) {
  if (!SUPABASE_URL || !SERVICE_KEY || !id) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ meta }),
    });
    return !!res.ok;
  } catch (_error) {
    return false;
  }
}

async function debitCredits(uid, cost) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid) return { ok: false, error: "missing_env_or_uid" };
  try {
    const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits&limit=1`;
    const res0 = await fetch(profileUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!res0.ok) return { ok: false, error: "profile_fetch_failed", status: res0.status };
    const rows = await res0.json().catch(() => null);
    const current = Array.isArray(rows) && rows[0] && typeof rows[0].credits === "number" ? rows[0].credits : 0;
    if (current < cost) return { ok: false, error: "insufficient_credits", credits: current };
    const next = Math.max(0, Math.round((current - cost) * 100) / 100);
    const res1 = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ credits: next }),
    });
    if (!res1.ok) return { ok: false, error: "profile_update_failed", status: res1.status };
    return { ok: true, credits: next };
  } catch (error) {
    return { ok: false, error: "server_exception", details: String(error && error.message || error) };
  }
}

async function chargeOnceForRun(uid, runId, cost, rowId, baseMeta) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !runId) {
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent: false, already: false };
  }

  try {
    const existing = await fetchUserGenByRunId(uid, runId);
    const meta0 = existing?.meta || baseMeta || {};
    if (String(meta0?.charged || "").toLowerCase() === "true") {
      return { ok: true, debit: { ok: true, credits: null }, idempotent: true, already: true };
    }

    const claim = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mergedForClaim = { ...(meta0 || {}), ...(baseMeta || {}), charge_claim: claim };
    const claimUrl = `${SUPABASE_URL}/rest/v1/user_generations?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&meta->>charged=is.null&meta->>charge_claim=is.null&select=id`;
    const claimRes = await fetch(claimUrl, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ meta: mergedForClaim }),
    });
    const claimedRows = await claimRes.json().catch(() => []);
    const claimed = claimRes.ok && Array.isArray(claimedRows) && claimedRows.length > 0;

    if (!claimed) {
      const after = await fetchUserGenByRunId(uid, runId);
      if (String(after?.meta?.charged || "").toLowerCase() === "true") {
        return { ok: true, debit: { ok: true, credits: null }, idempotent: true, already: true };
      }
      return { ok: false, error: "charge_in_progress", idempotent: true, already: false };
    }

    const debit = await debitCredits(uid, cost);
    if (!debit.ok) {
      const rollbackMeta = { ...(mergedForClaim || {}) };
      delete rollbackMeta.charge_claim;
      await patchUserGenerationMetaById(rowId || claimedRows[0]?.id || existing?.id, rollbackMeta);
      return { ok: false, debit, idempotent: true, already: false };
    }

    const chargedMeta = { ...(mergedForClaim || {}), charged: "true", charged_cost: cost, charged_at: new Date().toISOString(), refund_amount: cost };
    await patchUserGenerationMetaById(rowId || claimedRows[0]?.id || existing?.id, chargedMeta);
    return { ok: true, debit, idempotent: true, already: false };
  } catch (error) {
    const debit = await debitCredits(uid, cost);
    return { ok: !!debit.ok, debit, idempotent: false, already: false, error: String(error && error.message || error) };
  }
}

async function refundChargedRunOnce(uid, runId, rowId, amount, reason, baseMeta) {
  if (!SUPABASE_URL || !SERVICE_KEY || !uid || !runId || !rowId || !Number.isFinite(amount) || amount <= 0) {
    return { refunded: false, amount: 0, reason: "missing_refund_context" };
  }

  try {
    const existing = await fetchUserGenByRunId(uid, runId);
    const meta = existing?.meta || baseMeta || {};
    if (String(meta?.refunded || "").toLowerCase() === "true") {
      return { refunded: false, amount, already_refunded: true };
    }
    if (String(meta?.charged || "").toLowerCase() !== "true") {
      await patchUserGenerationMetaById(rowId, { ...(meta || {}), status: reason, failed: true, error: reason });
      return { refunded: false, amount, reason: "not_charged" };
    }

    const claim = `rr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const claimMeta = { ...(meta || {}), status: reason, failed: true, error: reason, refund_claim: claim };
    const claimUrl = `${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`;
    const claimRes = await fetch(claimUrl, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ meta: claimMeta }),
    });
    const claimedRows = await claimRes.json().catch(() => []);
    if (!claimRes.ok || !Array.isArray(claimedRows) || !claimedRows.length) {
      return { refunded: false, amount, already_claimed: true };
    }

    const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits&limit=1`;
    const res0 = await fetch(profileUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const rows = await res0.json().catch(() => null);
    const current = Array.isArray(rows) && rows[0] && typeof rows[0].credits === "number" ? rows[0].credits : 0;
    const next = Math.round((current + amount) * 100) / 100;
    const res1 = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ credits: next }),
    });
    if (!res1.ok) {
      await patchUserGenerationMetaById(rowId, { ...claimMeta, refund_error: "profile_refund_failed" });
      return { refunded: false, amount, error: "profile_refund_failed" };
    }

    await patchUserGenerationMetaById(rowId, {
      ...claimMeta,
      refunded: true,
      refunded_cost: amount,
      refunded_at: new Date().toISOString(),
    });
    return { refunded: true, amount, credits: next };
  } catch (error) {
    return { refunded: false, amount, error: String(error && error.message || error) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { ...cors() }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method_not_allowed", version: VERSION_TAG });
  if (!API_KEY) return json(500, { ok: false, error: "missing_kie_key", version: VERSION_TAG });

  try {
    const body = JSON.parse(event.body || "{}");

    let uid = getUID(event, body);
    if (!uid || uid === "anon") {
      const bearerUid = await getUidFromBearer(event);
      if (bearerUid) uid = bearerUid;
    }
    if (!uid) return json(401, { ok: false, error: "missing_user", version: VERSION_TAG });

    const runId = String(body.run_id || body.runId || `product-card-${uid}-${Date.now()}`);
    const aspectRatio = normalizeAspectRatio(body.aspect_ratio || body.aspectRatio || body.size);
    const resolution = normalizeResolution(body.resolution, aspectRatio);
    const cost = resolution === "4K" ? 1.5 : 1;

    const urls = Array.isArray(body.urls) ? body.urls : (Array.isArray(body.input_urls) ? body.input_urls : []);
    const inputUrls = urls.map((url) => String(url || "").trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 5);
    if (!inputUrls.length) return json(400, { ok: false, error: "missing_product_image", version: VERSION_TAG });

    const built = buildProductCardPrompt(body);
    const provider = "Product Selling Card";
    const metaBase = {
      source: "product-card",
      run_id: runId,
      model: "gpt-image-2-image-to-image",
      status: "pending",
      aspect_ratio: aspectRatio,
      resolution,
      card_style: built.cardStyle,
      product_type: built.productType,
      human_mode: built.humanMode,
      copy: built.copy,
      input_url: inputUrls[0],
      input_urls: inputUrls,
      refund_amount: cost,
    };

    const seeded = await seedUserGeneration(uid, runId, built.prompt, provider, metaBase);
    const rowId = seeded?.row_id || null;

    const charged = await chargeOnceForRun(uid, runId, cost, rowId, metaBase);
    if (!charged.ok) {
      await patchUserGenerationMetaById(rowId, {
        ...metaBase,
        status: charged.debit?.error === "insufficient_credits" ? "insufficient_credits" : "charge_failed",
        failed: true,
        error: charged.debit?.error || charged.error || "charge_failed",
      });
      if (charged.debit && charged.debit.error === "insufficient_credits") {
        return json(402, { ok: false, error: "not_enough_credits", details: charged.debit, version: VERSION_TAG });
      }
      if (charged.error === "charge_in_progress") return json(409, { ok: false, error: "charge_in_progress", version: VERSION_TAG });
      return json(500, { ok: false, error: "charge_failed", details: charged.debit || charged.error || charged, version: VERSION_TAG });
    }

    const callback = `${CALLBACK_URL}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(runId)}`;
    const payload = {
      model: "gpt-image-2-image-to-image",
      callBackUrl: callback,
      input: {
        prompt: built.prompt,
        input_urls: inputUrls,
        aspect_ratio: aspectRatio,
        resolution,
        output_format: "png",
      },
    };

    const create = await fetch(CREATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await create.text();
    let responseJson;
    try { responseJson = JSON.parse(text); } catch { responseJson = { raw: text }; }

    const taskId = responseJson?.data?.taskId || responseJson?.taskId || responseJson?.data?.id || responseJson?.id || null;
    if (!create.ok || !taskId) {
      const refund = await refundChargedRunOnce(uid, runId, rowId, cost, "create_failed", { ...metaBase, raw: responseJson });
      return json(create.status || 500, {
        ok: false,
        error: "create_failed",
        status: create.status,
        response: responseJson,
        refunded: !!refund.refunded,
        credits_remaining: refund.credits ?? charged.debit?.credits ?? null,
        version: VERSION_TAG,
      });
    }

    const chargedRow = await fetchUserGenByRunId(uid, runId);
    const chargedMeta = chargedRow?.meta && typeof chargedRow.meta === "object" ? chargedRow.meta : {
      ...metaBase,
      charged: "true",
      charged_cost: cost,
      refund_amount: cost,
    };
    const processingMeta = { ...chargedMeta, status: "processing", task_id: taskId };
    if (rowId && SUPABASE_URL && SERVICE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_generations?id=eq.${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ meta: processingMeta }),
      }).catch(() => {});
    }

    return json(201, {
      ok: true,
      id: taskId,
      taskId,
      run_id: runId,
      row_id: rowId,
      cost,
      credits_remaining: charged.debit?.credits ?? null,
      already_charged: !!charged.already,
      version: VERSION_TAG,
      used_callback: callback,
    });
  } catch (error) {
    return json(500, { ok: false, error: "exception", message: String(error && error.message || error), version: VERSION_TAG });
  }
};
