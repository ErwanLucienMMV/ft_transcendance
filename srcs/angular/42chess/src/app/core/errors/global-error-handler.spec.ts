import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Toasts } from '../../shared/ui/toasts';
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
    const [toast] = TestBed.inject(Toasts).items();
    expect(toast).toMatchObject({ tone: 'error', text: 'Something went wrong. Please try again.' });
    expect(toast.text).not.toContain(failure.message);
  });
});
