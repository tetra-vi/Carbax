import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { I18n, TPipe, UI_LANGUAGES } from '../core/i18n.service';
import { Session } from '../core/session.service';
import type { Lang, Notification, Role } from '../core/models';
import { VoiceMate } from './voicemate.component';

interface NavItem { path: string; icon: string; key: string; roles: Role[] }

const NAV: NavItem[] = [
  { path: '/dashboard', icon: 'insights', key: 'nav.dashboard', roles: ['OWNER', 'REVIEWER'] },
  { path: '/guided', icon: 'touch_app', key: 'nav.guided', roles: ['WORKER', 'OWNER'] },
  { path: '/tasks', icon: 'assignment', key: 'nav.tasks', roles: ['WORKER', 'OWNER'] },
  { path: '/documents', icon: 'upload_file', key: 'nav.documents', roles: ['OWNER', 'WORKER', 'REVIEWER'] },
  { path: '/carbonops', icon: 'smart_toy', key: 'nav.carbonops', roles: ['OWNER', 'REVIEWER'] },
  { path: '/results', icon: 'calculate', key: 'nav.results', roles: ['OWNER', 'REVIEWER'] },
  { path: '/twin', icon: 'tune', key: 'nav.twin', roles: ['OWNER', 'REVIEWER'] },
  { path: '/actions', icon: 'flag', key: 'nav.actions', roles: ['OWNER', 'WORKER'] },
  { path: '/compliance', icon: 'verified', key: 'nav.compliance', roles: ['OWNER', 'REVIEWER'] },
  { path: '/facilities', icon: 'factory', key: 'nav.facilities', roles: ['OWNER'] },
  { path: '/team', icon: 'group', key: 'nav.team', roles: ['OWNER'] },
  { path: '/subscription', icon: 'workspace_premium', key: 'nav.subscription', roles: ['OWNER'] },
  { path: '/audit', icon: 'history', key: 'nav.audit', roles: ['OWNER', 'REVIEWER'] },
  { path: '/settings', icon: 'settings', key: 'nav.settings', roles: ['OWNER', 'WORKER', 'REVIEWER'] },
];

