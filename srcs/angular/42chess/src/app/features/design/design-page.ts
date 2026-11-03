import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Preferences, themeOptions } from '../../core/preferences/preferences';
import { CapturedPieces } from '../../shared/chess/captured-pieces';
import { ChessBoard } from '../../shared/chess/chess-board';
import type { MoveRow } from '../../shared/chess/game-text';
import { MoveList } from '../../shared/chess/move-list';
import { LevelBar } from '../../shared/level-bar';
import { PresenceBadge } from '../../shared/presence-badge';
import { Alert, Tone } from '../../shared/ui/alert';
import { Badge, BadgeTone } from '../../shared/ui/badge';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon, ICONS, IconName } from '../../shared/ui/icon';
import { Pager } from '../../shared/ui/pager';
import { Segmented } from '../../shared/ui/segmented';
import { Spinner } from '../../shared/ui/spinner';
import { Toasts } from '../../shared/ui/toasts';
import { UserAvatar } from '../../shared/user-avatar';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr, TranslationKey } from '../../core/i18n/i18n';

/** Colour tokens of styles.css, grouped as the guide shows them. */
export const PALETTE: readonly { group: string; tokens: readonly string[] }[] = [
  {
    group: 'Surfaces',
    tokens: [
      '--background',
      '--surface',
      '--surface-raised',
      '--field',
      '--border',
      '--border-strong',
    ],
  },
  { group: 'Text', tokens: ['--text', '--muted', '--faint'] },
  { group: 'Accent', tokens: ['--accent', '--accent-hover', '--accent-soft', '--accent-ink'] },
  {
    group: 'Feedback',
    tokens: [
      '--error',
      '--error-bg',
      '--success',
      '--success-bg',
      '--warning',
      '--warning-bg',
      '--info-bg',
    ],
  },
];

/** After 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5. */
const SAMPLE_FEN = 'r1bqkb1r/ppp2ppp/2n5/3np1N1/2B5/8/PPPP1PPP/RNBQK2R w KQkq - 0 6';
const SAMPLE_MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5'];

/**
 * The living style guide: every token and reusable component, drawn by the real code in both
 * themes, so a change to the design system shows here first.
 */
@Component({
  selector: 'app-design-page',
  imports: [
    TranslocoDirective,
    Alert,
    Badge,
    CapturedPieces,
    ChessBoard,
    ConfirmDialog,
    EmptyState,
    Icon,
    LevelBar,
    MoveList,
    Pager,
    PresenceBadge,
    RouterLink,
    Segmented,
    Spinner,
    UserAvatar,
  ],
  templateUrl: './design-page.html',
  styleUrl: './design-page.css',
})
export class DesignPage {
  readonly preferences = inject(Preferences);
  private readonly toasts = inject(Toasts);
  readonly themes = computed(themeOptions);
  readonly palette = PALETTE;
  readonly sections = (
    ['colours', 'type', 'icons', 'actions', 'feedback', 'navigation', 'chess', 'players'] as const
  ).map((id) => ({ id, label: `design.sections.${id}` as const satisfies TranslationKey }));
  readonly icons = Object.keys(ICONS) as IconName[];
  readonly tones: readonly Tone[] = ['error', 'warning', 'success', 'info'];
  readonly badgeTones: readonly BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];
  readonly fen = SAMPLE_FEN;
  readonly rows: MoveRow[] = SAMPLE_MOVES.reduce<MoveRow[]>((rows, text, index) => {
    const cell = { text, ply: index + 1 };
    if (index % 2 === 0) rows.push({ number: index / 2 + 1, white: cell, black: null });
    else rows[rows.length - 1].black = cell;
    return rows;
  }, []);
  readonly ply = signal(SAMPLE_MOVES.length);
  readonly page = signal(2);
  readonly speed = signal<'blitz' | 'rapid' | 'classical'>('rapid');
  readonly speeds = computed(() => [
    { value: 'blitz' as const, label: tr('play.categories.Blitz') },
    { value: 'rapid' as const, label: tr('play.categories.Rapid') },
    { value: 'classical' as const, label: tr('play.categories.Classical') },
  ]);
  readonly progress = { xp: 240, level: 3, levelXp: 200, nextLevelXp: 350 };
  readonly answer = signal<string | null>(null);

  toast(tone: Tone): void {
    this.toasts.show(tr(`design.tones.${tone}.toast`, { name: 'Bob' }), {
      tone,
      key: 'design-' + tone,
    });
  }
}
