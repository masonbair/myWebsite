import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { signedIn, supabase } from '../supabase';

jest.mock('@supabase/supabase-js', () => ({
  ...jest.requireActual('@supabase/supabase-js'),
  createClient: () => ({ auth: { getSession: jest.fn() } }),
}));

const session = { access_token: 'a', refresh_token: 'r' };

function getSessionReturns(value: { data: { session: unknown }; error: unknown }) {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue(value);
}

describe('signedIn', () => {
  it('is true with a session', async () => {
    getSessionReturns({ data: { session }, error: null });
    expect(await signedIn()).toBe(true);
  });

  it('is false when no session is stored', async () => {
    getSessionReturns({ data: { session: null }, error: null });
    expect(await signedIn()).toBe(false);
  });

  it('stays true when the token refresh failed because the network or server is down', async () => {
    getSessionReturns({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    expect(await signedIn()).toBe(true);
    getSessionReturns({ data: { session: null }, error: new AuthRetryableFetchError('Service Unavailable', 503) });
    expect(await signedIn()).toBe(true);
  });

  it('is false when the server rejected the refresh token', async () => {
    getSessionReturns({ data: { session: null }, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') });
    expect(await signedIn()).toBe(false);
  });
});
