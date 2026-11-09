import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      flowType: 'pkce',
      detectSessionInUrl: false,
    },
  },
);

/** True when a session is stored; getSession refreshes an expired token first. */
export async function signedIn(): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  if (data.session !== null) return true;
  // auth-js keeps the stored session when a refresh fails offline or on a 5xx; jobs fail their call and retry next run.
  return isAuthRetryableFetchError(error);
}
