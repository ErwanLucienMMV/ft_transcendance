import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PresenceBadge } from '../../shared/presence-badge';
import {
  Friend,
  PlayerSearchResult,
  presenceChanges,
  SEARCH_MAX_LENGTH,
  UsersApi,
} from './users-api';

/** Player search (kept in `?q=`) and the signed-in user's friends with live presence. */
@Component({
  selector: 'app-friends-page',
  imports: [PresenceBadge, ReactiveFormsModule, RouterLink],
  templateUrl: './friends-page.html',
  styleUrl: './friends-page.css',
})
export class FriendsPage {
  private readonly users = inject(UsersApi);
  private readonly router = inject(Router);
  private readonly session = inject(AuthSession);
  readonly maxLength = SEARCH_MAX_LENGTH;
  private readonly signedInId = computed(() => this.session.user()?.id);

  readonly query = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((params) => (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH)),
    ),
    { initialValue: '' },
  );
  /** The text field starts from the address, and submitting puts it back there. */
  readonly form = new FormGroup({ q: new FormControl('', { nonNullable: true }) });
  readonly results = signal<PlayerSearchResult[] | null>(null);
  readonly searching = signal(false);
  readonly searchFailed = signal(false);

  readonly friends = signal<Friend[] | null>(null);
  readonly friendsFailed = signal(false);

  constructor() {
    effect(() => {
      const q = this.query();
      untracked(() => {
        this.form.setValue({ q });
        this.search(q);
      });
    });
    effect(() => {
      if (this.signedInId()) untracked(() => this.loadFriends());
    });
    presenceChanges(inject(RealtimeService))
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(({ userId, status }) =>
        this.friends.update(
          (list) =>
            list?.map((friend) => (friend.id === userId ? { ...friend, status } : friend)) ?? null,
        ),
      );
  }

  submit(): void {
    const q = this.form.getRawValue().q.trim();
    void this.router.navigate([], { queryParams: { q: q || null } });
  }

  loadFriends(): void {
    this.friendsFailed.set(false);
    this.users.friends().subscribe({
      next: ({ friends }) => this.friends.set(friends),
      error: () => this.friendsFailed.set(true),
    });
  }

  self(id: string): boolean {
    return id === this.signedInId();
  }

  private search(q: string): void {
    this.searchFailed.set(false);
    if (!q) {
      this.results.set(null);
      return;
    }
    this.searching.set(true);
    this.users.search(q).subscribe({
      next: ({ users }) => {
        // A slower answer for an older query must not replace the current one.
        if (q !== this.query()) return;
        this.results.set(users);
        this.searching.set(false);
      },
      error: () => {
        if (q !== this.query()) return;
        this.results.set(null);
        this.searching.set(false);
        this.searchFailed.set(true);
      },
    });
  }
}
