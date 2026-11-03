import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_UPDATED } from './legal';
import { LocalDatePipe } from '../../shared/ui/local-date';
import { TranslocoDirective } from '@jsverse/transloco';
import { currentLanguage } from '../../core/i18n/i18n';

/** Describes what the backend actually stores; keep it in step with the entities. */
@Component({
  selector: 'app-privacy-page',
  imports: [TranslocoDirective, LocalDatePipe, RouterLink],
  templateUrl: './privacy-page.html',
  styleUrl: './legal-page.css',
})
export class PrivacyPage {
  readonly updated = LEGAL_UPDATED;
  readonly language = currentLanguage;
}