@Component({
  selector: 'cb-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule, MatButtonModule, MatMenuModule, MatSlideToggleModule, MatBadgeModule, MatTooltipModule, TPipe, VoiceMate],
  template: `
    <a class="skip-link" href="#main">{{ 'common.skip' | t }}</a>
    <mat-sidenav-container class="shell">
      <mat-sidenav #nav [mode]="mobile() ? 'over' : 'side'" [opened]="!mobile()" class="side">
        <div class="brand"><mat-icon aria-hidden="true">eco</mat-icon><span>ComplyBridge AI</span></div>
        <nav [attr.aria-label]="'nav.main' | t">
          <mat-nav-list>
            @for (item of items(); track item.path) {
              <a mat-list-item [routerLink]="item.path" routerLinkActive="active" (click)="mobile() && nav.close()">
                <mat-icon matListItemIcon aria-hidden="true">{{ item.icon }}</mat-icon>
                <span matListItemTitle>{{ item.key | t }}</span>
              </a>
            }
            @if (s.me()?.isSuperAdmin) {
              <a mat-list-item routerLink="/admin" routerLinkActive="active"><mat-icon matListItemIcon>admin_panel_settings</mat-icon><span matListItemTitle>{{ 'nav.admin' | t }}</span></a>
            }
          </mat-nav-list>
        </nav>
      </mat-sidenav>
      <mat-sidenav #assistant position="end" mode="over" class="assistant-panel"><cb-voicemate /></mat-sidenav>
      <mat-sidenav-content>
        <mat-toolbar class="topbar">
          @if (mobile()) { <button mat-icon-button (click)="nav.toggle()" [attr.aria-label]="'nav.menu' | t"><mat-icon>menu</mat-icon></button> }
          <span class="org">{{ s.org()?.name }}</span>
          <span class="role-chip">{{ ('role.' + s.role()) | t }}</span>
          <span class="spacer"></span>
          <button mat-button [matMenuTriggerFor]="langMenu" [attr.aria-label]="'common.language' | t"><mat-icon>translate</mat-icon> {{ currentLangLabel() }}</button>
          <mat-menu #langMenu="matMenu">
            @for (l of languages; track l.code) {
              <button mat-menu-item [disabled]="!l.available" (click)="setLang(l.code)">{{ l.label }}</button>
            }
          </mat-menu>
          <button mat-icon-button (click)="assistant.toggle()" [matTooltip]="'voice.title' | t" [attr.aria-label]="'voice.title' | t"><mat-icon>support_agent</mat-icon></button>
          <button mat-icon-button [matMenuTriggerFor]="notes" (menuOpened)="loadNotes()" [attr.aria-label]="'nav.notifications' | t">
            <mat-icon [matBadge]="unread() || null" matBadgeSize="small">notifications</mat-icon>
          </button>
          <mat-menu #notes="matMenu" class="notes-menu">
            @for (n of notifications(); track n.id) {
              <button mat-menu-item (click)="openNote(n)" [class.unread]="!n.read">
                <span class="note-title">{{ n.title }}</span><br /><span class="small muted">{{ n.body }} · {{ n.createdAt | date: 'short' }}</span>
              </button>
            } @empty { <p class="pad muted">{{ 'nav.noNotifications' | t }}</p> }
          </mat-menu>
          <button mat-icon-button [matMenuTriggerFor]="userMenu" [attr.aria-label]="'nav.account' | t"><mat-icon>account_circle</mat-icon></button>
          <mat-menu #userMenu="matMenu">
            <p class="pad small">{{ s.me()?.member?.displayName }}<br /><span class="muted">{{ s.me()?.email }}</span></p>
            @if (s.role() === 'WORKER' || s.role() === 'OWNER') {
              <div class="pad" (click)="$event.stopPropagation()"><mat-slide-toggle [checked]="s.guided()" (change)="toggleGuided($event.checked)">{{ 'settings.guidedMode' | t }}</mat-slide-toggle></div>
            }
            <button mat-menu-item (click)="logout()"><mat-icon>logout</mat-icon>{{ 'auth.logout' | t }}</button>
          </mat-menu>
        </mat-toolbar>
        <main id="main" class="content" [class.guided]="s.guided()" tabindex="-1"><router-outlet /></main>
      </mat-sidenav-content>
    </mat-sidenav-container>`,
})
export class Shell {
  s = inject(Session);
  private auth = inject(AuthService);
  private api = inject(Api);
  private router = inject(Router);
  private i18n = inject(I18n);
  languages = UI_LANGUAGES;
  mobile = toSignal(inject(BreakpointObserver).observe('(max-width: 900px)').pipe(map((r) => r.matches)), { initialValue: false });
  items = computed(() => NAV.filter((i) => this.s.role() && i.roles.includes(this.s.role()!)));
  notifications = signal<Notification[]>([]);
  unread = computed(() => this.notifications().filter((n) => !n.read).length);
  currentLangLabel = computed(() => UI_LANGUAGES.find((l) => l.code === this.i18n.lang())?.label.split(' ')[0] ?? 'EN');

  constructor() {
    void this.loadNotes();
    setInterval(() => void this.loadNotes(), 60_000);
  }

  async loadNotes() {
    try {
      this.notifications.set(await this.api.get<Notification[]>('/notifications'));
    } catch {
      /* non-critical */
    }
  }
  async openNote(n: Notification) {
    await this.api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    await this.loadNotes();
    await this.router.navigateByUrl(n.link);
  }
  async setLang(l: Lang) {
    await this.s.setPreferences({ language: l });
  }
  async toggleGuided(v: boolean) {
    await this.s.setPreferences({ guidedMode: v });
    await this.router.navigateByUrl(v ? '/guided' : '/home');
  }
  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
