import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';

export interface Goal {
  id?: string;
  title: string;
  metric: 'winrate' | 'matches' | 'kd' | 'hs';
  target: number | null;
  progress: number;
}

export interface GoalsState {
  uid?: string;
  goals: Goal[];
}

@Injectable({ providedIn: 'root' })
export class GoalsService {
  private readonly http = inject(HttpClient);
  private state$ = new BehaviorSubject<GoalsState | undefined>(undefined);

  watch() {
    if (!this.state$.value) {
      this.fetch().catch(() => void 0);
    }
    return this.state$.asObservable();
  }

  private async fetch(): Promise<void> {
    try {
      const resp = await this.http
        .get<{ goals: Goal[] }>('/api/goals', { withCredentials: true })
        .toPromise();
      this.state$.next({ uid: '', goals: resp?.goals ?? [] });
    } catch {
      this.state$.next({ uid: '', goals: [] });
    }
  }

  async upsert(state: Partial<GoalsState>): Promise<void> {
    const current = this.state$.value;
    const goals = state.goals ?? current?.goals ?? [];

    for (const g of goals) {
      if (!g.id) {
        await this.http
          .post('/api/goals', g, { withCredentials: true })
          .toPromise()
          .catch(() => void 0);
      } else {
        await this.http
          .patch(`/api/goals/${g.id}`, g, { withCredentials: true })
          .toPromise()
          .catch(() => void 0);
      }
    }
    await this.fetch();
  }

  async updateGoals(goals: Goal[]): Promise<void> {
    for (const g of goals) {
      await this.http
        .patch(`/api/goals/${g.id}`, g, { withCredentials: true })
        .toPromise()
        .catch(() => void 0);
    }
    await this.fetch();
  }
}
