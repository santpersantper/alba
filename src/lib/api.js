import axios from 'axios';

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
export const api = axios.create({ baseURL: BASE_URL });

// optionally inject the token later:
export const setAuthToken = (token) => {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
};
