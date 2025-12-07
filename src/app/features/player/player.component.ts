import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  FaceitService,
  FaceitPlayerSummary,
} from '../../services/faceit.service';
import { UserProfileService } from '../../services/user-profile.service';
import { AuthService } from '../../services/auth.service';
import { YandexMetrikaService } from '../../services/yandex-metrika.service';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';
import { TuiIslandModule, TuiTagModule, TuiBadgeModule } from '@taiga-ui/kit';

@Component({
  standalone: true,
  selector: 'app-player',
  imports: [
    CommonModule,
    RouterLink,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './player.component.html',
  styleUrls: ['./player.component.less'],
})
export class PlayerComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly faceit = inject(FaceitService);
  private readonly profiles = inject(UserProfileService);
  private readonly auth = inject(AuthService);
  private readonly metrika = inject(YandexMetrikaService);
  player: FaceitPlayerSummary | null = null;
  loading = true;
  error = false;
  isFavorite = false;
  isAuthenticated = false;

  constructor() {
    this.checkAuth();
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.faceit.getPlayerById(id).subscribe({
        next: (p) => {
          this.player = {
            ...p,
            kdRatio: Number(p.kdRatio) || 0,
            winRatePercent: Number(p.winRatePercent) || 0,
            matchesPlayed: Number(p.matchesPlayed) || 0,
            headshotPercent: Number(p.headshotPercent) || 0,
            kpr: Number(p.kpr) || 0,
            kills: Number(p.kills) || 0,
            deaths: Number(p.deaths) || 0,
            wins: Number(p.wins) || 0,
            losses: Number(p.losses) || 0,
            elo: Number(p.elo) || 0,
            level: Number(p.level) || 0,
          };
          this.loading = false;
          this.checkFavoriteStatus(p.id);
          this.metrika.trackPlayerView(p.id);
        },
        error: () => {
          this.loading = false;
          this.error = true;
        },
      });
    }
  }

  private checkAuth(): void {
    this.auth.user$.subscribe((user) => {
      this.isAuthenticated = !!user;
    });
  }

  private checkFavoriteStatus(playerId: string): void {
    if (!this.isAuthenticated) {
      return;
    }

    try {
      this.profiles.watchProfile().subscribe((prof) => {
        this.isFavorite = !!prof?.favoritePlayerIds?.includes(playerId);
      });
    } catch (error) {
      this.isFavorite = false;
    }
  }

  signIn(): void {
    // Google auth не используется в локальном варианте
  }

  getCountryFlag(countryCode: string): string {
    if (!countryCode) return '';

    return `https://flagcdn.com/w80/${countryCode.toLowerCase()}.png`;
  }

  getLevelIcon(level: number): string {
    return `/src/levels/level_${level}.png`;
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
      const parent = target.parentElement;
      if (parent && parent.classList.contains('level-badge-inline')) {
        const level = target.alt.replace('Level ', '');
        parent.innerHTML = `<span class="level-text">Level ${level}</span>`;
      }
    }
  }

  async toggleFavorite(): Promise<void> {
    if (!this.player) return;

    try {
      if (this.isFavorite) {
        await this.profiles.removeFavorite(this.player.id);
        this.isFavorite = false;
      } else {
        await this.profiles.addFavorite(this.player.id);
        this.isFavorite = true;
        this.metrika.trackAddToFavorites(this.player.id);
      }

      this.checkFavoriteStatus(this.player.id);
    } catch (e) {
      // Ошибка при переключении избранного
    }
  }
}
