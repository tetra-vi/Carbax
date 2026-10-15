import { Component, inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { authGuard, orgGuard, roleGuard, superAdminGuard } from './core/guards';
import { Session } from './core/session.service';

/** Sends users to their appropriate starting screen. */
@Component({
  standalone: true,
  template: '',
})
export class HomeRedirect {
  constructor() {
    const session = inject(Session);
    const router = inject(Router);

    // Platform Super Admin without an organization
    if (session.me()?.isSuperAdmin && !session.org()) {
      void router.navigateByUrl('/admin');
      return;
    }

    const role = session.role();

    if (role === 'WORKER') {
      void router.navigateByUrl(session.guided() ? '/guided' : '/tasks');
      return;
    }

    if (role === 'OWNER' || role === 'REVIEWER') {
      void router.navigateByUrl('/dashboard');
      return;
    }

    void router.navigateByUrl('/settings');
  }
}

const pub = () => import('./pages/public');
const manage = () => import('./pages/manage');
const evidence = () => import('./pages/evidence');
const carbon = () => import('./pages/carbon');

export const routes: Routes = [
  // PUBLIC ROUTES
  {
    path: '',
    loadComponent: () => pub().then((m) => m.Landing),
  },
  {
    path: 'login',
    loadComponent: () => pub().then((m) => m.Login),
  },
  {
    path: 'register',
    loadComponent: () => pub().then((m) => m.Register),
  },
  {
    path: 'reset',
    loadComponent: () => pub().then((m) => m.ResetPassword),
  },
  {
    path: 'invite/:token',
    loadComponent: () => pub().then((m) => m.InviteAccept),
  },
  {
    path: 'shared/:token',
    loadComponent: () => pub().then((m) => m.SharedReport),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () => pub().then((m) => m.Onboarding),
  },

  // PLATFORM SUPER ADMIN
  // Keep outside orgGuard because platform admins
  // are not required to belong to an organization.
  {
    path: 'admin',
    canActivate: [authGuard, superAdminGuard],
    loadComponent: () => manage().then((m) => m.AdminPage),
  },

  // COMPANY ROUTES
  {
    path: '',
    canActivate: [orgGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.Shell),

    children: [
      {
        path: 'home',
        component: HomeRedirect,
      },
      {
        path: 'dashboard',
        canActivate: [roleGuard('OWNER', 'REVIEWER')],
        loadComponent: () => manage().then((m) => m.DashboardPage),
      },
      {
        path: 'facilities',
        canActivate: [roleGuard('OWNER')],
        loadComponent: () => manage().then((m) => m.FacilitiesPage),
      },
      {
        path: 'team',
        canActivate: [roleGuard('OWNER')],
        loadComponent: () => manage().then((m) => m.TeamPage),
      },
      {
        path: 'subscription',
        canActivate: [roleGuard('OWNER')],
        loadComponent: () => manage().then((m) => m.SubscriptionPage),
      },
      {
        path: 'audit',
        canActivate: [roleGuard('OWNER', 'REVIEWER')],
        loadComponent: () => manage().then((m) => m.AuditPage),
      },
      {
        path: 'settings',
        loadComponent: () => manage().then((m) => m.SettingsPage),
      },
      {
        path: 'documents',
        loadComponent: () => evidence().then((m) => m.DocumentsPage),
      },
      {
        path: 'documents/:id',
        loadComponent: () => evidence().then((m) => m.ReviewExtractionPage),
      },
      {
        path: 'carbonops',
        canActivate: [roleGuard('OWNER', 'REVIEWER')],
        loadComponent: () => evidence().then((m) => m.CarbonOpsPage),
      },
      {
        path: 'tasks',
        loadComponent: () => evidence().then((m) => m.TasksPage),
      },
      {
        path: 'tasks/:id',
        loadComponent: () => evidence().then((m) => m.TaskDetailPage),
      },
      {
        path: 'guided',
        loadComponent: () => evidence().then((m) => m.GuidedPage),
      },
      {
        path: 'results',
        canActivate: [roleGuard('OWNER', 'REVIEWER')],
        loadComponent: () => carbon().then((m) => m.ResultsPage),
      },
      {
        path: 'twin',
        canActivate: [roleGuard('OWNER', 'REVIEWER')],
        loadComponent: () => carbon().then((m) => m.TwinPage),
      },
      {
        path: 'actions',
        loadComponent: () => carbon().then((m) => m.ActionsPage),
      },
      {
        path: 'compliance',
        canActivate: [roleGuard('OWNER', 'REVIEWER')],
        loadComponent: () => carbon().then((m) => m.CompliancePage),
      },
      {
        path: 'review/:reportId',
        redirectTo: 'compliance',
      },
      {
        path: 'reports',
        redirectTo: 'compliance',
      },
    ],
  },

  {
    path: '**',
    redirectTo: '',
  },
];
