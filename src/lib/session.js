import * as SecureStore from 'expo-secure-store';
import { setAuthToken } from './api';

const TOKEN_KEY = 'alba_token';

export async function saveSession(token) {
  await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainService: 'alba' });
  setAuthToken(token);
}

export async function loadSession() {
  const token = await SecureStore.getItemAsync(TOKEN_KEY, { keychainService: 'alba' });
  if (token) setAuthToken(token);
  return token;
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(TOKEN_KEY, { keychainService: 'alba' });
  setAuthToken(null);
}
