// Every 10 minutes: checks the Kie and reAPI balances and messages the owner on Telegram when one runs low
// (see lib/business/provider-balance.mjs).
import { checkProviderBalances } from "../../lib/business/provider-balance.mjs";

export const config = { schedule: "*/10 * * * *" };

export default async () => {
  const results = await checkProviderBalances();
  console.log("provider_balance", JSON.stringify(results));
  return new Response(JSON.stringify({ ok: true, results }), { headers: { "Content-Type": "application/json" } });
};
