export function elevenLabsKey(env = process.env) {
  return (
    [
      "Elevan_labs_api1",
      "ELEVENLABS_API_KEY",
      "Elevan_labs_api",
      "ELEVEN_LABS_API_KEY",
      "Eleven_labs_api",
      "eleven_labs_api",
      "XI_API_KEY",
    ]
      .map((name) => String(env[name] || "").trim())
      .find(Boolean) || ""
  );
}
export async function createCaptionToken({ apiKey, fetchImpl = fetch }) {
  if (!apiKey)
    throw Object.assign(
      new Error(
        "Auto captions are not available right now.",
      ),
      { status: 503 },
    );
  const response = await fetchImpl(
    "https://api.elevenlabs.io/v1/single-use-token/batch_scribe",
    {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw Object.assign(
      new Error(
        response.status === 401
          ? "Auto captions are not available right now."
          : response.status === 429
            ? "Auto captions are busy right now. Try again in a minute."
            : "Could not start auto captions. Try again.",
      ),
      { status: response.status === 429 ? 429 : 502 },
    );
  const data = await response.json();
  if (!data.token)
    throw Object.assign(new Error("Could not start auto captions. Try again."), {
      status: 502,
    });
  return { token: data.token };
}
