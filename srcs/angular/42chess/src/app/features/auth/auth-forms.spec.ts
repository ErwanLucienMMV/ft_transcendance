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

  // Lengths follow the backend's class-validator count, not UTF-16 code units.
  const emoji = (count: number) => '😀'.repeat(count);
  const heart = (count: number) => '\u2764\uFE0F'.repeat(count);

  it.each([
    { label: '8 ASCII', password: 'a'.repeat(8), accepted: true },
    { label: '128 ASCII', password: 'a'.repeat(128), accepted: true },
    { label: '7 ASCII', password: 'a'.repeat(7), accepted: false },
    { label: '129 ASCII', password: 'a'.repeat(129), accepted: false },
    { label: '4 emoji', password: emoji(4), accepted: false },
    { label: '8 emoji', password: emoji(8), accepted: true },
    { label: '65 emoji', password: emoji(65), accepted: true },
    { label: '128 emoji', password: emoji(128), accepted: true },
    { label: '129 emoji', password: emoji(129), accepted: false },
    { label: '4 variation sequences', password: heart(4), accepted: false },
    { label: '8 variation sequences', password: heart(8), accepted: true },
    { label: 'a leading space and 7 emoji', password: ' ' + emoji(7), accepted: true },
  ])('counts a registration password of $label like the backend', ({ password, accepted }) => {
    const fixture = TestBed.createComponent(RegisterForm);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, {
      username: 'Ta2b',
      email: 'player@example.com',
      password,
      confirmPassword: password,
    });
    submit(fixture);
    if (accepted)
      expect(received).toHaveBeenCalledExactlyOnceWith({
        username: 'Ta2b',
        email: 'player@example.com',
        password,
      });
    else expect(received).not.toHaveBeenCalled();
  });

  it.each([
    { label: '65 emoji', password: emoji(65), accepted: true },
    { label: '128 emoji', password: emoji(128), accepted: true },
    { label: '128 variation sequences', password: heart(128), accepted: true },
    { label: '129 emoji', password: emoji(129), accepted: false },
    { label: '129 ASCII', password: 'a'.repeat(129), accepted: false },
  ])('counts a login password of $label like the backend', ({ password, accepted }) => {
    const fixture = TestBed.createComponent(LoginForm);
    fixture.componentRef.setInput('submissionEnabled', true);
    fixture.detectChanges();
    const received = vi.fn();
    fixture.componentInstance.submitted.subscribe(received);
    enter(fixture, { login: 'Ta2b', password });
    submit(fixture);
    if (accepted) expect(received).toHaveBeenCalledExactlyOnceWith({ login: 'Ta2b', password });
    else expect(received).not.toHaveBeenCalled();
  });

  it('leaves password lengths to the backend-compatible validator, not native limits', () => {
    // Native limits count UTF-16 code units, and Chromium truncates replacements in masked fields.
    const login = TestBed.createComponent(LoginForm);
    const register = TestBed.createComponent(RegisterForm);
    login.detectChanges();
    register.detectChanges();
    const inputs = [
      login.nativeElement.querySelector('#login-password'),
      register.nativeElement.querySelector('#register-password'),
      register.nativeElement.querySelector('#register-confirm-password'),
    ] as HTMLInputElement[];
    for (const input of inputs) {
      expect(input.maxLength).toBe(-1);
      expect(input.minLength).toBe(-1);
    }
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
