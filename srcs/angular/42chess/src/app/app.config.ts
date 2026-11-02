import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, TitleStrategy, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withNoIncrementalHydration } from '@angular/platform-browser';
import { apiErrorInterceptor } from './core/api/api-error.interceptor';
import { GlobalErrorHandler } from './core/errors/global-error-handler';
import { authInterceptor } from './core/auth/auth.interceptor';
import { SessionRefresh } from './core/auth/session-refresh';
import { PageTitle } from './core/title/page-title';
import { I18n, provideI18n } from './core/i18n/i18n';
import { Preferences } from './core/preferences/preferences';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Links such as /settings#privacy land on their section; a new page starts at the top.
    provideRouter(
      routes,
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    // Incremental hydration inlines an event-replay script that a strict CSP would block.
    provideClientHydration(withNoIncrementalHydration()),
    provideHttpClient(withInterceptors([apiErrorInterceptor, authInterceptor])),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Route titles, prefixed with unread messages and "Your move".
    { provide: TitleStrategy, useExisting: PageTitle },
    provideI18n(),
    // The first page is drawn in the player's language: its texts load before it.
    provideAppInitializer(() => inject(I18n).use(inject(Preferences).language())),
    // Non-blocking: pages render at once, and guarded routes wait for this answer.
    provideAppInitializer(() => inject(SessionRefresh).restore()),
  ],
};
