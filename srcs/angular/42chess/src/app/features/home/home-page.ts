import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <h2>Play chess</h2>
    <p>Sign in or create an account to get started.</p>
    <p><a routerLink="/login">Sign in</a> or <a routerLink="/register">Create an account</a></p>
  `,
})
export class HomePage {}
