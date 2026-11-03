import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { avatarHue, avatarSource, UserAvatar } from './user-avatar';

@Component({
  imports: [UserAvatar],
  template: `<app-avatar class="initial" [username]="name()" [url]="url()" />`,
})
class Host {
  readonly name = signal('alice');
  readonly url = signal<string | null>(null);
}

describe('Player avatar', () => {
  const file = 'avatars/0f8fad5b-d9cb-469f-a165-70867728950e-0123456789abcdef.png';

  it('serves uploads from the API and keeps provider pictures on https only', () => {
    expect(avatarSource(file, '/api/v1/')).toBe(`/api/v1/${file}`);
    expect(avatarSource('https://cdn.intra.42.fr/users/a.jpg', '/api/v1')).toBe(
      'https://cdn.intra.42.fr/users/a.jpg',
    );
    for (const value of [
      null,
      '',
      'avatars/../../etc/passwd',
      'http://example.com/a.png',
      'javascript:alert(1)',
      'https://user:secret@example.com/a.png',
      'not a url',
    ])
      expect(avatarSource(value, '/api/v1')).toBeNull();
  });

  it('gives each name the same colour every time', () => {
    expect(avatarHue('Alice')).toBe(avatarHue('alice'));
    expect(avatarHue('alice')).toBeGreaterThanOrEqual(0);
    expect(avatarHue('alice')).toBeLessThan(360);
  });

  it('shows the initial without a picture, and again when the picture fails', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement.querySelector('app-avatar');
    expect(element.textContent?.trim()).toBe('A');
    expect(element.getAttribute('aria-hidden')).toBe('true');

    fixture.componentInstance.url.set(file);
    fixture.detectChanges();
    const image = element.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(`/api/v1/${file}`);
    expect(element.classList).toContain('has-picture');
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent?.trim()).toBe('A');

    // A new picture gets a new try.
    fixture.componentInstance.url.set(file.replace('.png', '.jpg'));
    fixture.detectChanges();
    expect(element.querySelector('img')).not.toBeNull();
  });
});
