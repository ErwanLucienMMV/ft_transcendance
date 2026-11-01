import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { challengedGame, challengeMessage, MessagesApi } from '../chat/messages-api';
import { GamesApi } from '../game/games-api';
import { CHALLENGE_TIME_CONTROL, Challenges } from './challenge';

const id = '00000000-0000-4000-8000-000000000001';
const origin = 'https://chess.example';

describe('Challenges', () => {
  let create: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    create = vi.fn().mockReturnValue(of({ gameId: id, status: 'WAITING' }));
    send = vi.fn(() => true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: GamesApi, useValue: { create } },
        { provide: MessagesApi, useValue: { send } },
      ],
    });
  });

  it('creates a game, sends its link to the friend and opens it', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(Challenges).send('bob').subscribe();
    expect(create).toHaveBeenCalledWith(CHALLENGE_TIME_CONTROL);
    expect(send).toHaveBeenCalledWith('bob', expect.stringContaining(`/game/${id}`));
    expect(navigate).toHaveBeenCalledWith(['/game', id]);
  });

  it('still opens the game when the message cannot be sent, as its page shows the link', () => {
    send.mockReturnValue(false);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(Challenges).send('bob').subscribe();
    expect(navigate).toHaveBeenCalledWith(['/game', id]);
  });

  it('sends nothing when the game cannot be created', () => {
    create.mockReturnValue(throwError(() => new Error('down')));
    const failed = vi.fn();
    TestBed.inject(Challenges).send('bob').subscribe({ error: failed });
    expect(failed).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('recognises only an exact challenge from this site', () => {
    expect(challengedGame(challengeMessage(origin, id), origin)).toBe(id);
    expect(challengedGame(challengeMessage('https://evil.example', id), origin)).toBeNull();
    expect(challengedGame(`${challengeMessage(origin, id)} now`, origin)).toBeNull();
    expect(challengedGame(challengeMessage(origin, '../session'), origin)).toBeNull();
    expect(challengedGame('Hello', origin)).toBeNull();
  });
});
