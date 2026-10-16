import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegisterForm } from './register-form';

@Component({
  selector: 'app-register-page',
  imports: [RegisterForm, RouterLink],
  template: `
    <h2>Create an account</h2>
    <app-register-form />
    <p>Already have an account? <a routerLink="/login">Sign in</a></p>
  `,
})
export class RegisterPage {}
