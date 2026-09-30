// Keeps the customer's "typing…" animation on while the AI prepares a reply. Instagram and WhatsApp hide it
// after about 20–25 seconds, so it is sent again until stop() is called (the sent reply also hides it).
export function keepTyping(send, { everyMs = 15000, immediate = true } = {}) {
  let stopped = false, timer = null;
  const tick = () => {
    if (stopped) return;
    Promise.resolve().then(send).catch(error => console.warn('typing indicator failed', { message: error?.message }));
    timer = setTimeout(tick, everyMs);
  };
  if (immediate) tick(); else timer = setTimeout(tick, everyMs);
  return () => { stopped = true; clearTimeout(timer); };
}
