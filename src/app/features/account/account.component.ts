import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { UserProfileService, UserProfile } from '../../services/user-profile.service';
import { FaceitService } from '../../services/faceit.service';
import { YandexMetrikaService } from '../../services/yandex-metrika.service';
import {
  TuiInputModule,
  TuiIslandModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-account',
  imports: [
    CommonModule,
    FormsModule,
    TuiInputModule,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.less'],
})
export class AccountComponent {
  private readonly profiles = inject(UserProfileService);
  private readonly authService = inject(AuthService);
  private readonly faceitService = inject(FaceitService);
  private readonly metrika = inject(YandexMetrikaService);

  profile: UserProfile | undefined;
  error = false;
  loading = false;
  isAuthenticated = false;
  user:
    | { id: string; email: string; displayName?: string | null; photoURL?: string | null }
    | null = null;
  faceitId = '';
  playerStats: any = null;
  showLogin = false;
  showRegister = false;
  email = '';
  password = '';
  confirmPassword = '';

  constructor() {
    this.checkAuth();
  }

  private checkAuth(): void {
    this.authService.user$.subscribe({
      next: (user) => {
        this.isAuthenticated = !!user;
        this.user = user;
        if (this.isAuthenticated) {
          this.loadProfile();
        } else {
          this.loading = false;
        }
      },
    });
  }

  private async loadProfile(): Promise<void> {
    try {
      this.profiles.watchProfile().subscribe({
        next: (p) => {
          this.profile = p;
          this.faceitId = p?.faceitId ?? '';
          this.loading = false;

          if (p?.favoritePlayerIds?.length) {
            // Загружаем избранных игроков
          }
        },
        error: () => {
          this.loading = false;
        },
      });
    } catch (error) {
      this.loading = false;
    }
  }

  private async loadFaceitStats(faceitId: string): Promise<void> {
    try {
      const stats = await firstValueFrom(
        this.faceitService.getPlayerById(faceitId)
      );
      this.playerStats = stats;
    } catch (error) {
      // Ошибка при сохранении Faceit ID
    }
  }

  async saveFaceitId(): Promise<void> {
    if (!this.faceitId.trim() || !this.profile) return;

    try {
      await this.profiles.updateProfile({
        faceitId: this.faceitId.trim(),
      });

      await this.loadFaceitStats(this.faceitId.trim());
    } catch (error) {
      // Ошибка при сохранении Faceit ID
    }
  }

  async removeFavorite(playerId: string): Promise<void> {
    if (!this.profile) return;

    try {
      await this.profiles.removeFavorite(playerId);

      await this.profiles.refreshProfile();
    } catch (error) {
      // Ошибка при удалении из избранного
    }
  }

  get canRegister(): boolean {
    return Boolean(
      this.email.trim() &&
        this.password.trim() &&
        this.confirmPassword.trim() &&
        this.password === this.confirmPassword
    );
  }

  showLoginForm(): void {
    this.showLogin = true;
    this.showRegister = false;
  }

  showRegisterForm(): void {
    this.showLogin = false;
    this.showRegister = true;
  }

  backToMain(): void {
    this.showLogin = false;
    this.showRegister = false;
  }

  async signInWithEmail(): Promise<void> {
    if (!this.email || !this.password) {
      alert('Пожалуйста, заполните все поля для входа.');
      return;
    }

    try {
      await this.authService.signInWithEmail(this.email, this.password).toPromise();
      this.email = '';
      this.password = '';
      this.confirmPassword = '';
      this.showLogin = false;
      this.showRegister = false;
      this.metrika.trackLogin();
    } catch (error) {
      // Ошибка входа по email
      alert('Неверный email или пароль.');
    }
  }

  async signUpWithEmail(): Promise<void> {
    if (!this.email || !this.password || !this.confirmPassword) {
      alert('Пожалуйста, заполните все поля для регистрации.');
      return;
    }

    if (this.password !== this.confirmPassword) {
      alert('Пароли не совпадают.');
      return;
    }

    try {
      await this.authService
        .signUpWithEmail(this.email, this.password)
        .toPromise();
      this.email = '';
      this.password = '';
      this.confirmPassword = '';
      this.showLogin = false;
      this.showRegister = false;
      this.metrika.trackRegistration();
    } catch (error) {
      // Ошибка регистрации по email
      alert(
        'Пользователь с таким email уже существует или возникла другая ошибка.'
      );
    }
  }

  signOut(): void {
    this.authService.logout().subscribe();
  }
}
