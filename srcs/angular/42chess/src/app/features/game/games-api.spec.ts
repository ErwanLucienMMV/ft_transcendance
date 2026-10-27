import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GamesApi } from './games-api';

describe('Games REST client', () => {
  it('creates games and reads one under the API prefix', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(GamesApi);
    const http = TestBed.inject(HttpTestingController);
    api.create({ initialTime: 600_000, increment: 0 }).subscribe();
    const create = http.expectOne('/api/v1/games');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ timeControl: { initialTime: 600_000, increment: 0 } });
    api.get('00000000-0000-4000-8000-000000000001').subscribe();
    expect(
      http.expectOne('/api/v1/games/00000000-0000-4000-8000-000000000001').request.method,
    ).toBe('GET');
    api
      .createBot({
        difficulty: 'EASY',
        color: 'WHITE',
        timeControl: { initialTime: 600_000, increment: 0 },
      })
      .subscribe();
    expect(http.expectOne('/api/v1/games/bot').request.body).toEqual({
      difficulty: 'EASY',
      color: 'WHITE',
      timeControl: { initialTime: 600_000, increment: 0 },
    });
    api.resumeBot('00000000-0000-4000-8000-000000000001').subscribe();
    expect(
      http.expectOne('/api/v1/games/00000000-0000-4000-8000-000000000001/bot-move').request.method,
    ).toBe('POST');
    http.verify();
  });
});
