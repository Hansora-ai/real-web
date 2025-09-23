// netlify/functions/nb-diag.js
// One-click diagnostic for Supabase insert from Netlify

export const handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || "";
  const KEY = process.env.SUPABASE_SERVICE_KEY || "";

  const diag = {
    has_url: !!SUPABASE_URL,
    has_service_key: !!KEY,
    url_sample: SUPABASE_URL ? SUPABASE_URL.replace(/^(https?:\/\/)(.{8}).+$/, "$1$2…") : null,
  };

  if (!SUPABASE_URL || !KEY) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diag, null, 2),
    };
  }

  // Minimal test row (service key bypasses RLS)
  const row = {
    user_id: "00000000-0000-0000-0000-000000000000",
    run_id: "diag-" + Date.now(),
    task_id: "diag",
    image_url: "https://example.com/test.png",
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/nb_results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": KEY,
        "Authorization": `Bearer ${KEY}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify(row),
    });

    const text = await r.text().catch(() => "");
    diag.insert_status = r.status;
    diag.insert_text = text.slice(0, 500);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diag, null, 2),
    };
  } catch (e) {
    diag.insert_exception = String(e);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diag, null, 2),
    };
  }
};
