import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

/** Each title is a key under `titles` of the dictionaries, translated by PageTitle. */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'board',
    title: 'board',
    loadComponent: () => import('./features/board/board-page').then((m) => m.BoardPage),
  },
  {
    path: 'play',
    title: 'play',
    canActivate: [authGuard],
    loadComponent: () => import('./features/game/play-page').then((m) => m.PlayPage),
  },
  {
    path: 'game/:id',
    title: 'game',
    canActivate: [authGuard],
    loadComponent: () => import('./features/game/game-page').then((m) => m.GamePage),
  },
  {
    path: 'puzzle',
    title: 'puzzle',
    loadComponent: () => import('./features/puzzle/puzzle-page').then((m) => m.PuzzlePage),
  },
  {
    path: 'puzzle/archive',
    title: 'puzzleArchive',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/puzzle/puzzle-archive-page').then((m) => m.PuzzleArchivePage),
  },
  {
    path: 'puzzle/:id',
    title: 'puzzleOne',
    loadComponent: () => import('./features/puzzle/puzzle-page').then((m) => m.PuzzlePage),
  },
  {
    path: 'leaderboard',
    title: 'leaderboard',
    loadComponent: () =>
      import('./features/progression/leaderboard-page').then((m) => m.LeaderboardPage),
  },
  {
    path: 'progression',
    title: 'progression',
    loadComponent: () => import('./features/progression/rules-page').then((m) => m.RulesPage),
  },
  {
    path: 'status',
    title: 'status',
    loadComponent: () => import('./features/status/status-page').then((m) => m.StatusPage),
  },
  {
    path: 'live',
    title: 'live',
    loadComponent: () => import('./features/live/live-page').then((m) => m.LivePage),
  },
  {
    path: 'history',
    title: 'history',
    canActivate: [authGuard],
    loadComponent: () => import('./features/history/history-page').then((m) => m.HistoryPage),
  },
  {
    path: 'replay/:id',
    title: 'replay',
    loadComponent: () => import('./features/history/replay-page').then((m) => m.ReplayPage),
  },
  {
    path: 'players/:id',
    title: 'profile',
    loadComponent: () => import('./features/social/profile-page').then((m) => m.ProfilePage),
  },
  {
    path: 'friends',
    title: 'friends',
    canActivate: [authGuard],
    loadComponent: () => import('./features/social/friends-page').then((m) => m.FriendsPage),
  },
  {
    path: 'messages',
    title: 'messages',
    canActivate: [authGuard],
    loadComponent: () => import('./features/chat/messages-page').then((m) => m.MessagesPage),
  },
  {
    path: 'messages/:userId',
    title: 'messages',
    canActivate: [authGuard],
    loadComponent: () => import('./features/chat/messages-page').then((m) => m.MessagesPage),
  },
  {
    path: 'login',
    title: 'login',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: 'register',
    loadComponent: () => import('./features/auth/register-page').then((m) => m.RegisterPage),
  },
  {
    path: 'verify-email',
    title: 'verifyEmail',
    loadComponent: () => import('./features/auth/verify-email-page').then((m) => m.VerifyEmailPage),
  },
  {
    path: 'two-factor',
    title: 'twoFactor',
    loadComponent: () => import('./features/auth/two-factor-page').then((m) => m.TwoFactorPage),
  },
  {
    path: 'session',
    title: 'session',
    canActivate: [authGuard],
    loadComponent: () => import('./features/auth/session-page').then((m) => m.SessionPage),
  },
  {
    path: 'settings',
    title: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'forgot-password',
    title: 'forgotPassword',
    loadComponent: () =>
      import('./features/auth/forgot-password-page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    title: 'resetPassword',
    loadComponent: () =>
      import('./features/auth/reset-password-page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'oauth/callback',
    title: 'oauth',
    loadComponent: () =>
      import('./features/auth/oauth-callback-page').then((m) => m.OAuthCallbackPage),
  },
  {
    path: 'rules',
    title: 'rules',
    loadComponent: () => import('./features/help/rules-page').then((m) => m.RulesPage),
  },
  {
    path: 'design',
    title: 'design',
    loadComponent: () => import('./features/design/design-page').then((m) => m.DesignPage),
  },
  {
    path: 'privacy',
    title: 'privacy',
    loadComponent: () => import('./features/legal/privacy-page').then((m) => m.PrivacyPage),
  },
  {
    path: 'terms',
    title: 'terms',
    loadComponent: () => import('./features/legal/terms-page').then((m) => m.TermsPage),
  },
  {
    path: '**',
    title: 'notFound',
    loadComponent: () => import('./features/home/not-found-page').then((m) => m.NotFoundPage),
  },
];
