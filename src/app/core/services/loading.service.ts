import { Injectable, signal, computed } from '@angular/core';

/**
 * Tracks in-flight HTTP requests.
 * Exposes a boolean signal consumed by the global loading bar.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {

  private readonly activeRequests = signal(0);

  /** True when at least one HTTP request is in-flight */
  readonly isLoading = computed(() => this.activeRequests() > 0);

  /** Called by the loading interceptor when a request starts */
  start(): void {
    this.activeRequests.update(n => n + 1);
  }

  /** Called by the loading interceptor when a request completes or errors */
  stop(): void {
    this.activeRequests.update(n => Math.max(0, n - 1));
  }

}
