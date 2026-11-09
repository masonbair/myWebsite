import * as WebBrowser from 'expo-web-browser';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const REDIRECT_URL = 'masonbair-collector://auth/callback';
export const OWNER_GITHUB_ID = '77211262';

export type SignInResult = 'ok' | 'cancelled' | 'not-allowed' | 'error';

function githubId(user: User): string | undefined {
  const fromIdentity = user.identities?.find((i) => i.provider === 'github')?.id;
  const fromMetadata = user.user_metadata?.provider_id;
  const id = fromIdentity ?? fromMetadata;
  return id === undefined || id === null ? undefined : String(id);
}

export async function signInWithGitHub(): Promise<SignInResult> {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
    });
    if (error || !data.url) return 'error';

    const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
    if (result.type !== 'success') return 'cancelled';

    const code = new URL(result.url).searchParams.get('code');
    if (!code) return 'error';

    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    const user = exchanged.data.session?.user;
    if (exchanged.error || !user) return 'error';

    // Only a clear message for the user: the database policies are the real gate.
    if (githubId(user) !== OWNER_GITHUB_ID) {
      await supabase.auth.signOut();
      return 'not-allowed';
    }
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
