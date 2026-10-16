import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LoginForm } from './login-form';

@Component({
  selector: 'app-login-page',
  imports: [LoginForm, RouterLink],
  template: `
    <h2>Sign in</h2>
    <app-login-form />
    <p>New to 42 Chess? <a routerLink="/register">Create an account</a></p>
  `,
})
export class LoginPage {}
