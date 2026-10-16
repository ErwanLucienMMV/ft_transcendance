import { InjectionToken } from '@angular/core';

export interface ServerAuthCapabilities {
  readonly logout: boolean;
  readonly currentUser: boolean;
}
/** Enable only after SCRUM-78/79/80 have landed and real integration tests pass. */
export const SERVER_AUTH_CAPABILITIES = new InjectionToken<ServerAuthCapabilities>(
  'SERVER_AUTH_CAPABILITIES',
  {
    providedIn: 'root',
    factory: () => ({ logout: false, currentUser: false }),
  },
);
