import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonRefresher, IonRefresherContent, IonSearchbar, IonSkeletonText, IonTitle, IonToolbar, useIonRouter,
  type RefresherEventDetail,
} from '@ionic/react';
import { chatbubbles } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { useI18n } from '../i18n';
import { useBusiness } from '../automation/business';
import { PLATFORM_NAMES, STAGES, loadConversations, platformOf, type Conversation } from '../automation/api';
import { Avatar } from '../components/Channel';
import { EmployeeSwitch } from '../components/EmployeeSwitch';
import { relativeTime } from '../lib/time';

type Filter = 'all' | 'attention' | 'team' | 'resolved';

export function outcomeBadges(items: Conversation['outcomes'], t: ReturnType<typeof useI18n>['t']) {
  const kinds: [string, string, 'inbox.booking' | 'inbox.order' | 'inbox.lead'][] = [['booking', '📅', 'inbox.booking'], ['order', '🛍', 'inbox.order'], ['lead', '⚡', 'inbox.lead']];
  return kinds.map(([kind, emoji, key]) => {
    const list = items.filter(item => item.outcome_type === kind);
    if (!list.length) return null;
    const label = list.length === 1 && list[0].reference_number ? `${t(key)} #${list[0].reference_number}` : `${list.length} × ${t(key)}`;
    return <span key={kind} className={`out out-${kind}`}>{emoji} {label}</span>;
  });
}

export default function Inbox() {
  const { t } = useI18n();
  const router = useIonRouter();
  const { businessId, employees } = useBusiness();
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [platform, setPlatform] = useState('');
  const [stage, setStage] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    try { setItems(await loadConversations(businessId)); setError(''); }
    catch { setError(t('common.error')); setItems(list => list ?? []); }
  }, [businessId, t]);

  useEffect(() => { setItems(null); void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20000);
    return () => clearInterval(timer);
  }, [load]);

  const open = (items || []).filter(c => !c.resolved);
  const needYou = open.filter(c => c.attention);
  const platforms = useMemo(() => {
    const counts: Record<string, number> = {};
    (items || []).forEach(c => { const key = platformOf(c.channelType); counts[key] = (counts[key] || 0) + 1; });
    return Object.entries(counts);
  }, [items]);
  const stages = useMemo(() => Object.keys(STAGES).filter(key => key !== 'new' && (items || []).some(c => c.stage === key)), [items]);

  const visible = (items || [])
    .filter(c => (filter === 'all' ? !c.resolved : filter === 'attention' ? c.attention && !c.resolved : filter === 'team' ? c.human && !c.resolved : c.resolved))
    .filter(c => !platform || platformOf(c.channelType) === platform)
    .filter(c => !stage || c.stage === stage)
    .filter(c => !query || `${c.name} ${c.handle} ${c.preview} ${c.interest}`.toLowerCase().includes(query.toLowerCase()))
    // "Needs you" always first, then newest.
    .sort((a, b) => Number(b.attention) - Number(a.attention) || Date.parse(b.lastAt) - Date.parse(a.lastAt));

  async function refresh(event: CustomEvent<RefresherEventDetail>) { await load(); event.detail.complete(); }

  const noEmployee = employees !== null && employees.length === 0;

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar><IonTitle>{t('tabs.inbox')}</IonTitle></IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={refresh}><IonRefresherContent /></IonRefresher>
        <IonHeader collapse="condense">
          <IonToolbar><IonTitle size="large">{t('tabs.inbox')}</IonTitle></IonToolbar>
        </IonHeader>
        {noEmployee ? (
          <div className="empty"><div className="empty-icon"><IonIcon icon={chatbubbles} /></div><h2>{t('inbox.noEmployeeTitle')}</h2><p>{t('account.noAiEmployeeBody')}</p></div>
        ) : (
          <>
            <div className="screen-sub">
              <EmployeeSwitch />
              <span className="counts">
                <span className="count">{open.length} {t('inbox.open')}</span>
                {needYou.length > 0 && <span className="count red">{needYou.length} {t('inbox.needYou')}</span>}
              </span>
            </div>
            <IonSearchbar className="search" placeholder={t('inbox.search')} value={query} onIonInput={e => setQuery(String(e.detail.value || ''))} />
            <div className="filters">
              {(['all', 'attention', 'team', 'resolved'] as Filter[]).map(key => (
                <button key={key} type="button" className={`fchip${filter === key ? ' on' : ''}${key === 'attention' ? ' red' : ''}`} onClick={() => setFilter(key)}>
                  {t(`inbox.filter.${key}`)}
                  <span>{key === 'all' ? open.length : key === 'attention' ? needYou.length : key === 'team' ? open.filter(c => c.human).length : (items || []).filter(c => c.resolved).length}</span>
                </button>
              ))}
            </div>
            {(platforms.length > 1 || stages.length > 0) && (
              <div className="filters">
                {platforms.length > 1 && platforms.map(([key, count]) => (
                  <button key={key} type="button" className={`fchip${platform === key ? ' on' : ''}`} onClick={() => setPlatform(p => (p === key ? '' : key))}>{PLATFORM_NAMES[key] || key} <span>{count}</span></button>
                ))}
                {stages.map(key => (
                  <button key={key} type="button" className={`fchip${stage === key ? ' on' : ''}`} onClick={() => setStage(s => (s === key ? '' : key))}>{STAGES[key][0]} {t(`stage.${key}` as 'stage.new')}</button>
                ))}
              </div>
            )}
            {error && <p className="banner-error">{error}</p>}

            <div className="convos">
              {items === null && [0, 1, 2, 3, 4].map(i => (
                <div key={i} className="convo"><span className="avatar" style={{ width: 48, height: 48 }} /><span className="convo-body"><IonSkeletonText animated style={{ width: '40%' }} /><IonSkeletonText animated style={{ width: '80%' }} /></span></div>
              ))}
              {items !== null && visible.length === 0 && (
                <div className="empty small"><div className="empty-icon"><IonIcon icon={chatbubbles} /></div><p>{items.length ? t('inbox.nothingHere') : t('inbox.empty')}</p></div>
              )}
              {visible.map(c => (
                <button key={c.id} type="button" className={`convo${c.attention ? ' attention' : ''}`} onClick={() => router.push(`/inbox/${c.id}`)}>
                  <Avatar name={c.name} url={c.avatarUrl} type={c.channelType} />
                  <span className="convo-body">
                    <span className="convo-top"><strong>{c.name}</strong><time>{relativeTime(c.lastAt, t)}</time></span>
                    <span className="convo-preview">{c.preview}</span>
                    <span className="convo-tags">
                      {c.attention && !c.resolved && <span className="tag red">{t('inbox.needYouOne')}</span>}
                      {c.human && !c.attention && !c.resolved && <span className="tag amber">{t('inbox.yourTeam')}</span>}
                      {c.stage && c.stage !== 'new' && !(c.stage === 'done' && c.outcomes.length) && (
                        <span className={`tag stage stage-${c.stage}`}>{STAGES[c.stage][0]} {t(`stage.${c.stage}` as 'stage.new')}{c.interest ? ` · ${c.interest}` : ''}{c.value ? ` · ${c.value}` : ''}</span>
                      )}
                      {outcomeBadges(c.outcomes, t)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="safe-bottom" />
      </IonContent>
    </IonPage>
  );
}
