import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { API_BASE_URL } from '../core/api/api-base-url';

/** An uploaded avatar, as the API stores it: `avatars/<file>`, served under the API. */
const UPLOADED = /^avatars\/[0-9a-f-]{36}-[0-9a-f]{16}\.(?:png|jpg|webp)$/;

/**
 * The address to load an avatar from: an uploaded file under the API, or the https picture a
 * sign-in provider gave. Anything else is ignored and the initial is shown instead.
 */
export function avatarSource(value: string | null | undefined, apiBase: string): string | null {
  if (!value) return null;
  if (UPLOADED.test(value)) return `${apiBase.replace(/\/+$/, '')}/${value}`;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A hue that stays the same for a player, so their initial keeps its colour everywhere. */
export function avatarHue(username: string): number {
  let hash = 0;
  for (const character of username.toLowerCase()) {
    hash = (hash * 31 + character.codePointAt(0)!) % 360;
  }
  return hash;
}

/**
 * A player's picture, or the first letter of their name on a colour of their own when they
 * have none or it fails to load. The size and shape come from the class the page gives it.
 */
@Component({
  selector: 'app-avatar',
  template: `
    @if (src(); as url) {
      @if (!failed()) {
        <img [src]="url" alt="" referrerpolicy="no-referrer" (error)="failed.set(true)" />
      } @else {
        {{ letter() }}
      }
    } @else {
      {{ letter() }}
    }
  `,
  host: {
    'aria-hidden': 'true',
    class: 'user-avatar',
    '[class.has-picture]': 'src() && !failed()',
    '[style.--avatar-hue]': 'hue()',
  },
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      overflow: hidden;
      line-height: 1;
    }
    :host(.user-avatar:not(.has-picture)) {
      background: hsl(var(--avatar-hue) 42% 32%);
      color: hsl(var(--avatar-hue) 70% 92%);
    }
    img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      border-radius: inherit;
    }
  `,
})
export class UserAvatar {
  private readonly base = inject(API_BASE_URL);
  readonly username = input.required<string>();
  readonly url = input<string | null | undefined>(null);
  readonly src = computed(() => avatarSource(this.url(), this.base));
  /** Reset whenever the picture changes: a new upload deserves a new try. */
  readonly failed = linkedSignal({ source: this.src, computation: () => false });
  readonly letter = computed(() => [...this.username()][0]?.toUpperCase() ?? '?');
  readonly hue = computed(() => avatarHue(this.username()));
}
