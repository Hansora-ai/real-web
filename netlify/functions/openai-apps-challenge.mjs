const TOKEN = "YYsKRqwntc4YZKCCk0Cy150hUq-QCEMfUTiknmQyKsY";

export default async () =>
  new Response(TOKEN, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export const config = {
  path: "/.well-known/openai-apps-challenge",
};
