import { Component } from '@angular/core';

@Component({
  selector: 'app-auth-frame',
  template: `
    <div class="auth-layout">
      <section class="auth-card">
        <span class="auth-mark" aria-hidden="true"
          ><svg viewBox="0 0 64 64"><use href="/chess-pieces.svg#knight" /></svg
        ></span>
        <ng-content />
      </section>
    </div>
  `,
})
export class AuthFrame {}
