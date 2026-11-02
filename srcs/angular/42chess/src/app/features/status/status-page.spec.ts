import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { HealthReport, StatusApi } from './status-api';
import { ago, StatusPage } from './status-page';

function report(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    status: 'ok',
    checkedAt: '2026-11-02T18:00:00.000Z',
    services: [
      { name: 'database', status: 'up', latencyMs: 3 },
      { name: 'chess-engine', status: 'up', latencyMs: 5 },
      { name: 'bot', status: 'up', latencyMs: 4 },
      { name: 'mail', status: 'up', latencyMs: 8 },
    ],
    backup: {
      status: 'ok',
      lastSuccess: '2026-11-02T17:00:03.000Z',
      ageSeconds: 1380,
      maxAgeSeconds: 7200,
    },
    ...overrides,
  };
}

describe('Status page', () => {
  function create(health: () => ReturnType<StatusApi['health']>) {
    const calls = { count: 0 };
    TestBed.configureTestingModule({
      imports: [StatusPage],
      providers: [
        {
          provide: StatusApi,
          useValue: {
            health: () => {
              calls.count++;
              return health();
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(StatusPage);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement, calls };
  }

  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();
  const rows = (element: HTMLElement) =>
    [...element.querySelectorAll('.services li')].map((li) => [
      li.querySelector('strong')?.textContent,
      li.querySelector('.state span:not(.dot)')?.textContent,
      li.className,
    ]);

  it('says everything works, service by service, with the last backup', () => {
    const { element } = create(() => of(report()));
    expect(text(element.querySelector('.overall h2'))).toBe('All systems operational');
    expect(rows(element)).toEqual([
      ['Website and API', 'Operational', 'ok'],
      ['Database', 'Operational', 'ok'],
      ['Rules engine', 'Operational', 'ok'],
      ['Computer opponent', 'Operational', 'ok'],
      ['Email', 'Operational', 'ok'],
    ]);
    expect(element.querySelector('.services li:nth-child(2) .state small')?.textContent).toBe(
      '3 ms',
    );
    expect(text(element.querySelector('.backup p span'))).toBe('Last backup 23 minutes ago.');
    expect(text(element.querySelector('.backup p small'))).toBe('(2026-11-02 17:00 UTC)');
  });

  it('names the services that are down and a late backup', () => {
    const { element } = create(() =>
      of(
        report({
          status: 'degraded',
          services: [
            { name: 'database', status: 'up', latencyMs: 3 },
            { name: 'chess-engine', status: 'up', latencyMs: 5 },
            { name: 'bot', status: 'down', latencyMs: null },
            { name: 'mail', status: 'up', latencyMs: 8 },
          ],
          backup: {
            status: 'stale',
            lastSuccess: '2026-11-02T14:00:00.000Z',
            ageSeconds: 4 * 3600 + 60,
            maxAgeSeconds: 7200,
          },
        }),
      ),
    );
    expect(text(element.querySelector('.overall h2'))).toBe('Some services are down');
    expect(element.querySelector('.overall')?.classList).toContain('degraded');
    expect(rows(element)[3]).toEqual(['Computer opponent', 'Down', 'down']);
    expect(text(element.querySelector('.backup p span'))).toBe(
      'Late: the last backup was 4 hours ago.',
    );
  });

  it('reports a major outage without the database, and an unreachable API', () => {
    const down = create(() =>
      of(
        report({
          status: 'down',
          services: [{ name: 'database', status: 'down', latencyMs: null }],
          backup: { status: 'missing', lastSuccess: null, ageSeconds: null, maxAgeSeconds: 7200 },
        }),
      ),
    );
    expect(text(down.element.querySelector('.overall h2'))).toBe('Major outage');
    expect(rows(down.element)[2]).toEqual(['Rules engine', 'Unknown', 'unknown']);
    expect(text(down.element.querySelector('.backup p span'))).toBe(
      'No backup has been recorded yet.',
    );
    TestBed.resetTestingModule();

    const unreachable = create(() => of(null));
    expect(text(unreachable.element.querySelector('.overall h2'))).toBe('42 Chess is unreachable');
    expect(rows(unreachable.element)[0]).toEqual(['Website and API', 'Down', 'down']);
    expect(unreachable.element.querySelector('.backup')).toBeNull();
  });

  it('checks again on demand, and shows that it is checking', () => {
    const answers = new Subject<HealthReport | null>();
    const { fixture, element, calls } = create(() => answers);
    expect(text(element.querySelector('.empty'))).toBe('Checking the services…');
    answers.next(report());
    fixture.detectChanges();
    const button = element.querySelector<HTMLButtonElement>('.checked button')!;
    expect(button.disabled).toBe(false);
    button.click();
    fixture.detectChanges();
    expect(calls.count).toBe(2);
    expect(button.disabled).toBe(true);
    expect(text(button)).toBe('Checking…');
  });

  it('says how long ago in words', () => {
    expect(ago(30)).toBe('less than a minute ago');
    expect(ago(60)).toBe('1 minute ago');
    expect(ago(7200)).toBe('2 hours ago');
    expect(ago(3 * 86_400 + 5)).toBe('3 days ago');
  });
});
