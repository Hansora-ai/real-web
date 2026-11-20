// Website chat: the chat bubble a business adds to its own website with one script tag (public/chat.js).
// Settings live in automation_channel_connections.settings for channel 'website'. This file holds the rules that
// don't need the network (settings, which websites may use the bubble, visitor limits), so they can be tested.
import crypto from 'node:crypto';

export const DETAIL_FIELDS = ['name', 'phone', 'email'];
export const ASK_DETAILS = ['off', 'optional', 'required'];
export const POSITIONS = ['right', 'left'];
export const DEFAULT_DAILY_LIMIT = 500;
// Per visitor and per network address. A business can lower or raise its own daily total (50–5000 messages).
export const LIMITS = { visitorPerMinute: 8, visitorPerDay: 150, ipPerHour: 60 };
export const MAX_MESSAGE = 1000;

export const newWidgetKey = () => `hw_${crypto.randomBytes(12).toString('hex')}`;
export const validWidgetKey = value => /^hw_[0-9a-f]{24}$/.test(String(value || ''));
export const validVisitorId = value => /^[A-Za-z0-9_-]{16,64}$/.test(String(value || ''));

// "https://www.Shop.am/path" → "shop.am"; "shop.am" → "shop.am"; anything that is not a host name → ''.
export function normalizeDomain(value) {
  let text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  text = text.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  text = text.replace(/^\*\./, '').replace(/^www\./, '');
  if (text === 'localhost') return text;
  return /^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(text) && !text.split('.').some(part => part.startsWith('-') || part.endsWith('-')) ? text : '';
}

// The page's Origin header must be one of the business's websites (or a subdomain of one). The Hansora site itself
// is allowed so owners can try the bubble from their dashboard.
export function originAllowed(origin, allowedDomains = [], { siteHost = '' } = {}) {
  let host = '';
  try { host = new URL(String(origin || '')).hostname.toLowerCase(); } catch (_) { return false; }
  if (!host) return false;
  if (siteHost && (host === siteHost || host.endsWith(`.${siteHost}`))) return true;
  return (Array.isArray(allowedDomains) ? allowedDomains : []).some(entry => {
    const domain = normalizeDomain(entry);
    return domain && (host === domain || host.endsWith(`.${domain}`));
  });
}

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// What the owner may change, checked and trimmed. The widget key is never taken from the owner's input.
export function sanitizeSettings(input = {}, previous = {}) {
  const domains = [...new Set((Array.isArray(input.allowed_domains) ? input.allowed_domains : String(input.allowed_domains || '').split(/[\s,]+/)).map(normalizeDomain).filter(Boolean))].slice(0, 10);
  const fields = (Array.isArray(input.detail_fields) ? input.detail_fields : []).filter(field => DETAIL_FIELDS.includes(field));
  const askDetails = ASK_DETAILS.includes(input.ask_details) ? input.ask_details : 'off';
  const limit = Math.round(Number(input.daily_limit));
  return {
    ...previous,
    widget_key: validWidgetKey(previous.widget_key) ? previous.widget_key : newWidgetKey(),
    allowed_domains: domains,
    title: clean(input.title, 60),
    greeting: clean(input.greeting, 300),
    color: HEX.test(String(input.color || '')) ? String(input.color).toLowerCase() : '#7c3aed',
    position: POSITIONS.includes(input.position) ? input.position : 'right',
    ask_details: askDetails,
    detail_fields: askDetails === 'off' ? [] : (fields.length ? [...new Set(fields)] : ['name', 'phone']),
    daily_limit: Number.isFinite(limit) ? Math.min(5000, Math.max(50, limit)) : DEFAULT_DAILY_LIMIT,
    automatic_replies: input.automatic_replies !== false,
    reply_delay: Math.min(30, Math.max(0, Math.round(Number(input.reply_delay) || 0))),
    show_branding: input.show_branding !== false
  };
}

// What the bubble on a customer's website receives (nothing private).
export function publicConfig(settings = {}, { businessName = '', language = 'en' } = {}) {
  return {
    title: settings.title || businessName || 'Chat with us',
    greeting: settings.greeting || '',
    color: HEX.test(String(settings.color || '')) ? settings.color : '#7c3aed',
    position: POSITIONS.includes(settings.position) ? settings.position : 'right',
    ask_details: ASK_DETAILS.includes(settings.ask_details) ? settings.ask_details : 'off',
    detail_fields: (settings.detail_fields || []).filter(field => DETAIL_FIELDS.includes(field)),
    language: String(language || 'en').slice(0, 2),
    branding: settings.show_branding !== false
  };
}

// Visitor details from the form: a name, a phone number and an email, each optional and checked.
export function cleanDetails(input = {}) {
  const name = clean(input.name, 80);
  const phoneRaw = clean(input.phone, 40);
  const phone = /^[+()\d][\d\s()+-]{5,30}$/.test(phoneRaw) && phoneRaw.replace(/\D/g, '').length >= 6 ? phoneRaw : '';
  const emailRaw = clean(input.email, 120).toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailRaw) ? emailRaw : '';
  return { name, phone, email };
}

// Required details are missing? Returns the first missing field, or ''.
export function missingDetail(settings = {}, details = {}) {
  if (settings.ask_details !== 'required') return '';
  return (settings.detail_fields || []).find(field => !details[field]) || '';
}

// Which limit, if any, this message would break. Counts are of the visitor's/address's recent messages.
export function limitBreached({ visitorLastMinute = 0, visitorToday = 0, ipLastHour = 0, businessToday = 0, dailyLimit = DEFAULT_DAILY_LIMIT } = {}) {
  if (businessToday >= dailyLimit) return 'business_daily_limit';
  if (visitorLastMinute >= LIMITS.visitorPerMinute) return 'too_fast';
  if (visitorToday >= LIMITS.visitorPerDay) return 'visitor_daily_limit';
  if (ipLastHour >= LIMITS.ipPerHour) return 'too_many_from_network';
  return '';
}

// Network addresses are never stored, only a salted hash, so limits work without keeping personal data.
export function ipHash(ip, secret = process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || 'hansora-website-chat') {
  const value = String(ip || '').split(',')[0].trim();
  return value ? crypto.createHmac('sha256', String(secret)).update(value).digest('hex').slice(0, 32) : '';
}

export const clientIp = (headers = {}) => {
  const get = name => headers[name] || headers[name.toLowerCase()] || '';
  return String(get('x-nf-client-connection-ip') || get('x-forwarded-for') || get('client-ip') || '').split(',')[0].trim();
};

export function snippet({ site = 'https://hansora.co', key }) {
  return `<script src="${site.replace(/\/$/, '')}/chat.js" data-key="${key}" async></script>`;
}

// Messages the bubble shows: the visitor's own, the AI's and the team's. Nothing internal.
export function visibleMessage(row) {
  const from = row.direction === 'inbound' ? 'visitor' : row.sender_type === 'human' ? 'team' : 'ai';
  return { id: row.id, from, text: String(row.content || ''), at: row.occurred_at || row.created_at };
}
