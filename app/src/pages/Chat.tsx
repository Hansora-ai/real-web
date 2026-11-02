import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonPage, IonSpinner, IonTitle, IonToolbar,
  useIonActionSheet, useIonToast,
} from '@ionic/react';
import { arrowUp, ellipsisHorizontal, sparkles } from 'ionicons/icons';
import { useI18n } from '../i18n';
import { useBusiness } from '../automation/business';
import { STAGES, channelName, loadConversations, loadMessages, replyWindowHours, sendReply, setAi, setResolved, type Conversation, type Message } from '../automation/api';
import { Avatar } from '../components/Channel';
import { clock } from '../lib/time';
import { outcomeBadges } from './Inbox';

export default function Chat() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { businessId } = useBusiness();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [lastCustomerAt, setLastCustomerAt] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'send' | 'ai'>('');
  const [showSummary, setShowSummary] = useState(false);
  const content = useRef<HTMLIonContentElement>(null);
  const say = (message: string) => { void toast({ message, duration: 3000, position: 'top', color: 'dark' }); };

  const load = useCallback(async (scroll = false) => {
    if (!businessId || !id) return;
    try {
      const [list, thread] = await Promise.all([loadConversations(businessId), loadMessages(businessId, id)]);
      setConvo(list.find(c => c.id === id) || null);
      setMessages(thread.messages);
      setLastCustomerAt(thread.lastCustomerAt);
      if (scroll) setTimeout(() => content.current?.scrollToBottom(200), 50);
    } catch { setMessages(m => m ?? []); }
  }, [businessId, id]);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const hours = convo ? replyWindowHours(convo.channelType) : null;
  const windowClosed = !!(hours && lastCustomerAt && Date.now() - lastCustomerAt > hours * 3600000);
  const canWrite = !!convo && convo.human && !convo.resolved && !windowClosed;

  async function toggleAi(aiOn: boolean) {
    if (!convo) return;
    setBusy('ai');
    try { await setAi(businessId, convo.id, aiOn); setConvo({ ...convo, aiActive: aiOn, human: !aiOn, attention: aiOn ? convo.attention : false }); say(aiOn ? t('chat.backToAi') : t('chat.youReplying')); }
    catch { say(t('common.error')); }
    finally { setBusy(''); }
  }

  async function send() {
    const message = text.trim();
    if (!convo || !message) return;
    setBusy('send');
    try {
      await sendReply(businessId, convo.id, message);
      setMessages(list => [...(list || []), { role: 'human', text: message, at: Date.now() }]);
      setText('');
      setTimeout(() => content.current?.scrollToBottom(200), 50);
    } catch (error) {
      const code = (error as { code?: string }).code;
      say(code === 'whatsapp_template_required' ? t('chat.windowClosed', { hours: String(hours || 24) }) : code === 'take_over_before_replying' ? t('chat.takeOverFirst') : t('chat.sendFailed'));
    } finally { setBusy(''); }
  }

  function more() {
    if (!convo) return;
    void sheet({
      buttons: [
        { text: convo.resolved ? t('chat.reopen') : t('chat.resolve'), handler: async () => {
          try { await setResolved(businessId, convo, !convo.resolved); setConvo({ ...convo, resolved: !convo.resolved }); } catch { say(t('common.error')); }
        } },
        { text: showSummary ? t('chat.hideDetails') : t('chat.showDetails'), handler: () => setShowSummary(s => !s) },
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
  }

  let lastDay = '';
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/inbox" text="" /></IonButtons>
          <IonTitle>
            <span className="chat-title">
              {convo && <Avatar name={convo.name} url={convo.avatarUrl} type={convo.channelType} size={32} />}
              <span><strong>{convo?.name || ' '}</strong><small>{convo ? `${channelName(convo.channelType)} · ${convo.resolved ? t('chat.resolved') : convo.human ? t('chat.humanHandling') : t('chat.aiReplying')}` : ''}</small></span>
            </span>
          </IonTitle>
          <IonButtons slot="end"><IonButton onClick={more} aria-label={t('chat.more')}><IonIcon icon={ellipsisHorizontal} /></IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent ref={content} className="chat">
        {convo && (convo.summary || convo.outcomes.length > 0 || convo.stage) && (
          <button type="button" className={`summary${showSummary ? ' open' : ''}`} onClick={() => setShowSummary(s => !s)}>
            <span className="summary-head"><IonIcon icon={sparkles} />{t('chat.summary')}
              {convo.stage && STAGES[convo.stage] && <span className={`tag stage stage-${convo.stage}`}>{STAGES[convo.stage][0]} {t(`stage.${convo.stage}` as 'stage.new')}</span>}
            </span>
            {convo.summary && <span className="summary-text">{convo.summary}</span>}
            {showSummary && (
              <span className="summary-fields">
                {convo.interest && <span><small>{t('chat.interestedIn')}</small>{convo.interest}</span>}
                {convo.value && <span><small>{t('chat.likelyValue')}</small>{convo.value}</span>}
                {convo.language && <span><small>{t('account.language')}</small>{convo.language}</span>}
                {convo.handle && <span><small>{t('chat.contact')}</small>{convo.handle}</span>}
              </span>
            )}
            {convo.outcomes.length > 0 && <span className="convo-tags">{outcomeBadges(convo.outcomes, t)}</span>}
          </button>
        )}
        <div className="bubbles">
          {messages === null && <div className="center"><IonSpinner name="crescent" /></div>}
          {messages?.map((m, i) => {
            const day = new Date(m.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
            const showDay = day !== lastDay; lastDay = day;
            return (
              <div key={i}>
                {showDay && <div className="day">{day}</div>}
                {m.role === 'event' ? (
                  <div className={`event out-${m.kind}`}>{m.kind === 'booking' ? '📅' : m.kind === 'order' ? '🛍' : '⚡'} {m.text}{m.reference ? ` · #${m.reference}` : ''}</div>
                ) : (
                  <div className={`bubble ${m.role}`}>
                    {m.role !== 'customer' && <span className="who">{m.role === 'ai' ? t('chat.ai') : t('chat.you')}</span>}
                    {m.mediaUrl && <img src={m.mediaUrl} alt="" />}
                    <span className="text">{m.text}</span>
                    <time>{clock(m.at)}</time>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </IonContent>
      <IonFooter className="composer">
        {convo && !convo.resolved && (
          canWrite ? (
            <>
              <div className="compose-row">
                <textarea rows={1} placeholder={t('chat.typeReply')} value={text} onChange={e => setText(e.target.value)} />
                <button type="button" className="send" disabled={!text.trim() || busy === 'send'} onClick={send} aria-label={t('chat.send')}>
                  {busy === 'send' ? <IonSpinner name="crescent" /> : <IonIcon icon={arrowUp} />}
                </button>
              </div>
              <button type="button" className="handback" disabled={!!busy} onClick={() => toggleAi(true)}><IonIcon icon={sparkles} />{t('chat.giveBack')}</button>
            </>
          ) : convo.human && windowClosed ? (
            <p className="compose-note">{t('chat.windowClosed', { hours: String(hours) })}</p>
          ) : (
            <>
              <p className="compose-note">{t('chat.aiIsReplying')}</p>
              <button type="button" className="takeover" disabled={!!busy} onClick={() => toggleAi(false)}>{busy === 'ai' ? <IonSpinner name="crescent" /> : t('chat.takeOver')}</button>
            </>
          )
        )}
      </IonFooter>
    </IonPage>
  );
}
