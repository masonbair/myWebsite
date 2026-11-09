import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';
import { OWNER_GITHUB_ID, REDIRECT_URL, signInWithGitHub, signOut } from '../signIn';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

const auth = supabase.auth as jest.Mocked<typeof supabase.auth>;
const openAuth = WebBrowser.openAuthSessionAsync as jest.Mock;

function sessionFor(githubId: string) {
  return {
    data: { session: { user: { user_metadata: { provider_id: githubId }, identities: [] } } },
    error: null,
  };
}

beforeEach(() => {
  (auth.signInWithOAuth as jest.Mock).mockResolvedValue({
    data: { url: 'https://github.example/authorize' },
    error: null,
  });
});

describe('signInWithGitHub', () => {
  it('starts the OAuth flow with the app redirect', async () => {
    openAuth.mockResolvedValue({ type: 'cancel' });
    await signInWithGitHub();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'masonbair-collector://auth/callback', skipBrowserRedirect: true },
    });
    expect(openAuth).toHaveBeenCalledWith(
      'https://github.example/authorize',
      'masonbair-collector://auth/callback',
    );
    expect(REDIRECT_URL).toBe('masonbair-collector://auth/callback');
  });

  it('exchanges the code and returns ok for the owner', async () => {
    openAuth.mockResolvedValue({ type: 'success', url: `${REDIRECT_URL}?code=abc123` });
    (auth.exchangeCodeForSession as jest.Mock).mockResolvedValue(sessionFor(OWNER_GITHUB_ID));
    expect(await signInWithGitHub()).toBe('ok');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('reads the GitHub id from identities when metadata has none', async () => {
    openAuth.mockResolvedValue({ type: 'success', url: `${REDIRECT_URL}?code=abc123` });
    (auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
      data: { session: { user: { user_metadata: {}, identities: [{ provider: 'github', id: OWNER_GITHUB_ID }] } } },
      error: null,
    });
    expect(await signInWithGitHub()).toBe('ok');
  });

  it.each(['cancel', 'dismiss'])('returns cancelled on %s', async (type) => {
    openAuth.mockResolvedValue({ type });
    expect(await signInWithGitHub()).toBe('cancelled');
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('signs out and returns not-allowed for another GitHub id', async () => {
    openAuth.mockResolvedValue({ type: 'success', url: `${REDIRECT_URL}?code=abc123` });
    (auth.exchangeCodeForSession as jest.Mock).mockResolvedValue(sessionFor('999'));
    expect(await signInWithGitHub()).toBe('not-allowed');
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('returns error when the redirect has no code', async () => {
    openAuth.mockResolvedValue({ type: 'success', url: REDIRECT_URL });
    expect(await signInWithGitHub()).toBe('error');
  });

  it('returns error when the exchange fails', async () => {
    openAuth.mockResolvedValue({ type: 'success', url: `${REDIRECT_URL}?code=abc123` });
    (auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: new Error('bad'),
    });
    expect(await signInWithGitHub()).toBe('error');
  });
});

describe('signOut', () => {
  it('signs out of supabase', async () => {
    await signOut();
    expect(auth.signOut).toHaveBeenCalled();
  });
});
