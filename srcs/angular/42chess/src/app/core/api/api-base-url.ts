import { InjectionToken } from '@angular/core';

/** Nginx forwards this same-origin prefix to NestJS /v1. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api/v1',
});

export function isApiUrl(url: string, baseUrl: string): boolean {
  const base = baseUrl.replace(/\/+$/, '');
  return url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`);
}
