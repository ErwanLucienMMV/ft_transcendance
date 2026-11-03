import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { ChessArtwork } from '../../shared/chess-artwork';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'app-home-page',
  imports: [TranslocoDirective, RouterLink, ChessArtwork],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  protected readonly session = inject(AuthSession);
  protected readonly features = [
    { key: 'online', link: '/play', piece: 'king' },
    { key: 'computer', link: '/play', piece: 'rook' },
    { key: 'puzzle', link: '/puzzle', piece: 'knight' },
    { key: 'live', link: '/live', piece: 'queen' },
  ];
}
