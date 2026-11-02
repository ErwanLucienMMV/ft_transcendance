import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthFrame } from '../../shared/auth-frame';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'app-not-found-page',
  imports: [TranslocoDirective, RouterLink, AuthFrame],
  template: `
    <ng-container *transloco="let t">
      <app-auth-frame [aside]="false">
        <h1>{{ t('home.notFound.title') }}</h1>
        <p class="auth-intro">{{ t('home.notFound.text') }}</p>
        <a class="button" routerLink="/">{{ t('home.notFound.back') }}</a>
      </app-auth-frame>
    </ng-container>
  `,
})
export class NotFoundPage {}
