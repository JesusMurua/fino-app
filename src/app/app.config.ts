import { APP_INITIALIZER, ApplicationConfig, LOCALE_ID, inject, isDevMode } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MessageService } from 'primeng/api';

registerLocaleData(localeEs);

import { pendingRequestsInterceptor$ } from 'ng-http-loader';

import { authInterceptor } from './core/interceptors/auth.interceptor';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { appRoutes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { ConfigService } from './core/services/config.service';
import { SessionRehydrationService } from './core/services/session-rehydration.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, pendingRequestsInterceptor$])),
    provideAnimations(),
    MessageService,
    { provide: LOCALE_ID, useValue: 'es' },
    {
      provide: APP_INITIALIZER,
      useFactory: (
        authService: AuthService,
        configService: ConfigService,
        sessionRehydration: SessionRehydrationService,
      ) => () => {
        if (!authService.isAuthenticated()) return Promise.resolve();
        // Fire rehydration in the background — bootstrap must not wait
        // on the network. The local cached session is already trustworthy
        // enough to render the first route; `/auth/me` catches up behind.
        sessionRehydration.hydrateOnBoot();
        return configService.load();
      },
      deps: [AuthService, ConfigService, SessionRehydrationService],
      multi: true,
    },
    provideServiceWorker('ngsw-worker.js', {
      // Enabled only in production — dev mode uses live reload which conflicts with SW
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
