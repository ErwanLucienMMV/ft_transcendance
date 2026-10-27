import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: '42 Chess',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'board',
    title: 'Analysis board | 42 Chess',
    loadComponent: () => import('./features/board/board-page').then((m) => m.BoardPage),
  },
  {
    path: 'play',
    title: 'Play | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/game/play-page').then((m) => m.PlayPage),
  },
  {
    path: 'game/:id',
    title: 'Live game | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/game/game-page').then((m) => m.GamePage),
  },
  {
    path: 'login',
    title: 'Sign in | 42 Chess',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: 'Create an account | 42 Chess',
    loadComponent: () => import('./features/auth/register-page').then((m) => m.RegisterPage),
  },
  {
    path: 'verify-email',
    title: 'Verify email | 42 Chess',
    loadComponent: () => import('./features/auth/verify-email-page').then((m) => m.VerifyEmailPage),
  },
  {
    path: 'two-factor',
    title: 'Two-factor authentication | 42 Chess',
    loadComponent: () => import('./features/auth/two-factor-page').then((m) => m.TwoFactorPage),
  },
  {
    path: 'session',
    title: 'Session | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/auth/session-page').then((m) => m.SessionPage),
  },
  {
    path: 'oauth/callback',
    title: 'Completing sign-in | 42 Chess',
    loadComponent: () =>
      import('./features/auth/oauth-callback-page').then((m) => m.OAuthCallbackPage),
  },
  {
    path: '**',
    title: 'Page not found | 42 Chess',
    loadComponent: () => import('./features/home/not-found-page').then((m) => m.NotFoundPage),
  },
];
