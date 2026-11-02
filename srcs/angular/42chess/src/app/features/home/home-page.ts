import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { ChessArtwork } from '../../shared/chess-artwork';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, ChessArtwork],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  protected readonly session = inject(AuthSession);
  protected readonly features = [
    {
      link: '/play',
      piece: 'king',
      title: 'Play online',
      text: 'Rated games against a player of similar Elo, or a link for a friend.',
    },
    {
      link: '/play',
      piece: 'rook',
      title: 'Play the computer',
      text: 'Three levels, from one move ahead to spotting short mates.',
    },
    {
      link: '/puzzle',
      piece: 'knight',
      title: 'Daily puzzle',
      text: 'One position a day. Find the best move and beat your time.',
    },
    {
      link: '/live',
      piece: 'queen',
      title: 'Watch live',
      text: 'Follow the games being played right now, move by move.',
    },
  ];
}
