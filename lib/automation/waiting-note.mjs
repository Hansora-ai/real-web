import { first, serviceInsert, serviceUpdate } from './db.mjs';

// When the AI has handed a chat to the team and nobody has replied yet, a customer who writes again
// ("??", "thanks", a new question) gets ONE short note so they know they are not ignored. It does not answer
// anything, is free (no credits), and is sent once per wait: not again until the team or the AI has written.
const TEXTS = {
  en: 'Thanks! Our team has your message and will reply here soon.',
  hy: 'Շնորհակալություն։ Մեր թիմը ստացել է ձեր հաղորդագրությունը և շուտով կպատասխանի այստեղ։',
  ru: 'Спасибо! Наша команда получила ваше сообщение и скоро ответит здесь.',
  uk: 'Дякуємо! Наша команда отримала ваше повідомлення і скоро відповість тут.',
  es: '¡Gracias! Nuestro equipo recibió tu mensaje y te responderá aquí pronto.',
  fr: 'Merci ! Notre équipe a bien reçu votre message et vous répondra ici très vite.',
  de: 'Danke! Unser Team hat Ihre Nachricht erhalten und antwortet hier bald.',
  it: 'Grazie! Il nostro team ha ricevuto il tuo messaggio e ti risponderà qui a breve.',
  pt: 'Obrigado! A nossa equipa recebeu a sua mensagem e vai responder aqui em breve.',
  tr: 'Teşekkürler! Ekibimiz mesajınızı aldı ve yakında buradan yanıt verecek.',
  ar: 'شكرًا! وصلت رسالتك إلى فريقنا وسيرد عليك هنا قريبًا.',
  ka: 'გმადლობთ! ჩვენმა გუნდმა მიიღო თქვენი შეტყობინება და მალე გიპასუხებთ აქ.',
  pl: 'Dziękujemy! Nasz zespół otrzymał Twoją wiadomość i wkrótce odpowie tutaj.',
  nl: 'Bedankt! Ons team heeft je bericht ontvangen en reageert hier snel.'
};

export function waitingNoteText(language) {
  return TEXTS[String(language || '').slice(0, 2).toLowerCase()] || TEXTS.en;
}

// The chat waits for a person: the AI handed it over (AI off, not resolved) and the team has not taken it yet
// ("human_handling" means the owner is already writing, so no note then).
export function waitsForTeam(conversation, settings = {}) {
  return settings.automatic_replies !== false && conversation?.ai_enabled === false && !['human_handling', 'resolved', 'archived'].includes(conversation?.status);
}

// send(text) is the channel's own send function. Returns true when the note was sent.
export async function sendWaitingNote({ businessId, conversation, settings, provider, send, deps = {} }) {
  const d = { first, serviceInsert, serviceUpdate, ...deps };
  if (!waitsForTeam(conversation, settings)) return false;
  try {
    const last = await d.first(`/rest/v1/automation_messages?conversation_id=eq.${conversation.id}&direction=eq.outbound&select=id,sender_type,metadata&order=occurred_at.desc&limit=1`);
    // Already noted for this wait, or the team is already writing in this chat (some channels reset the status).
    if (last?.metadata?.waiting_note || last?.sender_type === 'human') return false;
    // Saved first (one row per wait), so two quick customer messages never send two notes.
    const agent = await d.first(`/rest/v1/automation_agents?business_id=eq.${businessId}&select=primary_language&limit=1`).catch(() => null);
    const text = waitingNoteText(agent?.primary_language);
    const row = await d.serviceInsert('automation_messages', {
      business_id: businessId, conversation_id: conversation.id, idempotency_key: `waiting-note:${conversation.id}:${last?.id || 'none'}`,
      direction: 'outbound', sender_type: 'system', content_type: 'text', content: text, status: 'queued', billable: false,
      provider, metadata: { waiting_note: true }, occurred_at: new Date().toISOString()
    }, { ignoreDuplicates: true });
    if (!row) return false;
    try {
      await send(text);
      await d.serviceUpdate('automation_messages', `id=eq.${row.id}`, { status: 'sent' });
      return true;
    } catch (error) {
      console.warn('waiting note not sent', { provider, message: error?.message });
      await d.serviceUpdate('automation_messages', `id=eq.${row.id}`, { status: 'failed' }).catch(() => null);
      return false;
    }
  } catch (error) {
    console.warn('waiting note skipped', { provider, message: error?.message });
    return false;
  }
}
