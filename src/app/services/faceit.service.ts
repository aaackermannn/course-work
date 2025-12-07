import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface FaceitPlayerSummary {
  id: string;
  nickname: string;
  kdRatio: number;
  winRatePercent: number;
  matchesPlayed: number;
  headshotPercent: number;
  avatarUrl?: string | null;
  country?: string | null;
  level?: number | null;
  kpr?: number;
  kills?: number;
  deaths?: number;
  wins?: number;
  losses?: number;
  elo?: number | null;
  highestElo?: number | null;
  lowestElo?: number | null;
  avgElo?: number | null;
  faRating?: number;
  hltv?: number;
}

export interface PlayerMatchItem {
  matchId: string;
  game: string;
  playedAt: number;
  region: string;
  team?: string;
  map?: string;
}

export interface PlayerMatchesResponse {
  items: PlayerMatchItem[];
  total: number;
}

export interface PlayerMatchDetailedItem extends PlayerMatchItem {
  win?: boolean;
  kills?: number;
  deaths?: number;
  headshots?: number;
  kd?: number;
  scoreFor?: number;
  scoreAgainst?: number;
}

export interface PlayerMatchesDetailedResponse {
  items: PlayerMatchDetailedItem[];
  total: number;
}

export interface PlayerMapStatItem {
  map: string;
  winRatePercent: number;
  kdRatio: number;
  matchesPlayed: number;
}

export interface PlayerMapsResponse {
  items: PlayerMapStatItem[];
}

export interface PlayerTeammateItem {
  id: string;
  nickname: string;
  matchesTogether: number;
}

export interface PlayerTeammatesResponse {
  items: PlayerTeammateItem[];
}

export interface MatchScoreboardPlayer {
  id: string;
  nickname: string;
  kills: number;
  deaths: number;
  hs: number;
  kd: number;
  avatarUrl?: string;
  level?: number;
}

export interface MatchDetailsResponse {
  matchId: string;
  game: string;
  map?: string;
  startedAt: number;
  finishedAt: number;
  region?: string;
  winner?: 'faction1' | 'faction2' | null;
  scoreFor?: number;
  scoreAgainst?: number;
  scoreboard: Array<{
    key: 'faction1' | 'faction2';
    name?: string;
    score: number;
    players: MatchScoreboardPlayer[];
  }>;
}

@Injectable({ providedIn: 'root' })
export class FaceitService {
  private readonly http = inject(HttpClient);
  private readonly API = '/api/faceit';
  private readonly DEFAULT_GAME = 'cs2';

  searchPlayers(
    query: string,
    game = this.DEFAULT_GAME
  ): Observable<FaceitPlayerSummary[]> {
    return this.http.get<FaceitPlayerSummary[]>(`${this.API}/search`, {
      params: { q: query, game },
      withCredentials: true,
    });
  }

  getPlayerById(
    id: string,
    game = this.DEFAULT_GAME
  ): Observable<FaceitPlayerSummary> {
    return this.http.get<FaceitPlayerSummary>(`${this.API}/players/${id}`, {
      params: { game },
      withCredentials: true,
    });
  }

  getPlayerMatches(
    id: string,
    options?: { game?: string; limit?: number; offset?: number }
  ): Observable<PlayerMatchesResponse> {
    const game = options?.game ?? this.DEFAULT_GAME;
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    return this.http.get<PlayerMatchesResponse>(
      `${this.API}/players/${id}/matches`,
      {
        params: { game, limit, offset } as any,
        withCredentials: true,
      }
    );
  }

  getPlayerMatchesDetailed(
    id: string,
    options?: { game?: string; limit?: number; offset?: number }
  ): Observable<PlayerMatchesDetailedResponse> {
    const game = options?.game ?? this.DEFAULT_GAME;
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    return this.http.get<PlayerMatchesDetailedResponse>(
      `${this.API}/players/${id}/matches/details`,
      {
        params: { game, limit, offset } as any,
        withCredentials: true,
      }
    );
  }

  getPlayerMaps(
    id: string,
    game = this.DEFAULT_GAME
  ): Observable<PlayerMapsResponse> {
    return this.http.get<PlayerMapsResponse>(`${this.API}/players/${id}/maps`, {
      params: { game },
      withCredentials: true,
    });
  }

  getPlayerTeammates(
    id: string,
    game = this.DEFAULT_GAME
  ): Observable<PlayerTeammatesResponse> {
    return this.http.get<PlayerTeammatesResponse>(
      `${this.API}/players/${id}/teammates`,
      { params: { game }, withCredentials: true }
    );
  }

  getMatchDetails(matchId: string): Observable<MatchDetailsResponse> {
    return this.http.get<MatchDetailsResponse>(
      `${this.API}/matches/${matchId}`,
      { withCredentials: true }
    );
  }
}
