import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_UPDATED } from './legal';

/** Describes what the backend actually stores; keep it in step with the entities. */
@Component({
  selector: 'app-privacy-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './privacy-page.html',
  styleUrl: './legal-page.css',
})
export class PrivacyPage {
  readonly updated = LEGAL_UPDATED;
}
