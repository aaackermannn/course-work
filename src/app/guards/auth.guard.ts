import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take, switchMap, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserProfileService } from '../services/user-profile.service';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(AuthService);

  return auth.user$.pipe(
    take(1),
    map((user) => (user ? true : router.createUrlTree(['/search'])))
  );
};

export const faceitGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const userProfileService = inject(UserProfileService);

  return auth.user$.pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        return of(router.createUrlTree(['/search']));
      }

      return userProfileService.watchProfile().pipe(
        take(1),
        map((profile) => {
          if (profile?.faceitId) {
            return true;
          } else {
            return router.createUrlTree(['/account']);
          }
        })
      );
    })
  );
};
