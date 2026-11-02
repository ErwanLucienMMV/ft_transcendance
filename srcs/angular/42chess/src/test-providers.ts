import { TestBed } from '@angular/core/testing';
import { beforeEach } from 'vitest';
import { provideI18n } from './app/core/i18n/i18n';

// Every unit test draws texts through the dictionaries, in English (the default).
beforeEach(() => TestBed.configureTestingModule({ providers: [provideI18n()] }));
