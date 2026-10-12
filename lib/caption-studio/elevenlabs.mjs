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
        "ElevenLabs is not configured. Set ELEVENLABS_API_KEY on the local server.",
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
          ? "The ElevenLabs key was rejected. Check its permissions."
          : response.status === 429
            ? "ElevenLabs is busy or your account limit was reached. Try again later."
            : "Could not connect to ElevenLabs.",
      ),
      { status: response.status === 429 ? 429 : 502 },
    );
  const data = await response.json();
  if (!data.token)
    throw Object.assign(new Error("ElevenLabs returned an invalid token."), {
      status: 502,
    });
  return { token: data.token };
}
