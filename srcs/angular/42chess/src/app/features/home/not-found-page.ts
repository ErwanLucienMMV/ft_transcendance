import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  template: `
    <h2>Page not found</h2>
    <p>The page you requested does not exist.</p>
    <a routerLink="/">Return home</a>
  `,
})
export class NotFoundPage {}
