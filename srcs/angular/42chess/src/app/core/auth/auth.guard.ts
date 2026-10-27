import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthSession } from './auth-session';
import { safeReturnUrl } from './auth.interceptor';

export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthSession).authenticated() ||
  inject(Router).createUrlTree(['/login'], {
    queryParams: { returnUrl: safeReturnUrl(state.url) },
  });
