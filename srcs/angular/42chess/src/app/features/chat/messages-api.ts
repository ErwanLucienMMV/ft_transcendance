import { inject, Injectable } from '@angular/core';
import { filter, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { isUuid } from '../../core/api/ids';

/** Public message shape of GET /v1/conversations/:userId/messages and PRIVATE_MESSAGE. */
export interface PrivateMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  createdAt: string;
  /** When the receiver opened the conversation after it arrived; null until then. */
  readAt?: string | null;
}
export interface Conversation {
  user: { id: string; username: string; avatarUrl?: string | null };
  lastMessage: PrivateMessage;
  /** Incoming messages without a read time. */
  unreadCount: number;
}
/** MESSAGES_READ: `readerId` read these messages from `senderId`. */
export interface ReadReceipt {
  readerId: string;
  senderId: string;
  readAt: string;
  messageIds: string[];
}

/** How often this page tells the other player "typing…", as the server allows. */
export const TYPING_INTERVAL_MS = 2000;
/** How long a "typing…" hint stays without a new one. */
export const TYPING_SHOWN_MS = 4000;
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

const CHALLENGE_TEXT = 'I challenge you to a game: ';

/** The private message a challenge sends: plain text, readable in any client. */
export function challengeMessage(origin: string, gameId: string): string {
  return `${CHALLENGE_TEXT}${origin}/game/${gameId}`;
}

/** The game of a challenge from this site; any other text stays an ordinary message. */
export function challengedGame(content: string, origin: string): string | null {
  if (!content.startsWith(`${CHALLENGE_TEXT}${origin}/game/`)) return null;
  const id = content.slice(CHALLENGE_TEXT.length + origin.length + '/game/'.length);
  return isUuid(id) ? id : null;
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

/** Read receipts for either side: messages this account read elsewhere, or that were read. */
export function readReceipts(realtime: RealtimeService): Observable<ReadReceipt> {
  return realtime.events.pipe(
    filter(
      ({ event, data }) =>
        event === 'MESSAGES_READ' &&
        ['readerId', 'senderId', 'readAt'].every((key) => typeof data[key] === 'string') &&
        Array.isArray(data['messageIds']) &&
        (data['messageIds'] as unknown[]).every((id) => typeof id === 'string'),
    ),
    map(({ data }) => data as unknown as ReadReceipt),
  );
}

/** The id of each player who is typing a message to this account. */
export function typingHints(realtime: RealtimeService): Observable<string> {
  return realtime.events.pipe(
    filter(({ event, data }) => event === 'TYPING' && typeof data['userId'] === 'string'),
    map(({ data }) => data['userId'] as string),
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

  /** Everything this player sent is read; both sides get MESSAGES_READ. */
  markRead(userId: string): Observable<void> {
    return this.api.post(`conversations/${encodeURIComponent(userId)}/read`, {});
  }

  /** A best-effort hint; the server drops it when too frequent or unwelcome. */
  typing(receiverId: string): void {
    this.realtime.send('TYPING', { receiverId });
  }
}
