import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Api } from '../core/api.service';
import { I18n, TPipe } from '../core/i18n.service';
import { Session } from '../core/session.service';
import type { Action, Calculation, DocumentRecord, Measurement, Member, Readiness, Report, Scenario, Share } from '../core/models';
import { Notify, PeriodPicker, StatusChip } from '../shared/ui';

/** Calculation results with full source-to-number lineage. */
@Component({
  selector: 'cb-results',
  standalone: true,
  imports: [DatePipe, DecimalPipe, MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule, TPipe, StatusChip, PeriodPicker],
  template: `
    <div class="page-head"><h1>{{ 'results.title' | t }}</h1><cb-period-picker /></div>
    <button mat-flat-button (click)="run()" [disabled]="busy()"><mat-icon>calculate</mat-icon> {{ 'results.run' | t }}</button>
    @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
    @if (calc(); as c) {
      <div class="kpis">
        <div class="kpi"><span>{{ 'kpi.total' | t }}</span><strong>{{ c.result.totalTCo2e | number: '1.0-4' }} t CO₂e</strong></div>
        <div class="kpi"><span>{{ 'kpi.intensity' | t }}</span><strong>{{ c.result.intensityTCo2ePerT ?? '–' }} t/t</strong></div>
        <div class="kpi"><span>{{ 'kpi.calcStatus' | t }}</span><cb-status [value]="c.status" /></div>
        <div class="kpi"><span>{{ 'results.version' | t }}</span><strong class="small">{{ c.factorSetId }} v{{ c.factorSetVersion }} · {{ c.formulaVersion }}</strong></div>
      </div>
      @for (r of c.incompleteReasons; track r) { <p class="notice warn">{{ r }}</p> }
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'results.lines' | t }}</h2>
        <table class="data-table"><thead><tr><th>{{ 'results.line' | t }}</th><th>{{ 'results.input' | t }}</th><th>{{ 'results.factor' | t }}</th><th>{{ 'results.formula' | t }}</th><th>t CO₂e</th><th>{{ 'results.sources' | t }}</th></tr></thead>
          <tbody>@for (l of c.result.lines; track l.label) {
            <tr><td>{{ l.label }}</td><td>{{ l.input | number: '1.0-3' }} {{ l.inputUnit }}</td><td>{{ l.factor ?? '–' }} {{ l.factorUnit ?? '' }}</td><td class="small"><code>{{ l.formula }}</code></td><td>{{ l.resultTCo2e ?? '–' }}</td>
              <td class="small">@for (d of l.sourceDocumentIds; track d) { <span class="source-chip">{{ docName(d) }}</span> }</td></tr>
          }</tbody></table>
      </mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'results.evidence' | t }}</h2>
        <table class="data-table"><thead><tr><th>{{ 'review.type' | t }}</th><th>{{ 'review.quantity' | t }}</th><th>{{ 'review.month' | t }}</th><th>{{ 'results.source' | t }}</th><th>{{ 'results.confirmed' | t }}</th></tr></thead>
          <tbody>@for (m of measurements(); track m.id) {
            <tr><td>{{ ('mtype.' + m.type) | t }}</td><td>{{ m.quantity }} {{ m.unit }} @if (m.corrected) { <span class="chip warn small">{{ 'results.corrected' | t }} ({{ 'review.aiRead' | t }} {{ m.aiValue }})</span> }</td>
              <td>{{ m.reportingMonth }}</td><td class="small">{{ docName(m.sourceDocumentId) }}<br /><span class="muted">{{ m.sourceSnippet }}</span></td><td class="nowrap small">{{ m.confirmedAt | date: 'short' }}</td></tr>
          }</tbody></table>
      </mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'results.boundary' | t }}</h2><p>{{ c.boundary }}</p><p class="small">{{ c.allocationMethod }}</p>
        <ul class="checklist">@for (x of c.coverage; track x.element) { <li><mat-icon>{{ x.included ? 'check' : 'remove' }}</mat-icon> {{ x.element }} — <span class="muted">{{ x.note }}</span></li> }</ul>
        <h3>{{ 'results.assumptions' | t }}</h3>
        <ul>@for (a of c.assumptions; track a) { <li class="small">{{ a }}</li> }</ul>
      </mat-card-content></mat-card>
    } @else { <p class="muted">{{ 'results.none' | t }}</p> }`,
})
export class ResultsPage {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  calc = signal<Calculation | null>(null);
  measurements = signal<Measurement[]>([]);
  docs = signal<DocumentRecord[]>([]);
  busy = signal(false);
  constructor() {
    effect(() => {
      const p = this.s.period();
      if (p) void this.load(p.id, p.latestCalculationId);
    });
  }
  async load(pid: string, calcId?: string) {
    try {
      const [m, d] = await Promise.all([this.api.get<Measurement[]>(`/reporting-periods/${pid}/measurements`), this.api.get<DocumentRecord[]>(`/reporting-periods/${pid}/documents`)]);
      this.measurements.set(m);
      this.docs.set(d);
      this.calc.set(calcId ? await this.api.get<Calculation>(`/calculations/${calcId}`) : null);
    } catch (e) {
      this.notify.error(e);
    }
  }
  docName(id: string) {
    return this.docs().find((d) => d.id === id)?.fileName ?? id;
  }
  async run() {
    this.busy.set(true);
    try {
      const c = await this.api.post<Calculation>('/calculations/run', { periodId: this.s.periodId() });
      this.calc.set(c);
      await this.s.loadPeriods();
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

/** CarbonTwin Lite: hypothetical scenarios on a copy of confirmed data, then real improvement actions. */
@Component({
  selector: 'cb-twin',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatSliderModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressBarModule, TPipe, PeriodPicker],
  template: `
    <div class="page-head"><h1>{{ 'twin.title' | t }}</h1><cb-period-picker /></div>
    <p class="muted">{{ 'twin.intro' | t }}</p>
    <div class="two-col">
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'twin.adjust' | t }}</h2>
        @for (k of sliders; track k.key) {
          <label class="slider-label" [for]="k.key">{{ k.label | t }}: <strong>{{ inputs[k.key] > 0 ? '+' : '' }}{{ inputs[k.key] }}%</strong></label>
          <mat-slider min="-50" max="50" step="1" discrete class="full"><input matSliderThumb [id]="k.key" [(ngModel)]="inputs[k.key]" /></mat-slider>
        }
        <div class="form-grid">
          <mat-form-field appearance="outline"><mat-label>{{ 'twin.dieselPrice' | t }}</mat-label><input matInput type="number" min="0" [(ngModel)]="dieselPrice" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'twin.elecPrice' | t }}</mat-label><input matInput type="number" min="0" [(ngModel)]="elecPrice" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>{{ 'twin.currency' | t }}</mat-label><input matInput maxlength="8" [(ngModel)]="currency" /></mat-form-field>
        </div>
        <button mat-flat-button (click)="simulate()" [disabled]="busy()"><mat-icon>play_arrow</mat-icon> {{ 'twin.simulate' | t }}</button>
        @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
      </mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'twin.result' | t }} <span class="chip warn">{{ 'twin.hypothetical' | t }}</span></h2>
        @if (scenario(); as sc) {
          <table class="data-table"><thead><tr><th></th><th>{{ 'twin.baseline' | t }}</th><th>{{ 'twin.scenario' | t }}</th></tr></thead>
            <tbody>
              <tr><td>{{ 'kpi.total' | t }}</td><td>{{ sc.baseline.totalTCo2e | number: '1.0-4' }}</td><td>{{ sc.projected.totalTCo2e | number: '1.0-4' }}</td></tr>
              <tr><td>{{ 'kpi.intensity' | t }}</td><td>{{ sc.baseline.intensityTCo2ePerT ?? '–' }}</td><td>{{ sc.projected.intensityTCo2ePerT ?? '–' }}</td></tr>
              <tr><td>{{ 'kpi.electricity' | t }}</td><td>{{ sc.baseline.electricityKWh | number }}</td><td>{{ sc.projected.electricityKWh | number }}</td></tr>
              <tr><td>{{ 'kpi.fuel' | t }}</td><td>{{ sc.baseline.dieselKg | number }}</td><td>{{ sc.projected.dieselKg | number }}</td></tr>
            </tbody></table>
          <p class="lead">{{ 'twin.delta' | t }}: <strong>{{ sc.delta.totalTCo2e > 0 ? '+' : '' }}{{ sc.delta.totalTCo2e }} t CO₂e</strong>
            @if (sc.delta.costChange !== null) { · {{ 'twin.cost' | t }}: <strong>{{ sc.delta.costChange | number: '1.0-2' }} {{ currency }}</strong> }</p>
          @if (sc.explanation) { <p class="ai-box">{{ sc.explanation }} <span class="ai-label">{{ 'common.aiGenerated' | t }}</span></p> }
          <ul>@for (a of sc.assumptions; track a) { <li class="small muted">{{ a }}</li> }</ul>
          <h3>{{ 'twin.createAction' | t }}</h3>
          <div class="form-grid">
            <mat-form-field appearance="outline" class="span2"><mat-label>{{ 'actions.titleField' | t }}</mat-label><input matInput [(ngModel)]="action.title" /></mat-form-field>
            <mat-form-field appearance="outline" class="span2"><mat-label>{{ 'actions.description' | t }}</mat-label><textarea matInput rows="2" [(ngModel)]="action.description"></textarea></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ 'actions.metric' | t }}</mat-label>
              <mat-select [(ngModel)]="action.metric"><mat-option value="DIESEL_L">{{ 'actions.DIESEL_L' | t }}</mat-option><mat-option value="ELECTRICITY_KWH">{{ 'actions.ELECTRICITY_KWH' | t }}</mat-option><mat-option value="INTENSITY">{{ 'actions.INTENSITY' | t }}</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ 'actions.targetPct' | t }}</mat-label><input matInput type="number" [(ngModel)]="action.targetChangePct" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ 'carbonops.assignee' | t }}</mat-label>
              <mat-select [(ngModel)]="action.assigneeUid">@for (m of members(); track m.uid) { <mat-option [value]="m.uid">{{ m.displayName }}</mat-option> }</mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ 'actions.due' | t }}</mat-label><input matInput type="date" [(ngModel)]="action.dueDate" /></mat-form-field>
          </div>
          <button mat-flat-button (click)="createAction()" [disabled]="!action.title || s.role() !== 'OWNER'"><mat-icon>flag</mat-icon> {{ 'twin.createAction' | t }}</button>
        } @else { <p class="muted">{{ 'twin.none' | t }}</p> }
      </mat-card-content></mat-card>
    </div>
    <mat-card appearance="outlined"><mat-card-content>
      <h2>{{ 'twin.history' | t }}</h2>
      @for (h of history(); track h.id) { <p class="small">{{ h.createdAt | date: 'short' }} · {{ 'twin.delta' | t }} {{ h.delta.totalTCo2e }} t CO₂e · <button mat-button (click)="scenario.set(h)">{{ 'common.view' | t }}</button></p> }
    </mat-card-content></mat-card>`,
})
export class TwinPage {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  sliders = [
    { key: 'electricityChangePct' as const, label: 'twin.electricity' },
    { key: 'dieselChangePct' as const, label: 'twin.diesel' },
    { key: 'productionChangePct' as const, label: 'twin.production' },
  ];
  inputs = { electricityChangePct: 0, dieselChangePct: -10, productionChangePct: 0 };
  dieselPrice: number | null = null;
  elecPrice: number | null = null;
  currency = 'LKR';
  scenario = signal<Scenario | null>(null);
  history = signal<Scenario[]>([]);
  members = signal<Member[]>([]);
  busy = signal(false);
  action = { title: '', description: '', metric: 'DIESEL_L', targetChangePct: -10, assigneeUid: '', dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) };
  constructor() {
    effect(() => {
      const pid = this.s.periodId();
      if (pid) void this.load(pid);
    });
  }
  async load(pid: string) {
    try {
      this.history.set(await this.api.get<Scenario[]>(`/reporting-periods/${pid}/scenarios`));
      this.members.set(await this.api.get<Member[]>('/members').catch(() => []));
    } catch (e) {
      this.notify.error(e);
    }
  }
  async simulate() {
    this.busy.set(true);
    try {
      const sc = await this.api.post<Scenario>('/scenarios', {
        periodId: this.s.periodId(),
        inputs: { ...this.inputs, dieselPricePerL: this.dieselPrice || null, electricityPricePerKWh: this.elecPrice || null, currency: this.currency || null },
      });
      this.scenario.set(sc);
      if (!this.action.title) this.action.title = this.inputs.dieselChangePct < 0 ? 'Investigate diesel use' : 'Energy improvement';
      await this.load(this.s.periodId()!);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  async createAction() {
    try {
      await this.api.post('/improvement-actions', {
        title: this.action.title, description: this.action.description, metric: this.action.metric, baselinePeriodId: this.s.periodId(),
        targetChangePct: Number(this.action.targetChangePct), scenarioId: this.scenario()?.id, assigneeUid: this.action.assigneeUid || undefined,
        startDate: new Date().toISOString().slice(0, 10), dueDate: this.action.dueDate,
      });
      this.notify.ok('actions.created');
    } catch (e) {
      this.notify.error(e);
    }
  }
}

@Component({
  selector: 'cb-actions',
  standalone: true,
  imports: [FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatSelectModule, MatFormFieldModule, TPipe, StatusChip],
  template: `
    <div class="page-head"><h1>{{ 'actions.title' | t }}</h1></div>
    @for (a of actions(); track a.id) {
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ a.title }} <cb-status [value]="a.status" /></h2>
        <p>{{ a.description }}</p>
        <p class="small">{{ ('actions.' + a.metric) | t }} · {{ 'actions.baseline' | t }} {{ a.baselineValue }} → {{ 'actions.target' | t }} {{ a.targetValue }} · {{ 'actions.due' | t }} {{ a.dueDate }}</p>
        @for (f of a.followUps; track f.periodKey) { <p class="small">{{ f.periodKey }}: {{ 'actions.measured' | t }} {{ f.actualValue }} ({{ f.changePct > 0 ? '+' : '' }}{{ f.changePct }}%)</p> }
        @empty { <p class="small muted">{{ 'actions.noFollowUp' | t }}</p> }
        <div class="row">
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ 'common.status' | t }}</mat-label>
            <mat-select [value]="a.status" (valueChange)="update(a, $event)">@for (st of statuses; track st) { <mat-option [value]="st">{{ ('status.' + st) | t }}</mat-option> }</mat-select></mat-form-field>
          <button mat-button (click)="evaluate(a)"><mat-icon>refresh</mat-icon> {{ 'actions.evaluate' | t }}</button>
        </div>
      </mat-card-content></mat-card>
    } @empty { <p class="muted">{{ 'actions.none' | t }}</p> }`,
})
export class ActionsPage {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  statuses = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  actions = signal<Action[]>([]);
  constructor() {
    effect(() => {
      const f = this.s.facilityId();
      if (f) void this.load(f);
    });
  }
  async load(fid: string) {
    try { this.actions.set(await this.api.get<Action[]>('/improvement-actions', { facilityId: fid })); } catch (e) { this.notify.error(e); }
  }
  async update(a: Action, status: string) {
    try { await this.api.patch(`/improvement-actions/${a.id}`, { status }); await this.load(this.s.facilityId()!); } catch (e) { this.notify.error(e); }
  }
  async evaluate(a: Action) {
    try { await this.api.post(`/improvement-actions/${a.id}/evaluate`); await this.load(this.s.facilityId()!); } catch (e) { this.notify.error(e); }
  }
}

/** Verification readiness, reviewer approval, evidence reports and buyer sharing. */
@Component({
  selector: 'cb-compliance',
  standalone: true,
  imports: [DatePipe, FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, TPipe, StatusChip, PeriodPicker],
  template: `
    <div class="page-head"><h1>{{ 'compliance.title' | t }}</h1><cb-period-picker /></div>
    <mat-card appearance="outlined"><mat-card-content>
      <h2>{{ 'readiness.title' | t }} @if (readiness(); as r) { <cb-status [value]="r.status" /> }</h2>
      <button mat-stroked-button (click)="check()" [disabled]="busy()"><mat-icon>fact_check</mat-icon> {{ 'readiness.check' | t }}</button>
      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
      @if (readiness(); as r) {
        <ul class="checklist">@for (c of r.checks; track c.id) { <li><mat-icon [class.good]="c.passed">{{ c.passed ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon> <strong>{{ c.label }}</strong> — <span class="muted">{{ c.detail }}</span></li> }</ul>
        @if (r.summary) { <p class="ai-box">{{ r.summary }} <span class="ai-label">{{ 'common.aiGenerated' | t }}</span></p> }
      }
      <p class="notice">{{ 'compliance.disclaimer' | t }}</p>
      <button mat-flat-button (click)="generate()" [disabled]="busy()"><mat-icon>description</mat-icon> {{ 'compliance.generate' | t }}</button>
    </mat-card-content></mat-card>
    @for (r of reports(); track r.id) {
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ r.periodKey }} · v{{ r.version }} <cb-status [value]="r.status" /></h2>
        <p class="small muted">{{ r.createdAt | date: 'medium' }} · {{ 'readiness.title' | t }}: {{ ('status.' + r.readiness.status) | t }}</p>
        @if (r.reviewerComment) { <p><strong>{{ 'review.comment' | t }}:</strong> {{ r.reviewerComment }}</p> }
        <div class="row">
          <button mat-stroked-button (click)="download(r, 'pdf')"><mat-icon>picture_as_pdf</mat-icon> PDF</button>
          <button mat-stroked-button (click)="download(r, 'csv')">CSV</button>
          <button mat-stroked-button (click)="download(r, 'xlsx')">XLSX</button>
        </div>
        @if (r.status === 'DRAFT' && s.role() === 'REVIEWER') {
          <mat-form-field appearance="outline" class="full"><mat-label>{{ 'review.comment' | t }}</mat-label><textarea matInput rows="2" [(ngModel)]="comments[r.id]"></textarea></mat-form-field>
          <div class="row">
            <button mat-flat-button (click)="review(r, 'approve')" [disabled]="!comments[r.id]"><mat-icon>verified</mat-icon> {{ 'review.approve' | t }}</button>
            <button mat-stroked-button (click)="review(r, 'reject')" [disabled]="!comments[r.id]">{{ 'review.rejectReport' | t }}</button>
          </div>
        }
        @if (r.status === 'APPROVED' && s.role() === 'OWNER') {
          <h3>{{ 'share.title' | t }}</h3>
          <div class="row wrap">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ 'share.buyer' | t }}</mat-label><input matInput [(ngModel)]="buyer.name" /></mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ 'auth.email' | t }}</mat-label><input matInput type="email" [(ngModel)]="buyer.email" /></mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ 'share.days' | t }}</mat-label><input matInput type="number" min="1" max="90" [(ngModel)]="buyer.days" /></mat-form-field>
            <button mat-flat-button (click)="share(r)" [disabled]="!buyer.name || !buyer.email"><mat-icon>share</mat-icon> {{ 'share.create' | t }}</button>
          </div>
          @if (newLink()) { <p class="notice">{{ 'share.linkReady' | t }}<br /><code class="break">{{ newLink() }}</code></p> }
          @for (sh of shares()[r.id] || []; track sh.id) {
            <p class="small">{{ sh.buyerName }} ({{ sh.buyerEmail }}) · {{ 'buyer.expires' | t }} {{ sh.expiresAt | date: 'mediumDate' }} · {{ sh.accessLog.length }} {{ 'share.accesses' | t }}
              @if (sh.revokedAt) { · <cb-status value="REVOKED" /> } @else { <button mat-button (click)="revoke(r, sh)">{{ 'share.revoke' | t }}</button> }</p>
            @for (c of sh.clarifications; track c.at) { <p class="small ai-box">{{ c.name }}: {{ c.message }}</p> }
          }
        }
      </mat-card-content></mat-card>
    }`,
})
export class CompliancePage {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  private i18n = inject(I18n);
  readiness = signal<Readiness | null>(null);
  reports = signal<Report[]>([]);
  shares = signal<Record<string, Share[]>>({});
  newLink = signal<string | null>(null);
  busy = signal(false);
  comments: Record<string, string> = {};
  buyer = { name: '', email: '', days: 30 };
  constructor() {
    effect(() => {
      if (this.s.periodId()) void this.load();
    });
  }
  async load() {
    const pid = this.s.periodId()!;
    try {
      const reports = await this.api.get<Report[]>('/reports', { periodId: pid });
      this.reports.set(reports);
      if (this.s.role() === 'OWNER') {
        const map: Record<string, Share[]> = {};
        for (const r of reports.filter((x) => x.status === 'APPROVED')) map[r.id] = await this.api.get<Share[]>(`/reports/${r.id}/shares`);
        this.shares.set(map);
      }
    } catch (e) {
      this.notify.error(e);
    }
  }
  async check() {
    this.busy.set(true);
    try { this.readiness.set(await this.api.get<Readiness>(`/reporting-periods/${this.s.periodId()}/readiness`)); } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
  async generate() {
    this.busy.set(true);
    try { await this.api.post('/reports/generate', { periodId: this.s.periodId() }); this.notify.ok('compliance.generated'); await this.load(); } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
  download(r: Report, f: string) {
    void this.api.download(`/reports/${r.id}/download`, `complybridge-${r.periodKey}-v${r.version}.${f}`, { format: f }).catch((e) => this.notify.error(e));
  }
  async review(r: Report, d: 'approve' | 'reject') {
    try {
      await this.api.post(`/reports/${r.id}/${d}`, { comment: this.comments[r.id] });
      this.notify.ok(d === 'approve' ? 'review.approved' : 'review.rejected');
      await this.load();
      await this.s.loadPeriods();
    } catch (e) {
      this.notify.error(e);
    }
  }
  async share(r: Report) {
    try {
      const sh = await this.api.post<Share>(`/reports/${r.id}/share`, { buyerName: this.buyer.name, buyerEmail: this.buyer.email, expiresInDays: Number(this.buyer.days) });
      this.newLink.set(sh.shareLink ?? null);
      await this.load();
    } catch (e) {
      this.notify.error(e);
    }
  }
  async revoke(r: Report, sh: Share) {
    if (!confirm(this.i18n.t('share.revokeConfirm', { name: sh.buyerName }))) return;
    try { await this.api.post(`/shares/${sh.id}/revoke`); await this.load(); } catch (e) { this.notify.error(e); }
  }
}

