// src/lib/spotify.js
// Uses PKCE (Proof Key for Code Exchange) rather than the implicit grant flow.
// PKCE is the current OAuth 2.0 best practice for mobile/native apps:
//   - Access tokens are never exposed in the redirect URL fragment
//   - Code verifier is generated on-device and never transmitted
//   - Tokens can be refreshed without a client secret
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';

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
 * Hook to create a Spotify OAuth request using PKCE (code flow).
 * Access tokens are exchanged via a token endpoint and never exposed in the URL fragment.
 */
export function useSpotifyAuth(clientId) {
  if (!clientId) {
    console.warn('Spotify clientId missing!');
    throw new Error('Missing SPOTIFY_CLIENT_ID');
  }

  const redirectUri = getProxyRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      scopes: SPOTIFY_SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code, // PKCE code flow (was implicit Token)
      usePKCE: true,
    },
    discovery
  );

  return { request, response, promptAsync, redirectUri };
}

/**
 * Exchange the authorization code for an access token.
 * Call after useSpotifyAuth returns response.type === "success".
 */
export async function exchangeCodeForToken(code, codeVerifier, redirectUri, clientId) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const res = await fetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error_description || `Spotify token exchange failed: ${res.status}`);
  }

  return res.json(); // { access_token, refresh_token, expires_in, ... }
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
