// Outgoing calls (AI calls a customer back, or calls the owner for a warm transfer).
// A Hansora number can call out when it has a LiveKit outbound trunk. Calls stay inside the
// number's own country (international calls cost 5–10x more), unless Hansora turned on
// allow_international for that number.

// Country calling codes for the countries Hansora sells or imports numbers in. A country that is
// not listed cannot call out until it is added here (safe default: no surprise international bills).
export const CALLING_CODES = {
  US: '1', CA: '1', AM: '374', GE: '995', RU: '7', KZ: '7', UA: '380', BY: '375', AZ: '994', TR: '90',
  GB: '44', IE: '353', DE: '49', FR: '33', ES: '34', IT: '39', NL: '31', BE: '32', CH: '41', AT: '43',
  PL: '48', CZ: '420', SE: '46', NO: '47', DK: '45', FI: '358', PT: '351', GR: '30', RO: '40', BG: '359',
  AE: '971', SA: '966', IL: '972', IN: '91', AU: '61', NZ: '64', BR: '55', MX: '52', AR: '54'
};

export function sameCountry(country, e164) {
  const code = CALLING_CODES[String(country || '').toUpperCase()];
  return Boolean(code) && String(e164 || '').startsWith(`+${code}`);
}

// May this number call `to`? (has an outgoing line, and same country unless allowed)
export function canCallFrom(number, to) {
  return Boolean(number?.livekit_outbound_trunk_id) && (number.allow_international === true || sameCountry(number.country, to));
}

// The business's number to call `to` from: one that can, preferring the same country.
export function outgoingLineFor(numbers, to) {
  const usable = (numbers || []).filter(number => canCallFrom(number, to));
  return usable.find(number => sameCountry(number.country, to)) || usable[0] || null;
}
