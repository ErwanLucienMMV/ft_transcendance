import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api-base-url';

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  params?:
    HttpParams | Record<string, string | number | boolean | readonly (string | number | boolean)[]>;
  context?: HttpContext;
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL).replace(/\/+$/, '');

  get<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http.get<T>(this.url(path), options);
  }

  post<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.post<T>(this.url(path), body, options);
  }

  put<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.put<T>(this.url(path), body, options);
  }

  patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.patch<T>(this.url(path), body, options);
  }

  delete<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http.delete<T>(this.url(path), options);
  }

  private url(path: string): string {
    const relative = path.replace(/^\//, '');
    if (
      path.startsWith('//') ||
      /[:\\?#]/.test(relative) ||
      /%(?:2e|2f|5c)/i.test(relative) ||
      (relative !== '' &&
        relative.split('/').some((part) => !part || part === '.' || part === '..'))
    ) {
      throw new Error(
        'API paths must stay relative to API_BASE_URL; use params for query strings.',
      );
    }
    return relative ? `${this.baseUrl}/${relative}` : this.baseUrl;
  }
}
