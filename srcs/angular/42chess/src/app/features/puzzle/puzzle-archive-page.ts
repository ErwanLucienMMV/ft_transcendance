import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ARCHIVE_PAGE, ArchivedPuzzle, PuzzlesApi } from './puzzles-api';
import { Alert } from '../../shared/ui/alert';
import { EmptyState } from '../../shared/ui/empty-state';
import { Pager } from '../../shared/ui/pager';
import { tr } from '../../core/i18n/i18n';
import { TranslocoDirective } from '@jsverse/transloco';

/** Earlier days' puzzles, newest first, with how the player did on each. */
@Component({
  selector: 'app-puzzle-archive-page',
  imports: [TranslocoDirective, Pager, EmptyState, Alert, RouterLink],
  templateUrl: './puzzle-archive-page.html',
  styleUrl: './puzzle-archive-page.css',
})
export class PuzzleArchivePage {
  private readonly api = inject(PuzzlesApi);
  private readonly router = inject(Router);

  readonly page = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((params) => {
        const page = Number(params.get('page') ?? 1);
        return Number.isSafeInteger(page) && page >= 1 ? page : 1;
      }),
    ),
    { initialValue: 1 },
  );
  readonly items = signal<ArchivedPuzzle[] | null>(null);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / ARCHIVE_PAGE)));

  constructor() {
    effect(() => {
      const page = this.page();
      untracked(() => this.load(page));
    });
  }

  status(item: ArchivedPuzzle): string {
    return tr(`puzzle.archive.status.${item.status ?? 'NEW'}`);
  }

  go(page: number): void {
    void this.router.navigate([], { queryParams: { page: page === 1 ? null : page } });
  }

  retry(): void {
    this.load(this.page());
  }

  private load(page: number): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.archive((page - 1) * ARCHIVE_PAGE).subscribe({
      next: ({ items, total }) => {
        this.items.set(items);
        this.total.set(total);
        this.loading.set(false);
        if (items.length === 0 && total > 0) this.go(this.pages());
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }
}
