import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Asks before an action that cannot be undone. A modal `<dialog>`: focus moves into it,
 * Escape cancels, and focus returns to the button that opened it.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [TranslocoPipe],
  template: `
    <dialog
      #dialog
      [attr.aria-labelledby]="id + '-title'"
      [attr.aria-describedby]="id + '-body'"
      (close)="closed()"
    >
      <h2 [id]="id + '-title'">{{ heading() }}</h2>
      <div class="dialog-body" [id]="id + '-body'"><ng-content /></div>
      <div class="dialog-actions">
        <button type="button" class="button secondary" autofocus (click)="answer(false)">
          {{ cancelLabel() ?? ('common.cancel' | transloco) }}
        </button>
        <button type="button" [class.danger]="tone() === 'danger'" (click)="answer(true)">
          {{ confirmLabel() ?? ('common.confirm' | transloco) }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(440px, calc(100vw - 32px));
      padding: 24px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg);
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    }
    dialog::backdrop {
      background: rgba(5, 8, 8, 0.6);
    }
    h2 {
      margin: 0 0 8px;
      font-size: 19px;
    }
    .dialog-body {
      color: var(--muted);
    }
    .dialog-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }
  `,
})
export class ConfirmDialog {
  private static next = 0;
  readonly id = `confirm-${++ConfirmDialog.next}`;
  readonly heading = input.required<string>();
  /** Default: "Confirm" and "Cancel" in the language shown. */
  readonly confirmLabel = input<string | null>(null);
  readonly cancelLabel = input<string | null>(null);
  readonly tone = input<'danger' | 'default'>('default');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    dialog.returnValue = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  /** Closes with the player's answer; callers may also answer, e.g. when the subject vanished. */
  answer(confirm: boolean): void {
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) return;
    // Escape closes with an empty value: a cancel too.
    if (typeof dialog.close === 'function') dialog.close(confirm ? 'confirm' : 'cancel');
    else {
      dialog.returnValue = confirm ? 'confirm' : 'cancel';
      dialog.removeAttribute('open');
      this.closed();
    }
  }

  protected closed(): void {
    if (this.dialog().nativeElement.returnValue === 'confirm') this.confirmed.emit();
    else this.cancelled.emit();
  }
}
