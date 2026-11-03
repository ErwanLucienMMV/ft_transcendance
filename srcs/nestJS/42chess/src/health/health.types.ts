/** The services the API needs, as the status page and the alerts name them. */
export const SERVICE_NAMES = [
  'database',
  'chess-engine',
  'bot',
  'mail',
] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface ServiceCheck {
  name: ServiceName;
  status: 'up' | 'down';
  /** Time the check took, in milliseconds; null when it timed out. */
  latencyMs: number | null;
}

export interface BackupStatus {
  /** `stale` past `maxAgeSeconds`; `missing` when no backup was ever recorded. */
  status: 'ok' | 'stale' | 'missing';
  lastSuccess: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number;
}

export interface HealthReport {
  /** `down` without the database (HTTP 503), `degraded` when another service is down. */
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  services: ServiceCheck[];
  backup: BackupStatus;
}
