import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChessArtwork } from '../../shared/chess-artwork';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, ChessArtwork],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {}
