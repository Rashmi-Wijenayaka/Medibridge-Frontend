const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000';

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).trim();

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, '');

export function apiUrl(path = '') {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function assetUrl(path = '') {
  if (!path) {
    return API_BASE_URL;
  }

  return apiUrl(path);
}

export function websocketUrl(path = '') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = new URL(API_BASE_URL);
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${base.host}${normalizedPath}`;
}