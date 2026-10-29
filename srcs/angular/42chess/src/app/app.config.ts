import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { apiErrorInterceptor } from './core/api/api-error.interceptor';
import { GlobalErrorHandler } from './core/errors/global-error-handler';
import { authInterceptor } from './core/auth/auth.interceptor';
import { SessionRefresh } from './core/auth/session-refresh';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    provideHttpClient(withInterceptors([apiErrorInterceptor, authInterceptor])),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Non-blocking: pages render at once, and guarded routes wait for this answer.
    provideAppInitializer(() => inject(SessionRefresh).restore()),
  ],
};
