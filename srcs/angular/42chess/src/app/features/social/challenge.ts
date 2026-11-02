import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { map, Observable, tap, throwError } from 'rxjs';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { challengeMessage, MessagesApi } from '../chat/messages-api';
import { GamesApi } from '../game/games-api';

/** Ten minutes each: the default choice of the play page. */
export const CHALLENGE_TIME_CONTROL = { initialTime: 600_000, increment: 0 };

/**
 * A challenge is a game reserved for the friend plus a private message with its link: the friend
 * opens it to take the other seat. Declining is simply not opening it, and the game page always shows the
 * link, so a message that could not be sent does not lose the challenge.
 */
@Injectable({ providedIn: 'root' })
export class Challenges {
  private readonly games = inject(GamesApi);
  private readonly messages = inject(MessagesApi);
  private readonly router = inject(Router);
  private readonly realtime = inject(RealtimeService);
  private readonly origin = inject(DOCUMENT).location.origin;

  send(userId: string): Observable<void> {
    // Offline, the friend would never hear of a game left waiting for them.
    if (this.realtime.state() !== 'connected')
      return throwError(() => new Error('Offline: the challenge cannot be sent.'));
    return this.games.create(CHALLENGE_TIME_CONTROL, userId).pipe(
      tap(({ gameId }) => {
        this.messages.send(userId, challengeMessage(this.origin, gameId));
        void this.router.navigate(['/game', gameId]);
      }),
      map(() => undefined),
    );
  }
}
