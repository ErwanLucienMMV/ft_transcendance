import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Subject } from 'rxjs';
import { AuthSession } from '../auth/auth-session';

export interface ServerEvent {
  event: string;
  data: Record<string, unknown>;
}
export type ConnectionState =
  'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting' | 'unavailable';
export const SOCKET_FACTORY = new InjectionToken<(url: string) => WebSocket>('SOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => (url) => new WebSocket(url),
});
export const SOCKET_URL = new InjectionToken<() => string>('SOCKET_URL', {
  providedIn: 'root',
  factory: () => () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
});

/** Native JSON WebSocket, no automatic replay of game mutations. */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly session = inject(AuthSession);
  private readonly createSocket = inject(SOCKET_FACTORY);
  private readonly url = inject(SOCKET_URL);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly received = new Subject<ServerEvent>();
  readonly events = this.received.asObservable();
  readonly state = signal<ConnectionState>('disconnected');
  readonly error = signal<string | null>(null);
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private wanted = false;
  private token: string | null = null;
  private readonly rooms = new Set<string>();

  constructor() {
    effect(() => {
      const token = this.session.token();
      if (token === this.token) return;
      this.stop();
      this.rooms.clear();
      this.token = token;
      this.attempts = 0;
      if (token && this.wanted) this.open();
    });
    inject(DestroyRef).onDestroy(() => {
      this.wanted = false;
      this.stop();
      this.received.complete();
    });
  }

  connect(): void {
    this.wanted = true;
    this.token = this.session.token();
    if (!this.browser || !this.token || this.socket || this.retry) return;
    this.attempts = 0;
    this.error.set(null);
    this.open();
  }

  disconnect(): void {
    this.wanted = false;
    this.rooms.clear();
    this.stop();
  }

  send(event: string, data: Record<string, unknown>): boolean {
    if (this.state() !== 'connected' || this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify({ event, data }));
    return true;
  }

  joinGame(gameId: string): boolean {
    if (!this.send('JOIN_GAME', { gameId })) return false;
    this.rooms.add(gameId);
    return true;
  }
  leaveGame(gameId: string): boolean {
    this.rooms.delete(gameId);
    return this.send('LEAVE_GAME', { gameId });
  }

  private open(): void {
    if (!this.browser || !this.wanted || !this.token) return;
    this.state.set(this.attempts ? 'reconnecting' : 'connecting');
    let socket: WebSocket;
    try {
      socket = this.createSocket(this.url());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    this.handshake = setTimeout(() => socket.close(4000, 'Authentication timeout'), 8000);
    socket.onopen = () => {
      if (socket !== this.socket || !this.token) return;
      this.state.set('authenticating');
      socket.send(JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken: this.token } }));
    };
    socket.onmessage = (message) => {
      if (socket !== this.socket) return;
      let packet: ServerEvent;
      try {
        if (typeof message.data !== 'string' || message.data.length > 1_048_576) throw new Error();
        packet = JSON.parse(message.data) as ServerEvent;
        if (
          !packet ||
          typeof packet.event !== 'string' ||
          !packet.data ||
          typeof packet.data !== 'object' ||
          Array.isArray(packet.data)
        )
          throw new Error();
      } catch {
        this.error.set('Invalid realtime response.');
        socket.close(4000, 'Invalid response');
        return;
      }
      if (packet.event === 'AUTHENTICATED') {
        if (
          this.state() !== 'authenticating' ||
          packet.data['userId'] !== this.session.user()?.id
        ) {
          socket.close(4401, 'Invalid authentication response');
          return;
        }
        clearTimeout(this.handshake);
        this.attempts = 0;
        this.error.set(null);
        this.state.set('connected');
        for (const gameId of this.rooms) this.send('JOIN_GAME', { gameId });
      } else if (this.state() !== 'connected' && packet.event !== 'ERROR') {
        socket.close(4000, 'Authenticate first');
        return;
      }
      if (packet.event === 'ERROR') this.error.set('The realtime request could not be completed.');
      this.received.next(packet);
    };
    socket.onerror = () => {
      if (socket === this.socket) this.error.set('Realtime connection failed.');
    };
    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      clearTimeout(this.handshake);
      this.socket = undefined;
      if (event.code === 4401 || event.code === 1008) {
        this.error.set('Realtime authentication is unavailable or expired.');
        this.state.set('unavailable');
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (!this.wanted || !this.session.token()) {
      this.state.set('disconnected');
      return;
    }
    if (this.attempts >= 5) {
      this.state.set('unavailable');
      this.error.set('Realtime connection unavailable. Please reconnect.');
      return;
    }
    const delay = Math.min(500 * 2 ** this.attempts++, 8000);
    this.state.set('reconnecting');
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.open();
    }, delay);
  }

  private stop(): void {
    clearTimeout(this.retry);
    clearTimeout(this.handshake);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'Client disconnected');
    this.state.set('disconnected');
  }
}
