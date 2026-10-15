import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';
import { Session } from './session.service';
import type { Role } from './models';

/**
 * Wait until the initial session request has completed.
 * Avoid redirecting while Firebase/API authentication is loading.
 */
async function waitForSession(session: Session) {
  for (let i = 0; i < 100 && (session.loading() || !session.me()); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Require Firebase authentication.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady;

  if (!auth.user()) {
    return router.createUrlTree(['/login']);
  }

  return true;
};

/**
 * Require an organization for company pages.
 *
 * Platform-only Super Admin:
 *   Redirect to /admin.
 *
 * Normal user without an organization:
 *   Redirect to /onboarding.
 */
export const orgGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const session = inject(Session);
  const router = inject(Router);

  await auth.whenReady;

  if (!auth.user()) {
    return router.createUrlTree(['/login']);
  }

  await waitForSession(session);

  // Existing company users
  if (session.org()) {
    return true;
  }

  // Platform Super Admin without a company
  if (session.me()?.isSuperAdmin) {
    return router.createUrlTree(['/admin']);
  }

  // New users who need to register their company
  return router.createUrlTree(['/onboarding']);
};

/**
 * Restrict company pages to allowed organization roles.
 */
export function roleGuard(...roles: Role[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const session = inject(Session);
    const router = inject(Router);

    await auth.whenReady;

    if (!auth.user()) {
      return router.createUrlTree(['/login']);
    }

    await waitForSession(session);

    const role = session.role();

    if (role && roles.includes(role)) {
      return true;
    }

    if (session.me()?.isSuperAdmin && !session.org()) {
      return router.createUrlTree(['/admin']);
    }

    return router.createUrlTree(['/home']);
  };
}

/**
 * Restrict the platform dashboard to Platform Super Admins.
 * The backend must independently enforce authorization.
 */
export const superAdminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const session = inject(Session);
  const router = inject(Router);

  await auth.whenReady;

  if (!auth.user()) {
    return router.createUrlTree(['/login']);
  }

  await waitForSession(session);

  if (session.me()?.isSuperAdmin === true) {
    return true;
  }

  if (session.org()) {
    return router.createUrlTree(['/home']);
  }

  return router.createUrlTree(['/onboarding']);
};
