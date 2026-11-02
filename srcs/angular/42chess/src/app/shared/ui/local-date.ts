import { formatDate } from '@angular/common';
import { Pipe, PipeTransform } from '@angular/core';
import { currentLocale } from '../../core/i18n/i18n';

/** Like the date pipe, in the language shown: "2 nov. 2026" in French. */
@Pipe({ name: 'localDate', pure: false })
export class LocalDatePipe implements PipeTransform {
  transform(
    value: string | number | Date | null | undefined,
    format = 'mediumDate',
    timezone?: string,
  ): string | null {
    if (value === null || value === undefined || value === '') return null;
    return formatDate(value, format, currentLocale(), timezone);
  }
}
