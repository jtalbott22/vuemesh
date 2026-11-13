// The relay's budget (no AWS SDK here, so the unit tests run without the functions' packages).
// It stops getting new passwords at 90% of the month's data (core.mjs's /ice), and is switched off
// (its ports closed, which stops relays already going too) at 100%. Admin can switch it back on.
export const BUDGET = { stopPasswords: 0.9, closeRelay: 1.0 };

/** The guard (every 15 minutes, and when the API looks): past the month's allowance, the relay is
 * switched off. @param ls lib/lightsail.mjs's lightsail() */
export async function guard(ls, now = Date.now(), log = console.log) {
  const r = await ls.relay(now);
  if (!r) return { relay: null };
  if (r.open && r.share >= BUDGET.closeRelay) {
    await ls.setRelay(false);
    log(`relay ${r.name} switched off: ${r.usedGb.toFixed(1)} of ${r.allowanceGb} GB this month`);
    return { ...r, open: false, switchedOff: true };
  }
  return r;
}
