import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthFrame } from '../../shared/auth-frame';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink, AuthFrame],
  template: `
    <app-auth-frame>
      <h2>Page not found</h2>
      <p class="auth-intro">
        The page you requested does not exist. A new move is always possible.
      </p>
      <a class="button" routerLink="/">Return home</a>
    </app-auth-frame>
  `,
})
export class NotFoundPage {}
