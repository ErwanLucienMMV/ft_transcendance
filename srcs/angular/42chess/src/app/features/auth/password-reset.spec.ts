import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { ForgotPasswordPage } from './forgot-password-page';
import { ResetPasswordPage } from './reset-password-page';

const TOKEN = 'a'.repeat(43);

describe('Forgotten password', () => {
  let http: HttpTestingController;
  function setup(token: string | null = null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }
  afterEach(() => http.verify());
  function type(element: HTMLElement, selector: string, value: string) {
    const input = element.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('asks for a link and answers the same whether the account exists or not', () => {
    setup();
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    type(element, '#forgot-email', 'alice@example.com');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const request = http.expectOne('/api/v1/auth/forgot-password');
    expect(request.request.body).toEqual({ email: 'alice@example.com' });
    request.flush(null, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    expect(element.querySelector('[role="status"]')?.textContent).toContain(
      'If an account with a password uses this address',
    );
  });

  it('sets the new password from the emailed link', () => {
    setup(TOKEN);
    const fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    type(element, '#reset-password', 'a brand new password');
    type(element, '#reset-confirm-password', 'a brand new password');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const request = http.expectOne('/api/v1/auth/reset-password');
    expect(request.request.body).toEqual({ token: TOKEN, password: 'a brand new password' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(element.querySelector('[role="status"]')?.textContent).toContain('signed out');
    expect(element.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('offers a new link when this one expired', () => {
    setup(TOKEN);
    const fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    type(element, '#reset-password', 'a brand new password');
    type(element, '#reset-confirm-password', 'a brand new password');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    http
      .expectOne('/api/v1/auth/reset-password')
      .flush({ code: 'INVALID_RESET_TOKEN' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('expired');
    expect(element.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it('says so when the link lost its token', () => {
    setup('short');
    const fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'incomplete',
    );
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
});
