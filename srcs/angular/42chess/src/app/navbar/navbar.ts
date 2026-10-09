
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
})
export class NavbarComponent {
  @Input() username: string | null = null;

  get displayName(): string {
    return this.username?.trim() || 'guest';
  }

  get avatarInitial(): string {
    return this.displayName.charAt(0).toUpperCase();
  }
}