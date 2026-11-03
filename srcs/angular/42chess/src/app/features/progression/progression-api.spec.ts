import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { levelShare, ProgressionApi } from './progression-api';

describe('Progression REST client', () => {
  it('reads the leaderboard, statistics, achievements and rules', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(ProgressionApi);
    const http = TestBed.inject(HttpTestingController);
    api.leaderboard(25).subscribe();
    expect(http.expectOne('/api/v1/leaderboard?limit=25&offset=25').request.method).toBe('GET');
    api.stats('u1').subscribe();
    http.expectOne('/api/v1/users/u1/stats');
    api.achievements('u1').subscribe();
    http.expectOne('/api/v1/users/u1/achievements');
    api.rules().subscribe();
    http.expectOne('/api/v1/progression/rules');
    http.verify();
  });

  it('measures the share of the current level', () => {
    expect(levelShare({ xp: 200, level: 2, levelXp: 100, nextLevelXp: 300 })).toBe(0.5);
    expect(levelShare({ xp: 0, level: 1, levelXp: 0, nextLevelXp: 100 })).toBe(0);
  });
});
