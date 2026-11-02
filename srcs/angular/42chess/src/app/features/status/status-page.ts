import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, interval, merge, startWith, Subject, switchMap } from 'rxjs';
import { HealthReport, ServiceName, STATUS_REFRESH_MS, StatusApi } from './status-api';

interface ServiceRow {
  name: string;
  role: string;
  up: boolean | null;
  latencyMs: number | null;
}

const SERVICES: Record<ServiceName, { name: string; role: string }> = {
  database: { name: 'Database', role: 'Accounts, games, puzzles and messages' },
  'chess-engine': { name: 'Rules engine', role: 'Checks every move of every game' },
  bot: { name: 'Computer opponent', role: 'Games against the computer' },
  mail: { name: 'Email', role: 'Verification and password emails' },
};

/** "3 minutes ago": how long ago, in the largest unit that fits. */
export function ago(seconds: number): string {
  const units: [number, string][] = [
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) return `${count} ${unit}${count > 1 ? 's' : ''} ago`;
  }
  return 'less than a minute ago';
}

/**
 * Public status page: the services the site needs and the last database
 * backup, from the API health check, refreshed every 30 seconds while the
 * page is visible.
 */
@Component({
  selector: 'app-status-page',
  imports: [DatePipe],
  templateUrl: './status-page.html',
  styleUrl: './status-page.css',
})
export class StatusPage {
  private readonly api = inject(StatusApi);
  private readonly refreshes = new Subject<void>();

  /** undefined until the first answer; null when the API does not answer. */
  readonly report = signal<HealthReport | null | undefined>(undefined);
  readonly loading = signal(true);
  readonly refreshSeconds = STATUS_REFRESH_MS / 1000;

  readonly overall = computed(() => {
    const report = this.report();
    if (report === undefined) return null;
    if (report === null)
      return {
        tone: 'down',
        title: '42 Chess is unreachable',
        text: 'The server does not answer: games, sign-in and puzzles are unavailable.',
      };
    if (report.status === 'down')
      return {
        tone: 'down',
        title: 'Major outage',
        text: 'The database is unreachable: nothing that needs an account works.',
      };
    if (report.status === 'degraded')
      return {
        tone: 'degraded',
        title: 'Some services are down',
        text: 'The site works, except what depends on the services marked below.',
      };
    return { tone: 'ok', title: 'All systems operational', text: 'Everything works normally.' };
  });

  readonly rows = computed<ServiceRow[]>(() => {
    const report = this.report();
    if (report === undefined) return [];
    const api: ServiceRow = {
      name: 'Website and API',
      role: 'Pages, sign-in and live games',
      up: report !== null,
      latencyMs: null,
    };
    return [
      api,
      ...(Object.keys(SERVICES) as ServiceName[]).map((name) => {
        const check = report?.services.find((service) => service.name === name);
        return {
          ...SERVICES[name],
          up: check ? check.status === 'up' : null,
          latencyMs: check?.latencyMs ?? null,
        };
      }),
    ];
  });

  readonly backup = computed(() => {
    const backup = this.report()?.backup;
    if (!backup) return null;
    if (backup.status === 'missing' || backup.ageSeconds === null)
      return { tone: 'degraded', text: 'No backup has been recorded yet.', at: null };
    return {
      tone: backup.status === 'ok' ? 'ok' : 'degraded',
      text: `${backup.status === 'ok' ? 'Last backup' : 'Late: the last backup was'} ${ago(backup.ageSeconds)}.`,
      at: backup.lastSuccess,
    };
  });

  constructor() {
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    merge(interval(STATUS_REFRESH_MS).pipe(filter(visible)), this.refreshes)
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.loading.set(true);
          return this.api.health();
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((report) => {
        this.report.set(report);
        this.loading.set(false);
      });
  }

  refresh(): void {
    this.refreshes.next();
  }
}
