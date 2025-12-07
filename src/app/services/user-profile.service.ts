import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, firstValueFrom } from 'rxjs';
import { tap, map } from 'rxjs/operators';

export interface UserProfile {
  uid: string;
  displayName: string | null;
  faceitId?: string | null;
  favoritePlayerIds: string[];
  goals: Array<{
    id: string;
    title: string;
    target: number;
    progress: number;
    metric: string;
  }>;
  achievements: Array<{ id: string; title: string; achievedAt: string }>;
}

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly http = inject(HttpClient);

  private profileSubject = new BehaviorSubject<UserProfile | undefined>(
    undefined
  );

  watchProfile(): Observable<UserProfile | undefined> {
    if (!this.profileSubject.value) {
      this.refreshProfile().catch(() => void 0);
    }
    return this.profileSubject.asObservable();
  }

  async addFavorite(playerId: string): Promise<void> {
    const currentProfile = this.profileSubject.value;
    await this.http
      .post('/api/favorites', { playerId }, { withCredentials: true })
      .toPromise();
    // оптимистично обновляем локально
    if (currentProfile) {
      const updated = {
        ...currentProfile,
        favoritePlayerIds: Array.from(
          new Set([...(currentProfile.favoritePlayerIds || []), playerId])
        ),
      };
      this.profileSubject.next(updated);
    }
    await this.refreshProfile();
  }

  async removeFavorite(playerId: string): Promise<void> {
    const currentProfile = this.profileSubject.value;
    await this.http
      .delete(`/api/favorites/${playerId}`, { withCredentials: true })
      .toPromise();
    if (currentProfile) {
      const updated = {
        ...currentProfile,
        favoritePlayerIds: (currentProfile.favoritePlayerIds || []).filter(
          (id) => id !== playerId
        ),
      };
      this.profileSubject.next(updated);
    }
    await this.refreshProfile();
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<void> {
    await this.http
      .patch('/api/profile', updates, { withCredentials: true })
      .toPromise();
    await this.refreshProfile();
  }

  async refreshProfile(): Promise<void> {
    try {
      const profile = await this.http
        .get<UserProfile & { favoritePlayerIds: string[] }>(
          '/api/profile',
          { withCredentials: true }
        )
        .toPromise();
      this.profileSubject.next(profile || undefined);
    } catch (error) {
      this.profileSubject.next(undefined);
    }
  }
}
