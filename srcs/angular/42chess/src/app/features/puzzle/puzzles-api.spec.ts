import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PuzzlesApi } from './puzzles-api';

describe('Puzzles REST client', () => {
  it('uses the puzzle routes and never asks for a solution', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(PuzzlesApi);
    const http = TestBed.inject(HttpTestingController);
    api.daily().subscribe();
    expect(http.expectOne('/api/v1/puzzles/daily').request.method).toBe('GET');
    api.start('p1').subscribe();
    expect(http.expectOne('/api/v1/puzzles/p1/attempts').request.method).toBe('POST');
    api.attempt('a1').subscribe();
    expect(http.expectOne('/api/v1/puzzles/attempts/a1').request.method).toBe('GET');
    api.play('a1', 'e7e8q', 3).subscribe();
    expect(http.expectOne('/api/v1/puzzles/attempts/a1/moves').request.body).toEqual({
      move: 'e7e8q',
      version: 3,
    });
    http.verify();
  });

  it('reads earlier puzzles, the latest attempt, a hint and the solution', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(PuzzlesApi);
    const http = TestBed.inject(HttpTestingController);
    api.published('p1').subscribe();
    expect(http.expectOne('/api/v1/puzzles/p1').request.method).toBe('GET');
    api.progress('p1').subscribe();
    expect(http.expectOne('/api/v1/puzzles/p1/progress').request.method).toBe('GET');
    api.archive(40).subscribe();
    expect(http.expectOne('/api/v1/puzzles/archive?limit=20&offset=40').request.method).toBe('GET');
    api.hint('a1').subscribe();
    expect(http.expectOne('/api/v1/puzzles/attempts/a1/hint').request.method).toBe('POST');
    api.solution('a1').subscribe();
    expect(http.expectOne('/api/v1/puzzles/attempts/a1/solution').request.method).toBe('POST');
    http.verify();
  });
});
