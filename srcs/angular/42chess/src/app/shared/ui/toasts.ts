import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import type { Tone } from './alert';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon, IconName } from './icon';

export interface Toast {
  id: number;
  tone: Tone;
  text: string;
  /** Toasts with the same key replace each other instead of piling up. */
  key: string;
  link?: { label: string; path: string };
}
export interface ToastOptions {
  tone?: Tone;
  key?: string;
  /** Milliseconds before it goes away by itself; 0 keeps it until dismissed. */
  duration?: number;
  link?: Toast['link'];
}

const MAX_TOASTS = 4;
const DEFAULT_DURATION_MS = 6000;
const TONE_ICONS: Record<Tone, IconName> = {
  error: 'alert',
  warning: 'alert',
  success: 'check',
  info: 'info',
};

/** Short messages that come and go: a failed request, a copied link, a saved setting. */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private next = 0;
  readonly items = signal<Toast[]>([]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  show(text: string, options: ToastOptions = {}): void {
    const { tone = 'info', key = text, duration = DEFAULT_DURATION_MS, link } = options;
    for (const old of this.items().filter((toast) => toast.key === key)) this.dismiss(old.id);
    while (this.items().length >= MAX_TOASTS) this.dismiss(this.items()[0].id);
    const toast: Toast = { id: ++this.next, tone, text, key, ...(link ? { link } : {}) };
    this.items.update((list) => [...list, toast]);
    if (duration > 0 && this.browser)
      this.timers.set(
        toast.id,
        setTimeout(() => this.dismiss(toast.id), duration),
      );
  }

  error(text: string, options: Omit<ToastOptions, 'tone'> = {}): void {
    this.show(text, { duration: 8000, ...options, tone: 'error' });
  }

  success(text: string, options: Omit<ToastOptions, 'tone'> = {}): void {
    this.show(text, { ...options, tone: 'success' });
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.items.update((list) => list.filter((toast) => toast.id !== id));
  }

  /** Clears every toast, or those of one tone. */
  clear(tone?: Tone): void {
    for (const toast of this.items()) if (!tone || toast.tone === tone) this.dismiss(toast.id);
  }
}

/**
 * Where toasts appear, under the header on the right. Errors interrupt screen readers, the
 * others wait. An error belongs to the page it happened on: changing page clears it.
 */
@Component({
  selector: 'app-toasts',
  imports: [Icon, RouterLink, TranslocoPipe],
  template: `
    <div class="toasts">
      @for (toast of toasts.items(); track toast.id) {
        <div
          class="toast"
          [attr.data-tone]="toast.tone"
          [attr.role]="toast.tone === 'error' ? 'alert' : 'status'"
        >
          <app-icon class="toast-icon" [name]="icon(toast)" />
          <p>
            {{ toast.text }}
            @if (toast.link; as link) {
              <a [routerLink]="link.path">{{ link.label }}</a>
            }
          </p>
          <button
            type="button"
            class="ghost small"
            [attr.aria-label]="'common.dismiss' | transloco"
            (click)="toasts.dismiss(toast.id)"
          >
            <app-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed;
      top: calc(var(--header-height) + 12px);
      right: 16px;
      z-index: 60;
      display: grid;
      gap: 10px;
      width: min(380px, calc(100vw - 32px));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      padding: 12px 8px 12px 14px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      background: var(--surface-raised);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
      animation: enter 0.18s ease-out;
    }
    .toast[data-tone='error'] {
      border-color: var(--error-border);
    }
    .toast[data-tone='error'] .toast-icon {
      color: var(--error);
    }
    .toast[data-tone='success'] .toast-icon {
      color: var(--accent);
    }
    .toast[data-tone='warning'] .toast-icon {
      color: var(--warning);
    }
    .toast-icon {
      margin-top: 2px;
    }
    p {
      margin: 0;
      font-size: 14px;
    }
    p a {
      margin-left: 4px;
    }
    button {
      min-height: 28px;
      padding: 4px 6px;
    }
    @keyframes enter {
      from {
        opacity: 0;
        transform: translateY(-6px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        animation: none;
      }
    }
  `,
})
export class ToastHost {
  readonly toasts = inject(Toasts);

  constructor() {
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.toasts.clear('error'));
  }

  icon(toast: Toast): IconName {
    return TONE_ICONS[toast.tone];
  }
}
