import { APP_INITIALIZER, ApplicationConfig, inject, isDevMode } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MessageService } from 'primeng/api';

import { pendingRequestsInterceptor$ } from 'ng-http-loader';

import { authInterceptor } from './core/interceptors/auth.interceptor';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { appRoutes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { ConfigService } from './core/services/config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, pendingRequestsInterceptor$])),
    provideAnimations(),
    MessageService,
    {
      provide: APP_INITIALIZER,
      useFactory: (authService: AuthService, configService: ConfigService) => () =>
        authService.isAuthenticated() ? configService.load() : Promise.resolve(),
      deps: [AuthService, ConfigService],
      multi: true,
    },
    provideServiceWorker('ngsw-worker.js', {
      // Enabled only in production — dev mode uses live reload which conflicts with SW
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
