import { inject, Injector } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthSession } from './auth-session';
import { safeReturnUrl } from './auth.interceptor';
import { SessionRefresh } from './session-refresh';

/** After a reload, waits for the refresh cookie to be tried before sending anyone to /login. */
export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(AuthSession);
  const router = inject(Router);
  const refresh = inject(SessionRefresh);
  const decide = () =>
    session.authenticated() ||
    router.createUrlTree(['/login'], { queryParams: { returnUrl: safeReturnUrl(state.url) } });
  if (session.authenticated() || refresh.settled()) return decide();
  return toObservable(refresh.settled, { injector: inject(Injector) }).pipe(
    filter(Boolean),
    take(1),
    map(decide),
  );
};
