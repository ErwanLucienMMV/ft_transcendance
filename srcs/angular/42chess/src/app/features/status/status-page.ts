import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, interval, merge, startWith, Subject, switchMap } from 'rxjs';
import { HealthReport, ServiceName, STATUS_REFRESH_MS, StatusApi } from './status-api';
import { tr, trCount } from '../../core/i18n/i18n';
import { TranslocoDirective } from '@jsverse/transloco';
import { LocalDatePipe } from '../../shared/ui/local-date';

interface ServiceRow {
  name: string;
  role: string;
  up: boolean | null;
  latencyMs: number | null;
}

const SERVICES: readonly ServiceName[] = ['database', 'chess-engine', 'bot', 'mail'];

/** The name and role of a service row, in the language shown (`status.list`). */
function service(key: ServiceName | 'api'): { name: string; role: string } {
  return { name: tr(`status.list.${key}.name`), role: tr(`status.list.${key}.role`) };
}

/** "3 minutes ago": how long ago, in the largest unit that fits. */
export function ago(seconds: number): string {
  const units: [number, 'day' | 'hour' | 'minute'][] = [
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) return trCount(`status.ago.${unit}`, count);
  }
  return tr('status.ago.now');
}

function texts(state: 'unreachable' | 'outage' | 'degraded' | 'ok') {
  return { title: tr(`status.${state}.title`), text: tr(`status.${state}.text`) };
}

/**
 * Public status page: the services the site needs and the last database
 * backup, from the API health check, refreshed every 30 seconds while the
 * page is visible.
 */
@Component({
  selector: 'app-status-page',
  imports: [LocalDatePipe, TranslocoDirective],
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
    if (report === null) return { tone: 'down', ...texts('unreachable') };
    if (report.status === 'down') return { tone: 'down', ...texts('outage') };
    if (report.status === 'degraded') return { tone: 'degraded', ...texts('degraded') };
    return { tone: 'ok', ...texts('ok') };
  });

  readonly rows = computed<ServiceRow[]>(() => {
    const report = this.report();
    if (report === undefined) return [];
    const api: ServiceRow = {
      ...service('api'),
      up: report !== null,
      latencyMs: null,
    };
    return [
      api,
      ...SERVICES.map((name) => {
        const check = report?.services.find((entry) => entry.name === name);
        return {
          ...service(name),
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
      return { tone: 'degraded', text: tr('status.noBackup'), at: null };
    return {
      tone: backup.status === 'ok' ? 'ok' : 'degraded',
      text: tr(backup.status === 'ok' ? 'status.lastBackup' : 'status.lateBackup', {
        ago: ago(backup.ageSeconds),
      }),
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
