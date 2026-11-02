import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonContent, IonHeader, IonIcon, IonModal, IonPage, IonRefresher, IonRefresherContent, IonSearchbar, IonSkeletonText, IonTitle, IonToolbar,
  useIonActionSheet, useIonAlert, useIonRouter, useIonToast, type RefresherEventDetail,
} from '@ionic/react';
import { bagHandle, calendar, chatbubbles, chevronDown, flash, receipt } from 'ionicons/icons';
import { useI18n } from '../i18n';
import { useBusiness } from '../automation/business';
import { STATUSES, formatMoney, loadRecords, updateRecord, type RecordItem } from '../automation/api';
import { EmployeeSwitch } from '../components/EmployeeSwitch';
import { dateTime, relativeTime } from '../lib/time';

type Kind = 'all' | 'order' | 'booking' | 'lead';
const ICON: Record<string, string> = { order: bagHandle, booking: calendar, lead: flash };

export default function Orders() {
  const { t } = useI18n();
  const router = useIonRouter();
  const { businessId, employees } = useBusiness();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [alert] = useIonAlert();
  const [records, setRecords] = useState<RecordItem[] | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState('');
  const [note, setNote] = useState('');
  const say = (message: string) => { void toast({ message, duration: 2500, position: 'top', color: 'dark' }); };
  const statusLabel = (s: string) => t(`status.${s}` as 'status.new');

  const load = useCallback(async () => {
    if (!businessId) return;
    try { setRecords(await loadRecords(businessId)); } catch { setRecords(r => r ?? []); say(t('common.error')); }
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRecords(null); void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const metrics = useMemo(() => {
    const list = records || [];
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const open = (r: RecordItem) => !['completed', 'cancelled'].includes(r.status);
    const openList = list.filter(open);
    const counts: Record<string, number> = {}; openList.forEach(r => { counts[r.currency] = (counts[r.currency] || 0) + 1; });
    const currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';
    return {
      orders: list.filter(r => r.kind === 'order' && r.status !== 'cancelled' && Date.parse(r.createdAt) >= monthStart.getTime()).length,
      bookings: list.filter(r => r.kind === 'booking' && open(r) && Date.parse(r.start || '') >= Date.now()).length,
      leads: list.filter(r => r.kind === 'lead' && open(r)).length,
      value: formatMoney(Math.round(openList.filter(r => r.currency === currency).reduce((sum, r) => sum + r.value, 0)), currency),
    };
  }, [records]);

  const visible = (records || []).filter(r => (kind === 'all' || r.kind === kind) && (status === 'all' || r.status === status)
    && (!query || `${r.customer} ${r.title} ${r.channel} ${r.handle} ${r.reference || ''}`.toLowerCase().includes(query.toLowerCase())));
  const record = records?.find(r => r.id === openId) || null;

  async function patch(item: RecordItem, change: Partial<Record<'status' | 'assignee' | 'private_note', string>>, done?: string) {
    const before = records;
    setRecords(list => (list || []).map(r => (r.id === item.id ? { ...r, ...(change.status ? { status: change.status } : {}), ...(change.assignee !== undefined ? { owner: change.assignee } : {}), ...(change.private_note !== undefined ? { note: change.private_note } : {}) } : r)));
    try { await updateRecord(businessId, item.id, change); if (done) say(done); }
    catch (error) { setRecords(before); say((error as { code?: string }).code === 'time_already_booked' ? t('orders.timeTaken') : t('common.error')); }
  }

  function chooseStatus(item: RecordItem) {
    void sheet({
      header: t('orders.status'),
      buttons: [
        ...STATUSES.map(s => ({
          text: `${s === item.status ? '✓ ' : ''}${statusLabel(s)}`, role: s === 'cancelled' ? 'destructive' : undefined,
          handler: () => {
            if (s === 'cancelled' && item.kind === 'booking') {
              void alert({ header: t('orders.cancelBooking'), message: t('orders.cancelBookingBody'), buttons: [{ text: t('common.cancel'), role: 'cancel' }, { text: statusLabel('cancelled'), role: 'destructive', handler: () => { void patch(item, { status: s }, t('orders.marked', { status: statusLabel(s) })); } }] });
            } else void patch(item, { status: s }, t('orders.marked', { status: statusLabel(s) }));
          },
        })),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
  }

  function assign(item: RecordItem) {
    void alert({
      header: t('orders.assignedTo'), inputs: [{ name: 'owner', value: item.owner, placeholder: t('orders.unassigned') }],
      buttons: [{ text: t('common.cancel'), role: 'cancel' }, { text: t('common.done'), handler: (v: { owner: string }) => { void patch(item, { assignee: String(v.owner || '').trim() }); } }],
    });
  }

  async function refresh(event: CustomEvent<RefresherEventDetail>) { await load(); event.detail.complete(); }
  const noEmployee = employees !== null && employees.length === 0;

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar><IonTitle>{t('orders.title')}</IonTitle></IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={refresh}><IonRefresherContent /></IonRefresher>
        <IonHeader collapse="condense">
          <IonToolbar><IonTitle size="large">{t('orders.title')}</IonTitle></IonToolbar>
        </IonHeader>
        {noEmployee ? (
          <div className="empty"><div className="empty-icon"><IonIcon icon={receipt} /></div><h2>{t('inbox.noEmployeeTitle')}</h2><p>{t('account.noAiEmployeeBody')}</p></div>
        ) : (
          <>
            <div className="screen-sub"><EmployeeSwitch /></div>
            <div className="metrics">
              <div className="metric"><small>{t('orders.ordersMonth')}</small><b>{records ? metrics.orders : '–'}</b><IonIcon icon={bagHandle} /></div>
              <div className="metric"><small>{t('orders.upcoming')}</small><b>{records ? metrics.bookings : '–'}</b><IonIcon icon={calendar} /></div>
              <div className="metric"><small>{t('orders.openLeads')}</small><b>{records ? metrics.leads : '–'}</b><IonIcon icon={flash} /></div>
              <div className="metric accent"><small>{t('orders.openValue')}</small><b>{records ? metrics.value : '–'}</b></div>
            </div>
            <div className="segment-wrap">
              <div className="h-segment four" role="tablist">
                {(['all', 'order', 'booking', 'lead'] as Kind[]).map(k => (
                  <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t(`orders.kind.${k}`)}</button>
                ))}
              </div>
            </div>
            <div className="search-row">
              <IonSearchbar className="search" placeholder={t('inbox.search')} value={query} onIonInput={e => setQuery(String(e.detail.value || ''))} />
              <button type="button" className="fchip select" onClick={() => sheet({ header: t('orders.status'), buttons: [...['all', ...STATUSES].map(s => ({ text: `${s === status ? '✓ ' : ''}${s === 'all' ? t('orders.anyStatus') : statusLabel(s)}`, handler: () => setStatus(s) })), { text: t('common.cancel'), role: 'cancel' }] })}>
                {status === 'all' ? t('orders.anyStatus') : statusLabel(status)}<IonIcon icon={chevronDown} />
              </button>
            </div>

            <div className="records">
              {records === null && [0, 1, 2, 3].map(i => <div key={i} className="rec"><span className="rec-icon" /><span className="rec-main"><IonSkeletonText animated style={{ width: '60%' }} /><IonSkeletonText animated style={{ width: '40%' }} /></span></div>)}
              {records !== null && visible.length === 0 && <div className="empty small"><div className="empty-icon"><IonIcon icon={receipt} /></div><p>{records.length ? t('inbox.nothingHere') : t('orders.empty')}</p></div>}
              {visible.map(r => (
                <button key={r.id} type="button" className={`rec${r.status === 'cancelled' ? ' cancelled' : ''}`} onClick={() => { setOpenId(r.id); setNote(r.note); }}>
                  <span className={`rec-icon ${r.kind}`}><IonIcon icon={ICON[r.kind] || receipt} /></span>
                  <span className="rec-main">
                    <strong>{r.title || t(`orders.kindOne.${r.kind}` as 'orders.kindOne.order')}{r.reference ? <em> #{r.reference}</em> : null}</strong>
                    <small>{[r.customer, r.channel, r.owner].filter(Boolean).join(' · ')}</small>
                    <small className="when">{r.value ? <b>{formatMoney(r.value, r.currency)} · </b> : null}{r.start ? dateTime(r.start) : relativeTime(r.createdAt, t)}</small>
                  </span>
                  <span className={`pill ${r.status}`}>{statusLabel(r.status)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="safe-bottom" />

        <IonModal isOpen={!!record} onDidDismiss={() => setOpenId('')} initialBreakpoint={0.9} breakpoints={[0, 0.9, 1]} className="record-sheet">
          {record && (
            <div className="detail">
              <span className={`kind-tag ${record.kind}`}>{t(`orders.kindOne.${record.kind}` as 'orders.kindOne.order')}{record.reference ? ` #${record.reference}` : ''}</span>
              <h2>{record.title}</h2>
              <p className="detail-sub">{[record.customer, record.channel, record.handle].filter(Boolean).join(' · ')}</p>
              {record.conversationId && (
                <button type="button" className="h-link left" onClick={() => { setOpenId(''); router.push(`/inbox/${record.conversationId}`); }}><IonIcon icon={chatbubbles} /> {t('orders.openConversation')}</button>
              )}
              <div className="detail-group">
                <button type="button" className="detail-row" onClick={() => chooseStatus(record)}><span>{t('orders.status')}</span><span className={`pill ${record.status}`}>{statusLabel(record.status)}</span></button>
                <button type="button" className="detail-row" onClick={() => assign(record)}><span>{t('orders.assignedTo')}</span><b>{record.owner || t('orders.unassigned')}</b></button>
                {record.value > 0 && <div className="detail-row"><span>{t('orders.value')}</span><b>{formatMoney(record.value, record.currency)}</b></div>}
                {record.start && <div className="detail-row"><span>{t('orders.when')}</span><b>{dateTime(record.start)}</b></div>}
                <div className="detail-row"><span>{record.kind === 'booking' ? t('orders.bookedAt') : record.kind === 'order' ? t('orders.orderedAt') : t('orders.createdAt')}</span><b>{dateTime(record.createdAt)}</b></div>
              </div>
              {record.fields.length > 0 && (
                <>
                  <h4>{t('orders.details')}</h4>
                  <div className="detail-group">{record.fields.map(([label, value]) => <div key={label} className="detail-row"><span>{label}</span><b>{value}</b></div>)}</div>
                </>
              )}
              {record.summary && (<><h4>{t('chat.summary')}</h4><p className="detail-summary">{record.summary}</p></>)}
              <h4>{t('orders.note')}</h4>
              <textarea className="note" rows={3} placeholder={t('orders.notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />
              <button type="button" className="h-btn h-btn-light" disabled={note === record.note} onClick={() => patch(record, { private_note: note }, t('orders.noteSaved'))}>{t('orders.saveNote')}</button>
            </div>
          )}
        </IonModal>
      </IonContent>
    </IonPage>
  );
}
