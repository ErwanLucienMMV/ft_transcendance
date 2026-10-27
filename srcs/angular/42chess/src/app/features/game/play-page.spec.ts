import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { GamesApi } from './games-api';
import { PlayPage } from './play-page';

describe('Play page', () => {
  let api: { create: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    api = { create: vi.fn() };
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
    (element.querySelector('.play-card > button') as HTMLButtonElement).click();
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
    const button = element.querySelector('.play-card > button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Server says no.');
    expect(button.disabled).toBe(false);
  });
});
