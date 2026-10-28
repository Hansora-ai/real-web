export const DIAGNOSTIC_TOPIC = 'hansora.phone.diagnostic';
export const END_CALL_DEFINITION = {
  name: 'end_call',
  description: 'End the phone call after the caller indicates they need nothing else or says goodbye. Completing an action or confirming an order is not a request to end the call; offer further help and wait for the caller first. Say a brief goodbye with this tool before disconnecting.',
  parameters: { type: 'object', properties: {}, required: [] },
};

// The observer token is minted only by the private owner monitor. Ordinary
// caller tokens cannot choose this identity/metadata. Never broadcast text.
export function diagnosticObservers(room, owner, now = Date.now()) {
  if (!owner?.ownerUserId || !owner?.businessId) return [];
  return [...room.remoteParticipants.values()].filter(participant => {
    if (!participant.identity?.startsWith(`owner-diagnostic-${owner.ownerUserId}-`)) return false;
    try {
      const m = JSON.parse(participant.metadata || '{}');
      return m.purpose === 'phone_confirmation_diagnostic' &&
        m.owner_user_id === owner.ownerUserId && m.business_id === owner.businessId &&
        Number.isFinite(m.expires_at) && m.expires_at > now && m.expires_at <= now + 10 * 60_000;
    } catch { return false; }
  }).map(participant => participant.identity);
}

// Only schema keys, booleans/counts and a machine error code reach saved
// numeric diagnostics. No caller words, tool argument values or result text.
export function toolDiagnostic(name, args, result) {
  return {
    tool: name,
    customer_confirmed: args?.customer_confirmed === true ? true : args?.customer_confirmed === false ? false : null,
    ...(result === undefined ? {} : {
      ok: result?.ok === true,
      test: result?.test === true,
      error: /^[a-z_]{1,80}$/.test(result?.error || '') ? result.error : null,
      missing_fields: Array.isArray(result?.missing) ? result.missing.length : 0,
    }),
  };
}
