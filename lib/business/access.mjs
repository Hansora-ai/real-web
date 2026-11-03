export const OWNER_ID = "45c5cfc7-090e-491f-a304-05f863bbdf85";
export const INTERNAL_IDS = [OWNER_ID, "a1102230-2b84-49e4-8452-4a6b650de87a"];

export async function requireOwner(
  event,
  { fetcher = fetch, env = process.env } = {},
) {
  const token = String(
    event.headers?.authorization || event.headers?.Authorization || "",
  ).match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token)
    throw Object.assign(
      new Error("Please sign in with your Hansora owner account."),
      { status: 401 },
    );
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw Object.assign(new Error("Business data is not configured."), {
      status: 503,
    });
  const response = await fetcher(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok)
    throw Object.assign(
      new Error("Your session has expired. Please sign in again."),
      { status: 401 },
    );
  const user = await response.json();
  // Identity comes from Supabase Auth, never from client IDs or editable user metadata.
  if (user.id !== OWNER_ID)
    throw Object.assign(
      new Error("This workspace is available to the owner only."),
      { status: 403 },
    );
  return { url, key, user };
}

export async function database(auth, path, options = {}, fetcher = fetch) {
  const response = await fetcher(`${auth.url}/rest/v1/${path}`, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: auth.key,
      Authorization: `Bearer ${auth.key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    console.error("business_database_failure", response.status); // Do not log tokens or financial payloads.
    throw Object.assign(
      new Error("Business storage is unavailable. Please retry."),
      { status: 503 },
    );
  }
  return response.status === 204 ? null : response.json();
}

export const json = (statusCode, value) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0",
    "Netlify-CDN-Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    Vary: "Authorization",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  },
  body: JSON.stringify(value),
});
