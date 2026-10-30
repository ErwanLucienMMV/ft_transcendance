import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { GamesApi } from './games-api';
import { MATCHMAKING_HEARTBEAT_MS, MatchmakingApi } from './matchmaking';
import { PlayPage } from './play-page';

function refusal(code: string, message = 'No.') {
  return throwError(
    () =>
      new ApiError(
        new HttpErrorResponse({ status: 409, error: { statusCode: 409, code, message } }),
      ),
  );
}

describe('Play page', () => {
  let api: {
    create: ReturnType<typeof vi.fn>;
    createBot: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let queue: {
    status: ReturnType<typeof vi.fn>;
    join: ReturnType<typeof vi.fn>;
    heartbeat: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
  };
  let events: Subject<ServerEvent>;
  beforeEach(() => {
    api = { create: vi.fn(), createBot: vi.fn(), get: vi.fn() };
    queue = {
      status: vi.fn().mockReturnValue(of({ status: 'IDLE' })),
      join: vi.fn().mockReturnValue(of({ status: 'WAITING', joinedAt: new Date().toISOString() })),
      heartbeat: vi.fn().mockReturnValue(of({ status: 'WAITING' })),
      leave: vi.fn().mockReturnValue(of({ status: 'CANCELLED' })),
    };
    events = new Subject();
    TestBed.configureTestingModule({
      imports: [PlayPage],
      providers: [
        provideRouter([]),
        { provide: GamesApi, useValue: api },
        { provide: MatchmakingApi, useValue: queue },
        { provide: RealtimeService, useValue: { events, connect: vi.fn() } },
      ],
    });
  });

  it('creates a game with the chosen time control and opens it', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    api.create.mockReturnValue(of({ gameId: 'game-1', status: 'WAITING' }));
    const fixture = TestBed.createComponent(PlayPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    (element.querySelectorAll('input[type="radio"]')[0] as HTMLInputElement).click();
    fixture.detectChanges();
    (element.querySelectorAll('.play-card > button')[1] as HTMLButtonElement).click();
    expect(api.create).toHaveBeenCalledWith({ initialTime: 180_000, increment: 2_000 });
    expect(navigate).toHaveBeenCalledWith(['/game', 'game-1']);
  });

  it('shows why a game could not be created and allows another try', () => {
    api.create.mockReturnValue(
      throwError(
        () =>
          new ApiError(
            new HttpErrorResponse({
              status: 409,
              error: { statusCode: 409, code: 'X', message: 'Server says no.' },
            }),
          ),
      ),
    );
    const fixture = TestBed.createComponent(PlayPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelectorAll('.play-card > button')[1] as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Server says no.');
    expect(button.disabled).toBe(false);
  });

  it('starts a bot game with the chosen level, colour and time control', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    api.createBot.mockReturnValue(of({ gameId: 'bot-game' }));
    const fixture = TestBed.createComponent(PlayPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const pick = (name: string, value: string) => {
      (
        element.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement
      ).click();
      fixture.detectChanges();
    };
    pick('time-control', '5 + 0');
    pick('bot-level', 'HARD');
    pick('bot-color', 'BLACK');
    expect(element.querySelector('.choice.chosen strong')?.textContent).toBe('5 + 0');
    (element.querySelectorAll('.play-card > button')[2] as HTMLButtonElement).click();
    expect(api.createBot).toHaveBeenCalledWith({
      difficulty: 'HARD',
      color: 'BLACK',
      timeControl: { initialTime: 300_000, increment: 0 },
    });
    expect(navigate).toHaveBeenCalledWith(['/game', 'bot-game']);
  });

  it('draws a colour for a random choice and explains a refused bot game', () => {
    api.createBot.mockReturnValue(
      throwError(
        () =>
          new ApiError(
            new HttpErrorResponse({
              status: 409,
              error: {
                statusCode: 409,
                code: 'BOT_GAME_LIMIT',
                message: 'Finish or resign your active bot game before creating another.',
              },
            }),
          ),
      ),
    );
    const fixture = TestBed.createComponent(PlayPage);
    fixture.detectChanges();
    fixture.componentInstance.color.set('RANDOM');
    fixture.componentInstance.createBot(() => 0.9);
    expect(api.createBot.mock.calls[0][0].color).toBe('BLACK');
    fixture.componentInstance.createBot(() => 0.1);
    expect(api.createBot.mock.calls[1][0].color).toBe('WHITE');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Finish or resign your active bot game',
    );
    expect(fixture.componentInstance.botCreating()).toBe(false);
  });

  function render() {
    const fixture = TestBed.createComponent(PlayPage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const card = () => element.querySelector('[aria-labelledby="match-title"]') as HTMLElement;
    const press = (name: string) => {
      (
        [...card().querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === name,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
    };
    return { fixture, element, card, press };
  }

  it('queues with the chosen time control, waits, then opens the game MATCH_FOUND names', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { fixture, element, card, press } = render();
    (element.querySelector('input[value="5 + 0"]') as HTMLInputElement).click();
    fixture.detectChanges();
    press('Find an opponent');
    expect(queue.join).toHaveBeenCalledWith({ initialTime: 300_000, increment: 0 });
    expect(card().querySelector('[role="status"]')?.textContent).toMatch(
      /Searching for a 5 \+ 0 opponent · 0:0\d/,
    );
    // While queued, nothing else can start a game or change the time control.
    const others = [...element.querySelectorAll('.play-card > button')].slice(1);
    expect(others.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((element.querySelector('input[value="10 + 0"]') as HTMLInputElement).disabled).toBe(
      true,
    );
    events.next({ event: 'MATCH_FOUND', data: { gameId: 'g1', color: 'WHITE', opponentId: 'o' } });
    expect(navigate).toHaveBeenCalledWith(['/game', 'g1']);
    fixture.destroy();
    expect(queue.leave).not.toHaveBeenCalled();
  });

  it('cancels a search, unless the match was already made', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const first = render();
    first.press('Find an opponent');
    first.press('Cancel search');
    expect(queue.leave).toHaveBeenCalledTimes(1);
    expect(first.card().textContent).toContain('Find an opponent');
    queue.leave.mockReturnValue(of({ status: 'MATCHED', gameId: 'g2' }));
    first.press('Find an opponent');
    first.press('Cancel search');
    expect(navigate).toHaveBeenCalledWith(['/game', 'g2']);
  });

  it('finds a match missed on the socket through the heartbeat', () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const { press } = render();
      press('Find an opponent');
      queue.heartbeat.mockReturnValue(of({ status: 'MATCHED', gameId: 'g3' }));
      vi.advanceTimersByTime(MATCHMAKING_HEARTBEAT_MS);
      expect(navigate).toHaveBeenCalledWith(['/game', 'g3']);
      vi.advanceTimersByTime(MATCHMAKING_HEARTBEAT_MS * 3);
      expect(queue.heartbeat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the search alive with heartbeats until it is cancelled', () => {
    vi.useFakeTimers();
    try {
      const { press } = render();
      press('Find an opponent');
      // The 30 s lease only lasts if heartbeats keep coming; reading the status does not renew it.
      vi.advanceTimersByTime(60_000);
      expect(queue.heartbeat).toHaveBeenCalledTimes(60_000 / MATCHMAKING_HEARTBEAT_MS);
      expect(queue.status).toHaveBeenCalledTimes(1);
      press('Cancel search');
      vi.advanceTimersByTime(60_000);
      expect(queue.heartbeat).toHaveBeenCalledTimes(60_000 / MATCHMAKING_HEARTBEAT_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the server let the search expire', () => {
    vi.useFakeTimers();
    try {
      const { fixture, card, press } = render();
      press('Find an opponent');
      queue.heartbeat.mockReturnValue(of({ status: 'CANCELLED' }));
      vi.advanceTimersByTime(MATCHMAKING_HEARTBEAT_MS);
      fixture.detectChanges();
      expect(card().querySelector('[role="alert"]')?.textContent).toContain('The search expired.');
      expect(card().textContent).toContain('Find an opponent');
      vi.advanceTimersByTime(MATCHMAKING_HEARTBEAT_MS * 3);
      expect(queue.heartbeat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the queue when the page closes while the join is still pending', () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const joined = new Subject<{ status: 'WAITING'; joinedAt: string }>();
      queue.join.mockReturnValue(joined);
      const { fixture, press } = render();
      press('Find an opponent');
      fixture.destroy();
      expect(queue.leave).toHaveBeenCalledTimes(1);
      // The join lands after the first leave: leave again, and nothing keeps running.
      joined.next({ status: 'WAITING', joinedAt: new Date().toISOString() });
      expect(queue.leave).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(MATCHMAKING_HEARTBEAT_MS * 4);
      expect(queue.heartbeat).not.toHaveBeenCalled();
      events.next({
        event: 'MATCH_FOUND',
        data: { gameId: 'g4', color: 'WHITE', opponentId: 'o' },
      });
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the heartbeat when the page closes during a search', () => {
    vi.useFakeTimers();
    try {
      const { fixture, press } = render();
      press('Find an opponent');
      fixture.destroy();
      expect(queue.leave).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(MATCHMAKING_HEARTBEAT_MS * 4);
      expect(queue.heartbeat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a search after a reload and reopens only a match still in progress', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    queue.status.mockReturnValue(
      of({ status: 'WAITING', joinedAt: new Date(Date.now() - 75_000).toISOString() }),
    );
    const waiting = render();
    expect(waiting.card().querySelector('time')?.textContent).toBe('1:15');
    waiting.fixture.destroy();
    // Leaving the page leaves the queue, so nobody is matched while away.
    expect(queue.leave).toHaveBeenCalledTimes(1);

    queue.status.mockReturnValue(of({ status: 'MATCHED', gameId: 'old' }));
    api.get.mockReturnValue(of({ status: 'FINISHED' }));
    render();
    expect(navigate).not.toHaveBeenCalled();
    api.get.mockReturnValue(of({ status: 'ACTIVE' }));
    render();
    expect(navigate).toHaveBeenCalledWith(['/game', 'old']);
  });

  it('explains why a search cannot start', () => {
    queue.join.mockReturnValue(refusal('ACTIVE_GAME_EXISTS'));
    const { card, press } = render();
    press('Find an opponent');
    expect(card().querySelector('[role="alert"]')?.textContent).toContain(
      'You already have a game in progress.',
    );
    expect(card().textContent).toContain('Find an opponent');
  });
});
