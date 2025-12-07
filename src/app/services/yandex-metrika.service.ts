import { Injectable } from '@angular/core';

declare global {
  interface Window {
    ym: (id: number, action: string, ...args: unknown[]) => void;
  }
}

@Injectable({
  providedIn: 'root'
})
export class YandexMetrikaService {
  private readonly COUNTER_ID = 103844043;

  constructor() {
    this.initMetrika();
  }

  private initMetrika(): void {
    if (typeof window !== 'undefined') {
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://mc.yandex.ru/metrika/tag.js';
      document.head.appendChild(script);

      script.onload = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).ym = (window as any).ym || function() {
          // eslint-disable-next-line prefer-rest-params, @typescript-eslint/no-explicit-any
          ((window as any).ym.a = (window as any).ym.a || []).push(arguments);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).ym.l = +(new Date());

        window.ym(this.COUNTER_ID, 'init', {
          clickmap: true,
          trackLinks: true,
          accurateTrackBounce: true,
          webvisor: true
        });
      };
    }
  }

  trackPageView(url: string, title?: string): void {
    if (typeof window !== 'undefined' && window.ym) {
      window.ym(this.COUNTER_ID, 'hit', url, {
        title: title || document.title,
        referer: document.referrer
      });
    }
  }

  trackGoal(goalName: string, params?: Record<string, unknown>): void {
    if (typeof window !== 'undefined' && window.ym) {
      window.ym(this.COUNTER_ID, 'reachGoal', goalName, params);
    }
  }

  trackEvent(action: string, category?: string, label?: string, value?: number): void {
    if (typeof window !== 'undefined' && window.ym) {
      window.ym(this.COUNTER_ID, 'reachGoal', 'custom_event', {
        action,
        category,
        label,
        value
      });
    }
  }

  setUserParams(params: Record<string, unknown>): void {
    if (typeof window !== 'undefined' && window.ym) {
      window.ym(this.COUNTER_ID, 'userParams', params);
    }
  }

  trackSearch(searchQuery: string): void {
    this.trackGoal('search', { query: searchQuery });
  }

  trackRegistration(): void {
    this.trackGoal('registration');
  }

  trackLogin(): void {
    this.trackGoal('login');
  }

  trackAddToFavorites(playerId: string): void {
    this.trackGoal('add_to_favorites', { player_id: playerId });
  }

  trackPlayerView(playerId: string): void {
    this.trackGoal('player_view', { player_id: playerId });
  }

  trackGoalCreation(goalType: string): void {
    this.trackGoal('goal_creation', { goal_type: goalType });
  }

  trackNoteCreation(): void {
    this.trackGoal('note_creation');
  }
}
