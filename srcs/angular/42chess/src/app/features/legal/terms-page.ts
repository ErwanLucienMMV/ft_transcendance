import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL_UPDATED } from './legal';

@Component({
  selector: 'app-terms-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './terms-page.html',
  styleUrl: './legal-page.css',
})
export class TermsPage {
  readonly updated = LEGAL_UPDATED;
}
