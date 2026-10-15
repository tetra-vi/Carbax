import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { Api } from '../core/api.service';
import { I18n, TPipe, UI_LANGUAGES } from '../core/i18n.service';
import { Session } from '../core/session.service';
import type { Facility, Member } from '../core/models';
import { BarChart, Notify, PeriodPicker, StatusChip, type ChartPoint } from '../shared/ui';

interface Dashboard {
  facility: { id: string; name: string };
  currentPeriod: { id: string; key: string; status: string } | null;
  kpis: { totalTCo2e: number | null; electricityKWh: number | null; dieselKg: number | null; productionT: number | null; intensityTCo2ePerT: number | null; evidenceCompletenessPct: number; openIssues: number; activeActions: number; latestCalculationStatus: string };
  series: { key: string; electricityKWh: number | null; dieselKg: number | null; productionT: number | null; intensity: number | null; totalTCo2e: number | null }[];
  anomalies: { periodKey: string; metric: string; changePct: number; threshold: number; message: string }[];
  actions: { id: string; title: string; status: string; latest: { periodKey: string; actualValue: number; changePct: number } | null; targetValue: number; baselineValue: number }[];
}

@Component({
  selector: 'cb-dashboard',
  standalone: true,
  imports: [DecimalPipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule, TPipe, BarChart, StatusChip, PeriodPicker],
  template: `
    <div class="page-head"><h1>{{ 'dashboard.title' | t }}</h1><cb-period-picker /></div>
    @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
    @if (!s.facilities().length) {
      <mat-card appearance="outlined"><mat-card-content><p>{{ 'dashboard.noFacility' | t }}</p><a mat-flat-button routerLink="/facilities">{{ 'facilities.add' | t }}</a></mat-card-content></mat-card>
    }
    @if (d(); as d) {
      <div class="kpis">
        <div class="kpi"><span>{{ 'kpi.period' | t }}</span><strong>{{ d.currentPeriod?.key ?? '–' }}</strong>@if (d.currentPeriod) { <cb-status [value]="d.currentPeriod.status" /> }</div>
        <div class="kpi"><span>{{ 'kpi.total' | t }}</span><strong>{{ d.kpis.totalTCo2e === null ? '–' : (d.kpis.totalTCo2e | number: '1.0-3') }} t CO₂e</strong></div>
        <div class="kpi"><span>{{ 'kpi.electricity' | t }}</span><strong>{{ d.kpis.electricityKWh === null ? '–' : (d.kpis.electricityKWh | number: '1.0-0') }} kWh</strong></div>
        <div class="kpi"><span>{{ 'kpi.fuel' | t }}</span><strong>{{ d.kpis.dieselKg === null ? '–' : (d.kpis.dieselKg | number: '1.0-0') }} kg</strong></div>
        <div class="kpi"><span>{{ 'kpi.production' | t }}</span><strong>{{ d.kpis.productionT === null ? '–' : (d.kpis.productionT | number: '1.0-2') }} t</strong></div>
        <div class="kpi"><span>{{ 'kpi.intensity' | t }}</span><strong>{{ d.kpis.intensityTCo2ePerT ?? '–' }} t/t</strong></div>
        <div class="kpi"><span>{{ 'kpi.completeness' | t }}</span><strong>{{ d.kpis.evidenceCompletenessPct }}%</strong></div>
        <div class="kpi"><span>{{ 'kpi.openIssues' | t }}</span><strong>{{ d.kpis.openIssues }}</strong></div>
        <div class="kpi"><span>{{ 'kpi.actions' | t }}</span><strong>{{ d.kpis.activeActions }}</strong></div>
        <div class="kpi"><span>{{ 'kpi.calcStatus' | t }}</span><cb-status [value]="d.kpis.latestCalculationStatus" /></div>
      </div>
      <div class="charts">
        <cb-bar-chart [title]="'chart.electricity' | t" unit="kWh" [points]="pts('electricityKWh')" />
        <cb-bar-chart [title]="'chart.fuel' | t" unit="kg" [points]="pts('dieselKg')" />
        <cb-bar-chart [title]="'chart.emissions' | t" unit="t CO₂e" [points]="pts('totalTCo2e')" />
        <cb-bar-chart [title]="'chart.intensity' | t" unit="t CO₂e/t" [points]="pts('intensity')" />
        <cb-bar-chart [title]="'chart.production' | t" unit="t" [points]="pts('productionT')" />
      </div>
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'dashboard.insights' | t }}</h2>
        @for (a of d.anomalies; track a.periodKey + a.metric) { <p><mat-icon class="warn-icon" aria-hidden="true">troubleshoot</mat-icon> <strong>{{ a.periodKey }}</strong> · {{ a.message }} <span class="muted small">({{ 'dashboard.threshold' | t }} {{ a.threshold }}%)</span></p> }
        @empty { <p class="muted">{{ 'dashboard.noAnomalies' | t }}</p> }
        @if (d.anomalies.length) { <button mat-stroked-button (click)="explain()" [disabled]="explaining()"><mat-icon>auto_awesome</mat-icon> {{ 'dashboard.explain' | t }}</button> }
        @if (explanation()) { <p class="ai-box">{{ explanation() }} <span class="ai-label">{{ 'common.aiGenerated' | t }}</span></p> }
        <p class="muted small">{{ 'dashboard.anomalyNote' | t }}</p>
      </mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'actions.title' | t }}</h2>
        @for (a of d.actions; track a.id) {
          <p><strong>{{ a.title }}</strong> <cb-status [value]="a.status" /> · {{ 'actions.baseline' | t }} {{ a.baselineValue }} → {{ 'actions.target' | t }} {{ a.targetValue }}
            @if (a.latest) { · {{ a.latest.periodKey }}: {{ a.latest.actualValue }} ({{ a.latest.changePct }}%) }</p>
        } @empty { <p class="muted">{{ 'actions.none' | t }}</p> }
      </mat-card-content></mat-card>
    }`,
})
export class DashboardPage {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  private i18n = inject(I18n);
  d = signal<Dashboard | null>(null);
  loading = signal(false);
  explaining = signal(false);
  explanation = signal<string | null>(null);
  constructor() {
    effect(() => {
      const fid = this.s.facilityId();
      const pid = this.s.periodId();
      if (fid) void this.load(fid, pid);
    });
  }
  async load(fid: string, pid: string | null) {
    this.loading.set(true);
    try {
      this.d.set(await this.api.get<Dashboard>('/intelligence/dashboard', { facilityId: fid, periodId: pid ?? undefined }));
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.loading.set(false);
    }
  }
  pts(k: 'electricityKWh' | 'dieselKg' | 'totalTCo2e' | 'intensity' | 'productionT'): ChartPoint[] {
    return (this.d()?.series ?? []).map((p) => ({ label: p.key.slice(2), value: p[k] }));
  }
  async explain() {
    this.explaining.set(true);
    try {
      const r = await this.api.post<{ explanation: string }>('/intelligence/explain', { facilityId: this.s.facilityId() });
      this.explanation.set(r.explanation);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.explaining.set(false);
    }
  }
}

