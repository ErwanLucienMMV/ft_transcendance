import { inject, Injectable } from '@angular/core';
import { filter, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { RealtimeService } from '../../core/realtime/realtime.service';

/** Public message shape of GET /v1/conversations/:userId/messages and PRIVATE_MESSAGE. */
export interface PrivateMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  createdAt: string;
}
export interface Conversation {
  user: { id: string; username: string };
  lastMessage: PrivateMessage;
  /** Incoming messages without a read time. Nothing marks them read yet. */
  unreadCount: number;
}
export interface MessagePage {
  messages: PrivateMessage[];
  total: number;
  limit: number;
  offset: number;
}

/** The server stores at most 2000 Unicode code points per message. */
export const MESSAGE_MAX_LENGTH = 2000;
export const HISTORY_PAGE_SIZE = 30;

/** Code points, as the server counts them: an emoji is one character. */
export function messageLength(text: string): number {
  return [...text].length;
}

function isMessage(data: Record<string, unknown>): boolean {
  return ['id', 'senderId', 'receiverId', 'content', 'createdAt'].every(
    (key) => typeof data[key] === 'string',
  );
}

/** Saved private messages, pushed to every session of the sender and the receiver. */
export function privateMessages(realtime: RealtimeService): Observable<PrivateMessage> {
  return realtime.events.pipe(
    filter(({ event, data }) => event === 'PRIVATE_MESSAGE' && isMessage(data)),
    map(({ data }) => data as unknown as PrivateMessage),
  );
}

/** Conversation list and history over HTTP; sending goes through the signed-in socket. */
@Injectable({ providedIn: 'root' })
export class MessagesApi {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  /** One entry per peer, newest message first. */
  conversations(): Observable<{ conversations: Conversation[] }> {
    return this.api.get('conversations');
  }

  /** Newest first, in both directions. */
  history(userId: string, offset = 0, limit = HISTORY_PAGE_SIZE): Observable<MessagePage> {
    return this.api.get(`conversations/${encodeURIComponent(userId)}/messages`, {
      params: { limit, offset },
    });
  }

  /** False when the socket is not connected; the saved message comes back as PRIVATE_MESSAGE. */
  send(receiverId: string, content: string): boolean {
    return this.realtime.send('SEND_PRIVATE_MESSAGE', { receiverId, content });
  }
}
