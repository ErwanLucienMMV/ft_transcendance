import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { presenceChanges, UsersApi } from './users-api';

describe('Users REST client', () => {
  it('reads profiles, searches, rating history and friends under the API prefix', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(UsersApi);
    const http = TestBed.inject(HttpTestingController);
    const id = '00000000-0000-4000-8000-000000000003';
    api.profile(id).subscribe();
    expect(http.expectOne(`/api/v1/users/${id}`).request.method).toBe('GET');
    api.search('a l%_ice').subscribe();
    expect(
      http.expectOne((request) => request.url === '/api/v1/users/search').request.params.get('q'),
    ).toBe('a l%_ice');
    api.ratingHistory(id, 10).subscribe();
    expect(
      http.expectOne(`/api/v1/users/${id}/rating-history?limit=10&offset=0`).request.method,
    ).toBe('GET');
    api.friends().subscribe();
    expect(http.expectOne('/api/v1/friends').request.method).toBe('GET');
    http.verify();
  });

  it('keeps only well-formed friend presence events', () => {
    const events = new Subject<ServerEvent>();
    const seen: unknown[] = [];
    presenceChanges({ events } as unknown as RealtimeService).subscribe((change) =>
      seen.push(change),
    );
    events.next({ event: 'USER_ONLINE', data: { userId: 'a', status: 'ONLINE', lastSeen: null } });
    events.next({ event: 'USER_STATUS_CHANGED', data: { userId: 'a', status: 'IN_GAME' } });
    events.next({ event: 'USER_OFFLINE', data: { userId: 'a', status: 'OFFLINE' } });
    events.next({ event: 'USER_ONLINE', data: { userId: 'a', status: 'AWAY' } });
    events.next({ event: 'USER_ONLINE', data: { status: 'ONLINE' } });
    events.next({ event: 'MOVE_PLAYED', data: { userId: 'a', status: 'ONLINE' } });
    expect(seen).toEqual([
      { userId: 'a', status: 'ONLINE' },
      { userId: 'a', status: 'IN_GAME' },
      { userId: 'a', status: 'OFFLINE' },
    ]);
  });
});