@Component({
  selector: 'cb-facilities',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, TPipe, StatusChip],
  template: `
    <div class="page-head"><h1>{{ 'facilities.title' | t }}</h1></div>
    <div class="two-col">
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'facilities.add' | t }}</h2>
        <form [formGroup]="form" (ngSubmit)="create()" class="form-grid">
          <mat-form-field appearance="outline"><mat-label>{{ 'facilities.name' | t }}</mat-label><input matInput formControlName="name" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'facilities.location' | t }}</mat-label><input matInput formControlName="location" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'onboarding.country' | t }}</mat-label><input matInput formControlName="country" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'facilities.timeZone' | t }}</mat-label><input matInput formControlName="timeZone" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'onboarding.industry' | t }}</mat-label><input matInput formControlName="industry" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'facilities.processes' | t }}</mat-label><input matInput formControlName="processes" /><mat-hint>{{ 'common.commaSeparated' | t }}</mat-hint></mat-form-field>
          <mat-form-field appearance="outline" class="span2"><mat-label>{{ 'facilities.products' | t }}</mat-label><input matInput formControlName="products" /></mat-form-field>
          <button mat-flat-button class="span2" [disabled]="form.invalid">{{ 'facilities.add' | t }}</button>
        </form>
      </mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'periods.title' | t }}</h2>
        @for (f of s.facilities(); track f.id) {
          <div class="facility-row" [class.selected]="f.id === s.facilityId()">
            <button mat-button (click)="s.selectFacility(f.id)"><mat-icon>factory</mat-icon> {{ f.name }}</button>
            <span class="muted small">{{ f.location }}, {{ f.country }}</span>
            @if (f.status === 'ACTIVE') { <button mat-button class="small" (click)="archive(f)">{{ 'facilities.archive' | t }}</button> } @else { <cb-status [value]="f.status" /> }
          </div>
        } @empty { <p class="muted">{{ 'facilities.none' | t }}</p> }
        @if (s.facilityId()) {
          <div class="row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ 'periods.month' | t }}</mat-label><input matInput type="month" [(ngModel)]="newMonth" /></mat-form-field>
            <button mat-flat-button (click)="addPeriod()" [disabled]="!newMonth">{{ 'periods.open' | t }}</button>
          </div>
          <table class="data-table"><thead><tr><th>{{ 'common.period' | t }}</th><th>{{ 'common.status' | t }}</th><th></th></tr></thead>
            <tbody>@for (p of s.periods(); track p.id) {
              <tr><td>{{ p.key }}</td><td><cb-status [value]="p.status" /></td>
                <td>@if (p.status === 'APPROVED') { <button mat-button (click)="close(p.id)">{{ 'periods.close' | t }}</button> }
                    @if (p.status === 'APPROVED' || p.status === 'CLOSED') { <button mat-button (click)="reopen(p.id)">{{ 'periods.reopen' | t }}</button> }</td></tr>
            }</tbody></table>
        }
      </mat-card-content></mat-card>
    </div>`,
})
export class FacilitiesPage {
  s = inject(Session);
  private api = inject(Api);
  private fb = inject(FormBuilder);
  private notify = inject(Notify);
  private i18n = inject(I18n);
  newMonth = '';
  form = this.fb.nonNullable.group({
    name: ['', Validators.required], location: ['', Validators.required], country: ['Sri Lanka', Validators.required],
    timeZone: ['Asia/Colombo', Validators.required], industry: ['Aluminium', Validators.required], processes: ['Extrusion, Anodising'], products: ['Aluminium profiles'],
  });
  async create() {
    try {
      const v = this.form.getRawValue();
      const split = (x: string) => x.split(',').map((y) => y.trim()).filter(Boolean);
      await this.api.post<Facility>('/facilities', { name: v.name, location: v.location, country: v.country, timeZone: v.timeZone, industry: v.industry, processes: split(v.processes), productCategories: split(v.products), methodologies: ['energy-scope-v1'] });
      this.form.reset();
      await this.s.loadFacilities();
      this.notify.ok('common.saved');
    } catch (e) {
      this.notify.error(e);
    }
  }
  async addPeriod() {
    const [y, m] = this.newMonth.split('-').map(Number);
    try {
      await this.api.post('/reporting-periods', { facilityId: this.s.facilityId(), year: y, month: m });
      await this.s.loadPeriods();
      this.notify.ok('common.saved');
    } catch (e) {
      this.notify.error(e);
    }
  }
  async archive(f: Facility) {
    if (!confirm(this.i18n.t('facilities.archiveConfirm', { name: f.name }))) return;
    try {
      await this.api.patch(`/facilities/${f.id}`, { status: 'ARCHIVED' });
      await this.s.loadFacilities();
    } catch (e) {
      this.notify.error(e);
    }
  }
  async close(id: string) {
    try { await this.api.post(`/reporting-periods/${id}/close`); await this.s.loadPeriods(); } catch (e) { this.notify.error(e); }
  }
  async reopen(id: string) {
    const reason = prompt(this.i18n.t('periods.reopenReason'));
    if (!reason) return;
    try { await this.api.post(`/reporting-periods/${id}/reopen`, { reason }); await this.s.loadPeriods(); } catch (e) { this.notify.error(e); }
  }
}

