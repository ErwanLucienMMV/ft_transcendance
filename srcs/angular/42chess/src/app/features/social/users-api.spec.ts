import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { presenceChanges, socialEvents, UsersApi } from './users-api';

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
    api.friendRequests().subscribe();
    expect(http.expectOne('/api/v1/friends/requests').request.method).toBe('GET');
    api.sendFriendRequest(id).subscribe();
    const send = http.expectOne('/api/v1/friends/requests');
    expect(send.request.method).toBe('POST');
    expect(send.request.body).toEqual({ recipientId: id });
    api.acceptFriendRequest('r1').subscribe();
    expect(http.expectOne('/api/v1/friends/requests/r1/accept').request.method).toBe('POST');
    api.removeFriendRequest('r1').subscribe();
    expect(http.expectOne('/api/v1/friends/requests/r1').request.method).toBe('DELETE');
    api.sentFriendRequests().subscribe();
    expect(http.expectOne('/api/v1/friends/requests/sent').request.method).toBe('GET');
    api.blocked().subscribe();
    expect(http.expectOne('/api/v1/blocks').request.method).toBe('GET');
    api.block(id).subscribe();
    expect(http.expectOne(`/api/v1/blocks/${id}`).request.method).toBe('PUT');
    api.unblock(id).subscribe();
    expect(http.expectOne(`/api/v1/blocks/${id}`).request.method).toBe('DELETE');
    api.removeFriend(id).subscribe();
    expect(http.expectOne(`/api/v1/friends/${id}`).request.method).toBe('DELETE');
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

  it('types friend events and drops malformed ones', () => {
    const events = new Subject<ServerEvent>();
    const seen: unknown[] = [];
    socialEvents({ events } as unknown as RealtimeService).subscribe((event) => seen.push(event));
    const request = {
      id: 'r1',
      senderId: 'a',
      recipientId: 'b',
      status: 'PENDING',
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    const sender = { id: 'a', username: 'alice', avatarUrl: null, elo: 1200 };
    events.next({ event: 'FRIEND_REQUEST_RECEIVED', data: { request, sender } });
    events.next({ event: 'FRIEND_REQUEST_RECEIVED', data: { request } });
    events.next({ event: 'FRIEND_REQUEST_SENT', data: { request } });
    events.next({ event: 'FRIEND_REQUEST_REMOVED', data: { requestId: 'r1' } });
    events.next({ event: 'FRIEND_REQUEST_REMOVED', data: {} });
    events.next({
      event: 'FRIEND_ADDED',
      data: { requestId: 'r1', friend: { ...sender, status: 'ONLINE' } },
    });
    events.next({ event: 'FRIEND_ADDED', data: { friend: { ...sender, status: 'AWAY' } } });
    events.next({ event: 'FRIEND_REMOVED', data: { userId: 'a' } });
    events.next({ event: 'USER_ONLINE', data: { userId: 'a', status: 'ONLINE' } });
    expect(seen).toEqual([
      { type: 'request-received', request, sender },
      { type: 'request-sent', request },
      { type: 'request-removed', requestId: 'r1' },
      { type: 'friend-added', requestId: 'r1', friend: { ...sender, status: 'ONLINE' } },
      { type: 'friend-removed', userId: 'a' },
    ]);
  });
});
