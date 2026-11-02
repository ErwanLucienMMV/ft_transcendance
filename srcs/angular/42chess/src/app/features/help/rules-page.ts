import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TIME_CONTROLS } from '../game/games-api';

/**
 * How a game is won, drawn or aborted on this site. Keep it in step with the server rules
 * (games.service.ts, game-actions.ts, game-realtime.service.ts).
 */
@Component({
  selector: 'app-rules-page',
  imports: [RouterLink],
  templateUrl: './rules-page.html',
  styleUrl: '../legal/legal-page.css',
})
export class RulesPage {
  readonly controls = TIME_CONTROLS;
}