@Component({
  selector: 'cb-team',
  standalone: true,
  imports: [FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, TPipe, StatusChip],
  template: `
    <div class="page-head"><h1>{{ 'team.title' | t }}</h1></div>
    <mat-card appearance="outlined"><mat-card-content>
      <h2>{{ 'team.invite' | t }}</h2>
      <div class="row wrap">
        <mat-form-field appearance="outline"><mat-label>{{ 'auth.email' | t }}</mat-label><input matInput type="email" [(ngModel)]="email" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>{{ 'team.role' | t }}</mat-label>
          <mat-select [(ngModel)]="role">@for (r of roles; track r) { <mat-option [value]="r">{{ ('role.' + r) | t }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>{{ 'common.facility' | t }}</mat-label>
          <mat-select [(ngModel)]="facility"><mat-option value="*">{{ 'team.allFacilities' | t }}</mat-option>@for (f of s.facilities(); track f.id) { <mat-option [value]="f.id">{{ f.name }}</mat-option> }</mat-select></mat-form-field>
        <button mat-flat-button (click)="invite()" [disabled]="!email">{{ 'team.send' | t }}</button>
      </div>
      @if (link()) { <p class="notice">{{ 'team.linkReady' | t }}<br /><code class="break">{{ link() }}</code> <button mat-button (click)="copy()">{{ 'common.copy' | t }}</button></p> }
    </mat-card-content></mat-card>
    <mat-card appearance="outlined"><mat-card-content>
      <table class="data-table"><thead><tr><th>{{ 'auth.name' | t }}</th><th>{{ 'auth.email' | t }}</th><th>{{ 'team.role' | t }}</th><th>{{ 'common.language' | t }}</th><th>{{ 'common.status' | t }}</th><th></th></tr></thead>
        <tbody>@for (m of members(); track m.uid) {
          <tr><td>{{ m.displayName }}</td><td>{{ m.email }}</td><td>{{ ('role.' + m.role) | t }}</td><td>{{ m.language }}</td><td><cb-status [value]="m.status" /></td>
            <td>@if (m.uid !== s.me()?.uid) { <button mat-button (click)="toggle(m)">{{ (m.status === 'ACTIVE' ? 'team.disable' : 'team.enable') | t }}</button> }</td></tr>
        }</tbody></table>
    </mat-card-content></mat-card>`,
})
export class TeamPage implements OnInit {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  members = signal<Member[]>([]);
  roles = ['WORKER', 'REVIEWER', 'OWNER'];
  email = '';
  role = 'WORKER';
  facility = '*';
  link = signal<string | null>(null);
  async ngOnInit() {
    try { this.members.set(await this.api.get<Member[]>('/members')); } catch (e) { this.notify.error(e); }
  }
  async invite() {
    try {
      const r = await this.api.post<{ inviteLink: string }>('/members/invites', { email: this.email, role: this.role, facilityIds: [this.facility] });
      this.link.set(r.inviteLink);
      this.email = '';
    } catch (e) {
      this.notify.error(e);
    }
  }
  copy() {
    void navigator.clipboard.writeText(this.link() ?? '');
    this.notify.ok('common.copied');
  }
  async toggle(m: Member) {
    try {
      await this.api.patch(`/members/${m.uid}`, { status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
      await this.ngOnInit();
    } catch (e) {
      this.notify.error(e);
    }
  }
}

interface Subscription { plan: { id: string; name: string; proposedMonthlyPriceUsd: number | null; maxFacilities: number; maxUsers: number; documentsPerMonth: number; aiCallsPerMonth: number; speechSecondsPerMonth: number; features: string[] }; trialEndsAt: string | null; usage: { month: string; documentsProcessed: number; aiCalls: number; speechSeconds: number; reportsGenerated: number }; counts: { facilities: number; users: number }; availablePlans: Subscription['plan'][]; payments: { status: string; note: string } }

@Component({
  selector: 'cb-subscription',
  standalone: true,
  imports: [DatePipe, MatCardModule, MatProgressBarModule, TPipe],
  template: `
    <div class="page-head"><h1>{{ 'subscription.title' | t }}</h1></div>
    @if (sub(); as v) {
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ v.plan.name }}</h2>
        @if (v.trialEndsAt) { <p>{{ 'subscription.trialEnds' | t }} {{ v.trialEndsAt | date: 'mediumDate' }}</p> }
        @for (u of usageRows(); track u.key) {
          <p>{{ u.key | t }}: {{ u.used }} / {{ u.limit }}</p>
          <mat-progress-bar mode="determinate" [value]="u.limit ? (u.used / u.limit) * 100 : 0" [attr.aria-label]="u.key | t" />
        }
        <p class="notice">{{ v.payments.note }}</p>
      </mat-card-content></mat-card>
      <div class="grid4">
        @for (p of v.availablePlans; track p.id) {
          <mat-card appearance="outlined" [class.selected]="p.id === v.plan.id"><mat-card-content>
            <h3>{{ p.name }}</h3><p class="price">{{ p.proposedMonthlyPriceUsd === null ? ('subscription.custom' | t) : '$' + p.proposedMonthlyPriceUsd + '/mo*' }}</p>
            <p class="small">{{ p.maxFacilities }} {{ 'subscription.facilities' | t }} · {{ p.maxUsers }} {{ 'subscription.users' | t }} · {{ p.documentsPerMonth }} {{ 'subscription.docs' | t }}</p>
            <p class="small muted">{{ p.features.join(', ') }}</p>
          </mat-card-content></mat-card>
        }
      </div>
      <p class="muted small">{{ 'landing.pricingNote' | t }}</p>
    }`,
})
export class SubscriptionPage implements OnInit {
  private api = inject(Api);
  private notify = inject(Notify);
  sub = signal<Subscription | null>(null);
  usageRows = computed(() => {
    const v = this.sub();
    if (!v) return [];
    return [
      { key: 'subscription.docsUsed', used: v.usage.documentsProcessed, limit: v.plan.documentsPerMonth },
      { key: 'subscription.aiUsed', used: v.usage.aiCalls, limit: v.plan.aiCallsPerMonth },
      { key: 'subscription.speechUsed', used: v.usage.speechSeconds, limit: v.plan.speechSecondsPerMonth },
      { key: 'subscription.facilitiesUsed', used: v.counts.facilities, limit: v.plan.maxFacilities },
      { key: 'subscription.usersUsed', used: v.counts.users, limit: v.plan.maxUsers },
    ];
  });
  async ngOnInit() {
    try { this.sub.set(await this.api.get<Subscription>('/subscription')); } catch (e) { this.notify.error(e); }
  }
}

interface AuditEvent { id: string; actor: string; action: string; entityType: string; entityId: string; summary: string; occurredAt: string; before?: unknown; after?: unknown }

@Component({
  selector: 'cb-audit',
  standalone: true,
  imports: [DatePipe, JsonPipe, MatCardModule, TPipe],
  template: `
    <div class="page-head"><h1>{{ 'audit.title' | t }}</h1></div>
    <mat-card appearance="outlined"><mat-card-content>
      <table class="data-table"><thead><tr><th>{{ 'audit.when' | t }}</th><th>{{ 'audit.who' | t }}</th><th>{{ 'audit.action' | t }}</th><th>{{ 'audit.summary' | t }}</th></tr></thead>
        <tbody>@for (e of events(); track e.id) {
          <tr><td class="nowrap">{{ e.occurredAt | date: 'short' }}</td><td>{{ actorName(e.actor) }}</td><td><code>{{ e.action }}</code></td>
            <td>{{ e.summary }} @if (e.before) { <span class="small muted">{{ e.before | json }} → {{ e.after | json }}</span> }</td></tr>
        }</tbody></table>
    </mat-card-content></mat-card>`,
})
export class AuditPage implements OnInit {
  private api = inject(Api);
  private notify = inject(Notify);
  events = signal<AuditEvent[]>([]);
  private names = new Map<string, string>();
  async ngOnInit() {
    try {
      const [ev, members] = await Promise.all([this.api.get<AuditEvent[]>('/audit'), this.api.get<Member[]>('/members').catch(() => [])]);
      for (const m of members) this.names.set(m.uid, m.displayName);
      this.events.set(ev);
    } catch (e) {
      this.notify.error(e);
    }
  }
  actorName(a: string) {
    return this.names.get(a) ?? a;
  }
}

@Component({
  selector: 'cb-settings',
  standalone: true,
  imports: [MatCardModule, MatSelectModule, MatFormFieldModule, MatSlideToggleModule, TPipe],
  template: `
    <div class="page-head"><h1>{{ 'nav.settings' | t }}</h1></div>
    <mat-card appearance="outlined"><mat-card-content>
      <mat-form-field appearance="outline"><mat-label>{{ 'common.language' | t }}</mat-label>
        <mat-select [value]="i18n.lang()" (valueChange)="s.setPreferences({ language: $event })">
          @for (l of languages; track l.code) { <mat-option [value]="l.code" [disabled]="!l.available">{{ l.label }}</mat-option> }
        </mat-select></mat-form-field>
      <p><mat-slide-toggle [checked]="s.guided()" (change)="s.setPreferences({ guidedMode: $event.checked })">{{ 'settings.guidedMode' | t }}</mat-slide-toggle></p>
      <p class="muted small">{{ 'settings.guidedHelp' | t }}</p>
      <p class="muted small">{{ 'settings.translationNote' | t }}</p>
    </mat-card-content></mat-card>`,
})
export class SettingsPage {
  s = inject(Session);
  i18n = inject(I18n);
  languages = UI_LANGUAGES;
}

@Component({
  selector: 'cb-admin',
  standalone: true,
  imports: [DatePipe, FormsModule, MatCardModule, MatButtonModule, MatSelectModule, MatFormFieldModule, TPipe, StatusChip],
  template: `
    <div class="page-head"><h1>{{ 'admin.title' | t }}</h1></div>
    @if (health(); as h) {
      <div class="kpis">
        <div class="kpi"><span>{{ 'admin.queued' | t }}</span><strong>{{ h.jobs.queued }}</strong></div>
        <div class="kpi"><span>{{ 'admin.running' | t }}</span><strong>{{ h.jobs.running }}</strong></div>
        <div class="kpi"><span>{{ 'admin.failed' | t }}</span><strong>{{ h.jobs.failed }}</strong></div>
        <div class="kpi"><span>AI</span><strong class="small">{{ h.ai.model }}</strong><span class="small muted">{{ h.ai.documentAi }}</span></div>
      </div>
      <mat-card appearance="outlined"><mat-card-content><h2>{{ 'admin.factorSets' | t }}</h2>
        @for (f of h.factorSets; track f.id) { <p>{{ f.id }} v{{ f.version }} <cb-status [value]="f.status" /> · {{ (f.gridFactorConfigured ? 'admin.configured' : 'admin.notConfigured') | t }}</p> }
      </mat-card-content></mat-card>
    }
    <mat-card appearance="outlined"><mat-card-content>
      <h2>{{ 'admin.organizations' | t }}</h2>
      <table class="data-table"><thead><tr><th>{{ 'onboarding.company' | t }}</th><th>{{ 'onboarding.country' | t }}</th><th>{{ 'admin.plan' | t }}</th><th>{{ 'common.status' | t }}</th><th>{{ 'admin.usage' | t }}</th><th></th></tr></thead>
        <tbody>@for (o of orgs(); track o.id) {
          <tr><td>{{ o.name }}<br /><span class="small muted">{{ o.createdAt | date: 'mediumDate' }}</span></td><td>{{ o.country }}</td>
            <td><mat-select [value]="o.plan" (valueChange)="update(o.id, { plan: $event })" [attr.aria-label]="'admin.plan' | t">@for (p of plans; track p) { <mat-option [value]="p">{{ p }}</mat-option> }</mat-select></td>
            <td><cb-status [value]="o.status" /></td>
            <td class="small">{{ o.usage.documentsProcessed }} docs · {{ o.usage.aiCalls }} AI · {{ o.members }} users · {{ o.facilities }} fac.</td>
            <td><button mat-button (click)="update(o.id, { status: o.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })">{{ (o.status === 'ACTIVE' ? 'admin.suspend' : 'admin.activate') | t }}</button></td></tr>
        }</tbody></table>
    </mat-card-content></mat-card>
    <mat-card appearance="outlined"><mat-card-content><h2>{{ 'admin.failedJobs' | t }}</h2>
      @for (j of jobs(); track j.id) { <p class="small"><code>{{ j.id }}</code> · {{ j.organizationId }} · {{ j.attempts }}× · {{ j.lastError }}</p> } @empty { <p class="muted">{{ 'admin.noFailed' | t }}</p> }
    </mat-card-content></mat-card>`,
})
export class AdminPage implements OnInit {
  private api = inject(Api);
  private notify = inject(Notify);
  plans = ['TRIAL', 'STARTER', 'GROWTH', 'BUSINESS', 'BUYER_NETWORK'];
  orgs = signal<{ id: string; name: string; country: string; plan: string; status: string; createdAt: string; members: number; facilities: number; usage: { documentsProcessed: number; aiCalls: number } }[]>([]);
  jobs = signal<{ id: string; organizationId: string; attempts: number; lastError?: string }[]>([]);
  health = signal<{ jobs: { queued: number; running: number; failed: number }; ai: { model: string; documentAi: string }; factorSets: { id: string; version: string; status: string; gridFactorConfigured: boolean }[] } | null>(null);
  async ngOnInit() {
    try {
      const [o, j, h] = await Promise.all([this.api.get<ReturnType<AdminPage['orgs']>>('/admin/organizations'), this.api.get<ReturnType<AdminPage['jobs']>>('/admin/jobs'), this.api.get<NonNullable<ReturnType<AdminPage['health']>>>('/admin/health')]);
      this.orgs.set(o);
      this.jobs.set(j);
      this.health.set(h);
    } catch (e) {
      this.notify.error(e);
    }
  }
  async update(id: string, patch: Record<string, string>) {
    try {
      await this.api.patch(`/admin/organizations/${id}`, patch);
      await this.ngOnInit();
    } catch (e) {
      this.notify.error(e);
    }
  }
}
