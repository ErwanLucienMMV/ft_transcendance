import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginForm } from './login-form';
import { RegisterForm } from './register-form';

function enter(fixture: ComponentFixture<unknown>, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const input = fixture.nativeElement.querySelector(
      `[formControlName="${name}"]`,
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  fixture.detectChanges();
}

function submit(fixture: ComponentFixture<unknown>): void {
  fixture.nativeElement
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  fixture.detectChanges();
}

describe('Authentication forms', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [LoginForm, RegisterForm] }));

  it('accepts a username or email for login and preserves the password exactly', () => {
    const fixture = TestBed.createComponent(LoginForm);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, { login: 'Ta2b', password: '  pass  ' });
    submit(fixture);
    expect(received).toHaveBeenCalledWith({ login: 'Ta2b', password: '  pass  ' });
    enter(fixture, { login: 'player@example.com', password: 'x' });
    submit(fixture);
    expect(received).toHaveBeenLastCalledWith({ login: 'player@example.com', password: 'x' });
    expect(fixture.nativeElement.querySelector('#login').type).toBe('text');
  });

  it('rejects empty credentials and exposes linked validation messages', () => {
    const fixture = TestBed.createComponent(LoginForm);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    submit(fixture);
    expect(received).not.toHaveBeenCalled();
    const input = fixture.nativeElement.querySelector('#login') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('login-error');
    expect(fixture.nativeElement.querySelector('#login-error')).not.toBeNull();
  });

  it('does not submit while the page has no authentication integration', () => {
    const fixture = TestBed.createComponent(LoginForm);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, { login: 'Ta2b', password: 'password' });
    submit(fixture);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain(
      'unavailable',
    );
    expect(received).not.toHaveBeenCalled();
  });

  it('rejects duplicate login submissions while pending', () => {
    const fixture = TestBed.createComponent(LoginForm);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.componentRef.setInput('pending', true);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, { login: 'Ta2b', password: 'password' });
    submit(fixture);
    expect(received).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('form').getAttribute('aria-busy')).toBe('true');
  });

  it('emits only the registration DTO, without password confirmation', () => {
    const fixture = TestBed.createComponent(RegisterForm);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, {
      username: 'Ta2b_42',
      email: 'player@example.com',
      password: '  secret  ',
      confirmPassword: '  secret  ',
    });
    submit(fixture);
    expect(received).toHaveBeenCalledExactlyOnceWith({
      username: 'Ta2b_42',
      email: 'player@example.com',
      password: '  secret  ',
    });
  });

  it.each([
    { username: 'ab' },
    { username: 'a'.repeat(33) },
    { username: 'invalid name' },
    { email: 'invalid' },
    { password: 'short', confirmPassword: 'short' },
    { password: 'a'.repeat(129), confirmPassword: 'a'.repeat(129) },
    { confirmPassword: 'different' },
  ])('rejects invalid registration fields: %j', (override) => {
    const fixture = TestBed.createComponent(RegisterForm);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, {
      username: 'Ta2b',
      email: 'player@example.com',
      password: 'password',
      confirmPassword: 'password',
      ...override,
    });
    submit(fixture);
    expect(received).not.toHaveBeenCalled();
    expect(fixture.componentInstance.form.invalid).toBe(true);
    expect(fixture.nativeElement.querySelector('[aria-invalid="true"]')).not.toBeNull();
  });

  it('also prevents registration submissions when unavailable or pending', () => {
    const fixture = TestBed.createComponent(RegisterForm);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, {
      username: 'Ta2b',
      email: 'player@example.com',
      password: 'password',
      confirmPassword: 'password',
    });
    submit(fixture);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.componentRef.setInput('pending', true);
    fixture.detectChanges();
    submit(fixture);
    expect(received).not.toHaveBeenCalled();
  });
});
