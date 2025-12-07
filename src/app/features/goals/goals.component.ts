import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoalsService, Goal } from '../../services/goals.service';
import { AuthService } from '../../services/auth.service';
import { UserProfileService } from '../../services/user-profile.service';
import { FaceitService } from '../../services/faceit.service';
import { YandexMetrikaService } from '../../services/yandex-metrika.service';
import {
  TuiInputModule,
  TuiIslandModule,
  TuiPaginationModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-goals',
  imports: [
    CommonModule,
    FormsModule,
    TuiInputModule,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiPaginationModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './goals.component.html',
  styleUrls: ['./goals.component.less'],
})
export class GoalsComponent {
  private readonly goalsService = inject(GoalsService);
  private readonly authService = inject(AuthService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly faceitService = inject(FaceitService);
  private readonly metrika = inject(YandexMetrikaService);

  goals: Goal[] = [];
  title = '';
  metric: Goal['metric'] = 'winrate';
  target: number | null = null;
  filter = '';
  page = 0;
  pageSize = 10;
  paged: Goal[] = [];
  totalPages = 0;
  loading = false;
  isAuthenticated = false;
  hasFaceitId = false;
  playerStats: any = null;

  constructor() {
    this.checkAuth();
  }

  private checkAuth(): void {
    this.loading = true;
    this.authService.user$.subscribe((user) => {
      this.isAuthenticated = !!user;

      if (this.isAuthenticated) {
        this.checkFaceitId();
      } else {
        this.loading = false;
      }
    });
  }

  getPaginationArray(): number[] {
    const totalPages = this.totalPages;
    const currentPage = this.page;
    const pages: number[] = [];

    if (totalPages <= 7) {
      for (let i = 0; i < totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(0);

      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4);
        pages.push(-1);
        pages.push(totalPages - 1);
      } else if (currentPage >= totalPages - 4) {
        pages.push(-1);
        for (let i = totalPages - 5; i < totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(-1);
        pages.push(currentPage - 1, currentPage, currentPage + 1);
        pages.push(-1);
        pages.push(totalPages - 1);
      }
    }

    return pages;
  }

  private async checkFaceitId(): Promise<void> {
    try {
      this.userProfileService.watchProfile().subscribe((profile) => {
        this.hasFaceitId = !!profile?.faceitId;

        if (this.hasFaceitId && profile?.faceitId) {
          this.loadPlayerStats(profile.faceitId);
          this.loadGoals();
        }

        this.loading = false;
      });
      await this.userProfileService.refreshProfile();
    } catch (error) {
      this.hasFaceitId = false;
      this.loading = false;
    }
  }

  private async loadPlayerStats(faceitId: string): Promise<void> {
    try {
      const stats = await firstValueFrom(
        this.faceitService.getPlayerById(faceitId)
      );
      this.playerStats = stats;
    } catch (error) {
      // Ошибка загрузки статистики игрока
    }
  }

  private loadGoals(): void {
    try {
      this.goalsService.watch().subscribe((s) => {
        this.goals = s?.goals ?? [];
        this.apply();
      });
    } catch {
      this.goals = [];
      this.apply();
    }
  }

  get canAdd(): boolean {
    return !!this.title.trim() && this.target !== null && this.target > 0;
  }

  getCurrentValue(goal: Goal): number {
    if (!this.playerStats) return goal.progress;

    switch (goal.metric) {
      case 'winrate':
        return this.playerStats.winRatePercent || 0;
      case 'matches':
        return this.playerStats.matchesPlayed || 0;
      case 'kd':
        return this.playerStats.kdRatio || 0;
      default:
        return goal.progress;
    }
  }

  getProgressPercent(goal: Goal): number {
    const current = this.getCurrentValue(goal);
    const target = goal.target;

    if (!target || target <= 0) return 0;

    const percent = (current / target) * 100;
    return Math.min(percent, 100);
  }

  async add(): Promise<void> {
    if (!this.canAdd) return;

    const newGoal: Goal = {
      title: this.title.trim(),
      metric: this.metric,
      target: this.target!,
      progress: this.getCurrentValue({
        metric: this.metric,
        target: this.target,
      } as Goal),
    };

    try {
      await this.goalsService.upsert({ goals: [...this.goals, newGoal] });
      this.clearForm();
      this.apply();
      this.metrika.trackGoalCreation(this.metric);
    } catch (error) {
      // Ошибка добавления цели
    }
  }

  editGoal(goal: Goal): void {
    this.title = goal.title;
    this.metric = goal.metric;
    this.target = goal.target;
  }

  async deleteGoal(goal: Goal): Promise<void> {
    if (confirm('Удалить эту цель?')) {
      try {
        const updatedGoals = this.goals.filter((g) => g.id !== goal.id);
        await this.goalsService.upsert({ goals: updatedGoals });
        this.apply();
      } catch (error) {
        // Ошибка удаления цели
      }
    }
  }

  clearForm(): void {
    this.title = '';
    this.target = null;
    this.metric = 'winrate';
  }

  clearFilter(): void {
    this.filter = '';
    this.page = 0;
    this.apply();
  }

  signIn(): void {
    // Google auth не используется в локальном варианте
  }

  onFilter(value: string): void {
    this.filter = (value || '').toLowerCase();
    this.page = 0;
    this.apply();
  }

  onSort(key: 'title' | 'metric' | 'target' | 'progress'): void {
    // Сортировка отключена
  }

  private apply(): void {
    let arr = [...this.goals];

    if (this.filter) {
      arr = arr.filter((g) => g.title.toLowerCase().includes(this.filter));
    }

    this.totalPages = Math.ceil(arr.length / this.pageSize) || 1;
    const start = this.page * this.pageSize;
    this.paged = arr.slice(start, start + this.pageSize);
  }
}
