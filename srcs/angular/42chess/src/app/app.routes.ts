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
    path: '**',
    title: 'Page not found | 42 Chess',
    loadComponent: () => import('./features/home/not-found-page').then((m) => m.NotFoundPage),
  },
];
