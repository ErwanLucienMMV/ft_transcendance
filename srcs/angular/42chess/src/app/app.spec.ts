import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { provideRouter } from '@angular/router';
import { ErrorState } from './core/errors/error-state';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Hello, 42chess');
  });

  it('announces global errors and lets the user dismiss them', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(ErrorState).reportUnexpected();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role="alert"]')?.textContent).toContain(
      'Something went wrong.',
    );
    (compiled.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(compiled.querySelector('[role="alert"]')).toBeNull();
    expect(compiled.querySelector('nav[aria-label="Main navigation"]')).not.toBeNull();
  });
});
