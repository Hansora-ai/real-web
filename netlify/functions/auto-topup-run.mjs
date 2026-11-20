// Every 2 minutes: charges the saved card of everyone whose balance fell under their auto top-up level
// (see lib/business/auto-topup.mjs). The Dodo webhook adds the credits when the payment succeeds.
import { runAutoTopups, notifyOwner } from "../../lib/business/auto-topup.mjs";

export const config = { schedule: "*/2 * * * *" };

export default async () => {
  const result = await runAutoTopups({ notify: notifyOwner }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
  console.log("auto_topup_run", JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};
