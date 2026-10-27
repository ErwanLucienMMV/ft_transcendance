import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'verify-email', renderMode: RenderMode.Client },
  { path: 'two-factor', renderMode: RenderMode.Client },
  { path: 'session', renderMode: RenderMode.Client },
  { path: 'oauth/callback', renderMode: RenderMode.Client },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
