import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private userSubject = new BehaviorSubject<{
    id: string;
    email: string;
    displayName?: string | null;
    faceitId?: string | null;
  } | null>(null);

  readonly user$ = this.userSubject.asObservable();
  readonly user = toSignal(this.user$, { initialValue: null });

  constructor() {
    this.me().subscribe({ error: () => void 0 });
  }

  me() {
    return this.http.get<any>('/api/auth/me', { withCredentials: true }).pipe(
      tap((u) => this.userSubject.next(u as any))
    );
  }

  signInWithEmail(email: string, password: string) {
    return this.http
      .post<any>(
        '/api/auth/login',
        { email, password },
        { withCredentials: true }
      )
      .pipe(tap((u) => this.userSubject.next(u as any)));
  }

  signUpWithEmail(
    email: string,
    password: string,
    displayName?: string
  ) {
    return this.http
      .post<any>(
        '/api/auth/register',
        { email, password, displayName },
        { withCredentials: true }
      )
      .pipe(tap((u) => this.userSubject.next(u as any)));
  }

  logout() {
    return this.http
      .post('/api/auth/logout', {}, { withCredentials: true })
      .pipe(tap(() => this.userSubject.next(null)));
  }
}
