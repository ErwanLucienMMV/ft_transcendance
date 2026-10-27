import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { GamesApi } from './games-api';
import { PlayPage } from './play-page';

describe('Play page', () => {
  let api: { create: ReturnType<typeof vi.fn>; createBot: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    api = { create: vi.fn(), createBot: vi.fn() };
    TestBed.configureTestingModule({
      imports: [PlayPage],
      providers: [provideRouter([]), { provide: GamesApi, useValue: api }],
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
    (element.querySelectorAll('.play-card > button')[0] as HTMLButtonElement).click();
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
    const button = element.querySelectorAll('.play-card > button')[0] as HTMLButtonElement;
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
    (element.querySelectorAll('.play-card > button')[1] as HTMLButtonElement).click();
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
});
