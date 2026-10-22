import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorState } from './error-state';
import { GlobalErrorHandler } from './global-error-handler';

describe('Global error handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps unexpected failures visible to developers and safe for users', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: ErrorHandler, useClass: GlobalErrorHandler }],
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('private diagnostic information');
    TestBed.inject(ErrorHandler).handleError(failure);
    expect(log).toHaveBeenCalledWith(failure);
    expect(TestBed.inject(ErrorState).message()).toBe('Something went wrong. Please try again.');
    expect(TestBed.inject(ErrorState).message()).not.toContain(failure.message);
  });
});
