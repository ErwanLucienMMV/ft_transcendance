import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_UPDATED } from './legal';
import { LocalDatePipe } from '../../shared/ui/local-date';
import { TranslocoDirective } from '@jsverse/transloco';
import { currentLanguage } from '../../core/i18n/i18n';

@Component({
  selector: 'app-terms-page',
  imports: [TranslocoDirective, LocalDatePipe, RouterLink],
  templateUrl: './terms-page.html',
  styleUrl: './legal-page.css',
})
export class TermsPage {
  readonly updated = LEGAL_UPDATED;
  readonly language = currentLanguage;
}
