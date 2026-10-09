import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FooterComponent } from './footer/footer';
import { NavbarComponent } from './navbar/navbar';

@Component({
  standalone: true,
  imports: [RouterOutlet, FooterComponent, NavbarComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('42chess');
}
