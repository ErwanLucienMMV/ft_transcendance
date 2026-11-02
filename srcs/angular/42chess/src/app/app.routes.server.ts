import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'verify-email', renderMode: RenderMode.Client },
  { path: 'two-factor', renderMode: RenderMode.Client },
  { path: 'session', renderMode: RenderMode.Client },
  { path: 'play', renderMode: RenderMode.Client },
  { path: 'puzzle', renderMode: RenderMode.Client },
  { path: 'puzzle/archive', renderMode: RenderMode.Client },
  { path: 'puzzle/:id', renderMode: RenderMode.Client },
  { path: 'leaderboard', renderMode: RenderMode.Client },
  { path: 'progression', renderMode: RenderMode.Client },
  { path: 'game/:id', renderMode: RenderMode.Client },
  { path: 'live', renderMode: RenderMode.Client },
  { path: 'history', renderMode: RenderMode.Client },
  { path: 'replay/:id', renderMode: RenderMode.Client },
  { path: 'players/:id', renderMode: RenderMode.Client },
  { path: 'friends', renderMode: RenderMode.Client },
  { path: 'messages', renderMode: RenderMode.Client },
  { path: 'messages/:userId', renderMode: RenderMode.Client },
  { path: 'oauth/callback', renderMode: RenderMode.Client },
  { path: 'settings', renderMode: RenderMode.Client },
  { path: 'reset-password', renderMode: RenderMode.Client },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
