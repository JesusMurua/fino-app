import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timeout, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';

/** Default request timeout in milliseconds — treat as offline after this */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Centralized HTTP wrapper around Angular HttpClient.
 *
 * - Base URL from environment.apiUrl
 * - 10-second timeout on every request (RxJS timeout operator)
 * - Auth headers are handled by authInterceptor — not here
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
   */
  get<T>(path: string): Observable<T> {
    return this.http
      .get<T>(`${this.baseUrl}${path}`)
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a POST request with timeout.
   * @param path Relative path appended to baseUrl
   * @param body Request body
   */
  post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<T>(`${this.baseUrl}${path}`, body)
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a PUT request with timeout.
   * @param path Relative path appended to baseUrl
   * @param body Request body
   */
  put<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .put<T>(`${this.baseUrl}${path}`, body)
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a PATCH request with timeout.
   * @param path Relative path appended to baseUrl
   * @param body Request body
   */
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .patch<T>(`${this.baseUrl}${path}`, body)
      .pipe(
        timeout(REQUEST_TIMEOUT_MS),
        catchError(error => this.handleError(error)),
      );
  }

  /**
   * Performs a DELETE request with timeout.
   * @param path Relative path appended to baseUrl
   */
  delete<T>(path: string): Observable<T> {
    return this.http
      .delete<T>(`${this.baseUrl}${path}`)
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
