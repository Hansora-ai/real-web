import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Profile = { user_id: string; email: string | null; credits: number | null; language: string | null };
export type AiEmployee = { id: string; name: string; instagram: string };

/**
 * Same as getOrCreateProfileOnce() in public/header.js: a first sign-in creates the profile with the
 * website's welcome credits (3 stored = 30⚡). Keep these numbers identical to the website's.
 * TODO(server): move profile creation to the server for both website and app (see docs/mobile-app/PLAN.md).
 */
export async function getOrCreateProfile(user: User): Promise<Profile> {
  const read = () => supabase.from('profiles').select('user_id,email,credits,language').eq('user_id', user.id).maybeSingle();
  const first = await read();
  if (first.error) throw first.error;
  if (first.data) return first.data as Profile;
  const insert = await supabase.from('profiles')
    .insert({ user_id: user.id, email: user.email ?? null, credits: 3, monthly_credits: 0, payg_credits: 3 })
    .select('user_id,email,credits,language').single();
  if (!insert.error) return insert.data as Profile;
  // Another tab or device created it at the same moment.
  const again = await read();
  if (again.error || !again.data) throw insert.error;
  return again.data as Profile;
}

// Same query and naming as the website's AI-employee switcher (public/automation-header.js).
export async function listAiEmployees(): Promise<AiEmployee[]> {
  const { data, error } = await supabase.from('automation_businesses')
    .select('id,name,updated_at,automation_agents(display_name),automation_channel_connections(channel_type,status,connected_account_label)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => {
    const agent = Array.isArray(row.automation_agents) ? row.automation_agents[0] : row.automation_agents;
    const label = (row.automation_channel_connections || []).find((item: any) => item.channel_type === 'instagram_dm' && item.status !== 'not_connected' && item.connected_account_label)?.connected_account_label || '';
    return { id: row.id, name: agent?.display_name || row.name || 'AI employee', instagram: label ? (label.startsWith('@') ? label : `@${label}`) : '' };
  });
}
