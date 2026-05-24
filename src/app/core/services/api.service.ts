import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, timeout, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';

/**
 * Default request timeout in milliseconds — treat as offline after this.
 *
 * Raised to 60s so cloud cold-starts (spun-down App Service / serverless
 * containers) don't trip a client-side `TimeoutError` while the backend
 * is still executing. Shorter values produced the classic
 * "silent success + 409 on user retry" pattern.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Shape accepted by `HttpClient` for `params`. Mirrors Angular's native
 * `HttpParamsOptions['fromObject']` so callers can pass either a fully
 * built `HttpParams` instance or a plain object literal.
 */
type ApiParams =
  | HttpParams
  | { [param: string]: string | number | boolean | readonly (string | number | boolean)[] };

/**
 * Centralized HTTP wrapper around Angular HttpClient.
 *
 * - Base URL from environment.apiUrl
 * - 60-second timeout on every request (RxJS timeout operator)
 * - Auth headers are handled by authInterceptor — not here
 * - Optional `params` argument forwarded to HttpClient's `options.params`
 */
@Injectable({ providedIn: 'root' })
export class ApiService {

  //#region Properties
  private readonly baseUrl = environment.apiUrl;
  //#endregion

  //#region Constructor
  constructor(private readonly http: HttpClient) {}
  //#endregion

  //#region Public HTTP Methods

  /**
   * Performs a GET request with timeout.
   * @param path Relative path appended to baseUrl (e.g. '/products')
   * @param params Optional query parameters — `HttpParams` instance or plain object literal.
   */
  get<T>(path: string, params?: ApiParams): Observable<T> {
    return this.http
      .get<T>(`${this.baseUrl}${path}`, params ? { params } : {})
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a GET request returning the full `HttpResponse<T>` so callers
   * can read response headers (`ETag`, `Cache-Control`) alongside the body.
   *
   * Introduced by FDD-028 to support ETag / `If-None-Match` negotiation
   * inside `CatalogService`. Other callers should keep using `get<T>()`
   * which returns the body directly. Non-breaking for the ~30 existing
   * call sites.
   *
   * @param path Relative path appended to baseUrl (e.g. '/catalog/macro-categories').
   * @param options Optional `params` and `headers` (e.g. `{ 'If-None-Match': etag }`).
   */
  getFull<T>(
    path: string,
    options?: { params?: ApiParams; headers?: Record<string, string> },
  ): Observable<HttpResponse<T>> {
    return this.http
      .get<T>(`${this.baseUrl}${path}`, {
        observe:  'response',
        params:   options?.params,
        headers:  options?.headers,
      })
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a POST request with timeout.
   * @param path Relative path appended to baseUrl
   * @param body Request body
   * @param params Optional query parameters — `HttpParams` instance or plain object literal.
   */
  post<T>(path: string, body: unknown, params?: ApiParams): Observable<T> {
    return this.http
      .post<T>(`${this.baseUrl}${path}`, body, params ? { params } : {})
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a PUT request with timeout.
   * @param path Relative path appended to baseUrl
   * @param body Request body
   * @param params Optional query parameters — `HttpParams` instance or plain object literal.
   */
  put<T>(path: string, body: unknown, params?: ApiParams): Observable<T> {
    return this.http
      .put<T>(`${this.baseUrl}${path}`, body, params ? { params } : {})
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a PATCH request with timeout.
   * @param path Relative path appended to baseUrl
   * @param body Request body
   * @param params Optional query parameters — `HttpParams` instance or plain object literal.
   */
  patch<T>(path: string, body: unknown, params?: ApiParams): Observable<T> {
    return this.http
      .patch<T>(`${this.baseUrl}${path}`, body, params ? { params } : {})
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a DELETE request with timeout.
   * @param path Relative path appended to baseUrl
   * @param params Optional query parameters — `HttpParams` instance or plain object literal.
   */
  delete<T>(path: string, params?: ApiParams): Observable<T> {
    return this.http
      .delete<T>(`${this.baseUrl}${path}`, params ? { params } : {})
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  //#endregion

  //#region Private Helpers

  /**
   * Centralizes error logging. Re-throws so callers can handle fallbacks.
   */
  private handleError(error: unknown): Observable<never> {
    console.error('[ApiService] Request failed:', error);
    return throwError(() => error);
  }

  //#endregion

}
