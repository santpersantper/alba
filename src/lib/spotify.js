// src/lib/spotify.js
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';

/**
 * Build the Expo Auth Proxy redirect URI explicitly so we never fall back to exp://
 * - If you're logged into Expo: https://auth.expo.io/@<username>/<slug>
 * - If not:                      https://auth.expo.io/@anonymous/<slug>
 */
function getProxyRedirectUri(path = '') {
  const owner = Constants.expoConfig?.owner || 'anonymous';
  const slug = (Constants.expoConfig?.slug || 'alba').toLowerCase();
  const base = `https://auth.expo.io/@${owner}/${slug}`;
  return path ? `${base}/${path.replace(/^\//, '')}` : base;
}

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

export const SPOTIFY_SCOPES = ['user-top-read'];

/**
 * Hook to create a Spotify OAuth request that ALWAYS uses the Expo proxy.
 * Works in Expo Go; avoids exp:// redirects entirely.
 */
export function useSpotifyAuth(clientId) {
  if (!clientId) {
    console.warn('Spotify clientId missing!');
    throw new Error('Missing SPOTIFY_CLIENT_ID');
  }

  // Force the HTTPS proxy redirect (no exp://)
  const redirectUri = getProxyRedirectUri(); // or getProxyRedirectUri('auth') if you prefer a path

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      scopes: SPOTIFY_SCOPES,
      redirectUri, // explicitly use the proxy URL
      responseType: AuthSession.ResponseType.Token, // implicit grant for dev
    },
    discovery
  );

  // Helpful logs
  console.log('SPOTIFY clientId =>', clientId);
  console.log('SPOTIFY redirectUri =>', redirectUri);

  return { request, response, promptAsync, redirectUri };
}

/**
 * Fetch top artists for the authorized user.
 */
export async function fetchTopArtists(accessToken, limit = 10) {
  const res = await fetch(
    `https://api.spotify.com/v1/me/top/artists?limit=${limit}&time_range=medium_term`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Spotify error: ${res.status}`);
  }
  const json = await res.json();
  return json.items.map(a => ({ id: a.id, name: a.name }));
}
