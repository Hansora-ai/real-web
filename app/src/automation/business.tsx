import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { listAiEmployees, type AiEmployee } from '../lib/account';
import { getPref, setPref } from '../lib/prefs';
import { useAuth } from '../lib/auth';

// The chosen AI employee, shared by Inbox, Orders and Account (same as the website's switcher).
type State = { employees: AiEmployee[] | null; businessId: string; current?: AiEmployee; choose: (id: string) => void; reload: () => Promise<void> };
const Ctx = createContext<State | null>(null);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [employees, setEmployees] = useState<AiEmployee[] | null>(null);
  const [businessId, setBusinessId] = useState('');
  const reload = useCallback(async () => {
    const [list, saved] = await Promise.all([listAiEmployees().catch(() => [] as AiEmployee[]), getPref('business')]);
    setEmployees(list);
    const chosen = list.find(item => item.id === saved)?.id || list[0]?.id || '';
    setBusinessId(chosen);
    if (chosen !== saved) await setPref('business', chosen || null);
  }, []);
  useEffect(() => { if (session?.user?.id) void reload(); }, [session?.user?.id, reload]);
  const choose = useCallback((id: string) => { setBusinessId(id); void setPref('business', id); }, []);
  const value = useMemo(() => ({ employees, businessId, current: employees?.find(e => e.id === businessId), choose, reload }), [employees, businessId, choose, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBusiness(): State {
  const value = useContext(Ctx);
  if (!value) throw new Error('useBusiness outside BusinessProvider');
  return value;
}
