import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { messageLength, MessagesApi, privateMessages } from './messages-api';

describe('Private messages client', () => {
  it('reads conversations and paged history under the API prefix, and sends on the socket', () => {
    const send = vi.fn().mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: { send } },
      ],
    });
    const api = TestBed.inject(MessagesApi);
    const http = TestBed.inject(HttpTestingController);
    const id = '00000000-0000-4000-8000-000000000003';
    api.conversations().subscribe();
    expect(http.expectOne('/api/v1/conversations').request.method).toBe('GET');
    api.history(id).subscribe();
    expect(
      http.expectOne(`/api/v1/conversations/${id}/messages?limit=30&offset=0`).request.method,
    ).toBe('GET');
    api.history(id, 30, 10).subscribe();
    http.expectOne(`/api/v1/conversations/${id}/messages?limit=10&offset=30`);
    http.verify();
    expect(api.send(id, 'Hello!')).toBe(true);
    expect(send).toHaveBeenCalledWith('SEND_PRIVATE_MESSAGE', {
      receiverId: id,
      content: 'Hello!',
    });
  });

  it('keeps only well-formed PRIVATE_MESSAGE events', () => {
    const events = new Subject<ServerEvent>();
    const seen: unknown[] = [];
    privateMessages({ events } as unknown as RealtimeService).subscribe((message) =>
      seen.push(message),
    );
    const message = {
      id: 'm1',
      senderId: 'a',
      receiverId: 'b',
      content: 'hi',
      createdAt: '2026-10-31T10:00:00.000Z',
    };
    events.next({ event: 'PRIVATE_MESSAGE', data: message });
    events.next({ event: 'PRIVATE_MESSAGE', data: { ...message, content: 3 } });
    events.next({ event: 'GAME_MESSAGE', data: message });
    expect(seen).toEqual([message]);
  });

  it('counts code points like the server, so an emoji is one character', () => {
    expect(messageLength('hi')).toBe(2);
    expect(messageLength('♞👋🏽')).toBe(3);
  });
});
