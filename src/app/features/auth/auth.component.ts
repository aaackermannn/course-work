import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-auth',
  imports: [CommonModule],
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.less'],
})
export class AuthComponent {
  private readonly auth = inject(AuthService);
  get userEmail(): string | null {
    return this.auth.user()?.email ?? null;
  }

  login(email: string, password: string) {
    this.auth.signInWithEmail(email, password).subscribe();
  }
  logout() {
    this.auth.logout().subscribe();
  }
}
