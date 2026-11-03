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
    path: 'puzzle',
    title: 'Daily puzzle | 42 Chess',
    loadComponent: () => import('./features/puzzle/puzzle-page').then((m) => m.PuzzlePage),
  },
  {
    path: 'puzzle/archive',
    title: 'Puzzle archive | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/puzzle/puzzle-archive-page').then((m) => m.PuzzleArchivePage),
  },
  {
    path: 'puzzle/:id',
    title: 'Puzzle | 42 Chess',
    loadComponent: () => import('./features/puzzle/puzzle-page').then((m) => m.PuzzlePage),
  },
  {
    path: 'leaderboard',
    title: 'Leaderboard | 42 Chess',
    loadComponent: () =>
      import('./features/progression/leaderboard-page').then((m) => m.LeaderboardPage),
  },
  {
    path: 'progression',
    title: 'How progression works | 42 Chess',
    loadComponent: () => import('./features/progression/rules-page').then((m) => m.RulesPage),
  },
  {
    path: 'status',
    title: 'Service status | 42 Chess',
    loadComponent: () => import('./features/status/status-page').then((m) => m.StatusPage),
  },
  {
    path: 'live',
    title: 'Live games | 42 Chess',
    loadComponent: () => import('./features/live/live-page').then((m) => m.LivePage),
  },
  {
    path: 'history',
    title: 'Game history | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/history/history-page').then((m) => m.HistoryPage),
  },
  {
    path: 'replay/:id',
    title: 'Game replay | 42 Chess',
    loadComponent: () => import('./features/history/replay-page').then((m) => m.ReplayPage),
  },
  {
    path: 'players/:id',
    title: 'Player profile | 42 Chess',
    loadComponent: () => import('./features/social/profile-page').then((m) => m.ProfilePage),
  },
  {
    path: 'friends',
    title: 'Friends | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/social/friends-page').then((m) => m.FriendsPage),
  },
  {
    path: 'messages',
    title: 'Messages | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/chat/messages-page').then((m) => m.MessagesPage),
  },
  {
    path: 'messages/:userId',
    title: 'Messages | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/chat/messages-page').then((m) => m.MessagesPage),
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
    path: 'settings',
    title: 'Settings | 42 Chess',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'forgot-password',
    title: 'Forgot your password | 42 Chess',
    loadComponent: () =>
      import('./features/auth/forgot-password-page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    title: 'Choose a new password | 42 Chess',
    loadComponent: () =>
      import('./features/auth/reset-password-page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'oauth/callback',
    title: 'Completing sign-in | 42 Chess',
    loadComponent: () =>
      import('./features/auth/oauth-callback-page').then((m) => m.OAuthCallbackPage),
  },
  {
    path: 'rules',
    title: 'How games end | 42 Chess',
    loadComponent: () => import('./features/help/rules-page').then((m) => m.RulesPage),
  },
  {
    path: 'privacy',
    title: 'Privacy Policy | 42 Chess',
    loadComponent: () => import('./features/legal/privacy-page').then((m) => m.PrivacyPage),
  },
  {
    path: 'terms',
    title: 'Terms of Service | 42 Chess',
    loadComponent: () => import('./features/legal/terms-page').then((m) => m.TermsPage),
  },
  {
    path: '**',
    title: 'Page not found | 42 Chess',
    loadComponent: () => import('./features/home/not-found-page').then((m) => m.NotFoundPage),
  },
];
