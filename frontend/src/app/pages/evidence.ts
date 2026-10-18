import { Component, Injectable, OnDestroy, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Api } from '../core/api.service';
import { I18n, TPipe } from '../core/i18n.service';
import { Session } from '../core/session.service';
import type { DocumentRecord, Extraction, Issue, Member, MeasurementType, Task } from '../core/models';
import { Notify, DialogService, PeriodPicker, SpeakButton, StatusChip } from '../shared/ui';

const DOC_TYPES = ['ELECTRICITY_BILL', 'FUEL_RECEIPT', 'PRODUCTION_RECORD', 'METER_READING', 'OTHER'];
const ACCEPT = 'application/pdf,image/jpeg,image/png,.csv,.xlsx';

/** Upload + background-processing status polling, shared by all upload screens. */
@Injectable({ providedIn: 'root' })
export class Uploader {
  private api = inject(Api);
  async upload(periodId: string, file: File, declaredType?: string, relatedTaskId?: string): Promise<DocumentRecord> {
    const fd = new FormData();
    fd.append('periodId', periodId);
    if (declaredType) fd.append('declaredType', declaredType);
    if (relatedTaskId) fd.append('relatedTaskId', relatedTaskId);
    fd.append('file', file, file.name);
    return this.api.upload<DocumentRecord>('/documents', fd);
  }
  /** Polls until the background job finishes (honest status: queued, processing, ready or failed). */
  async waitForProcessing(id: string, onUpdate?: (d: DocumentRecord) => void): Promise<DocumentRecord> {
    for (let i = 0; i < 90; i++) {
      const d = await this.api.get<DocumentRecord>(`/documents/${id}`);
      onUpdate?.(d);
      if (!['QUEUED', 'PROCESSING'].includes(d.status)) return d;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Processing is taking longer than expected. Check the document list later.');
  }
}

@Component({
  selector: 'cb-documents',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatIconModule, MatProgressBarModule, TPipe, StatusChip, PeriodPicker],
  template: `
    <div class="page-head"><h1>{{ 'documents.title' | t }}</h1><cb-period-picker /></div>
    @if (s.period(); as p) {
      @if (s.role() !== 'REVIEWER') {
        <mat-card appearance="outlined"><mat-card-content>
          <h2>{{ 'documents.upload' | t }}</h2>
          <div class="row wrap">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ 'documents.type' | t }}</mat-label>
              <mat-select [(ngModel)]="declaredType"><mat-option value="">{{ 'documents.autoDetect' | t }}</mat-option>@for (t of types; track t) { <mat-option [value]="t">{{ ('docType.' + t) | t }}</mat-option> }</mat-select></mat-form-field>
            <label class="dropzone" [class.drag]="drag()" (dragover)="$event.preventDefault(); drag.set(true)" (dragleave)="drag.set(false)" (drop)="drop($event)">
              <mat-icon aria-hidden="true">cloud_upload</mat-icon>
              <span>{{ 'documents.dropHint' | t }}</span>
              <input type="file" [accept]="accept" (change)="pick($event)" class="visually-hidden" />
            </label>
          </div>
          @if (uploading()) { <mat-progress-bar mode="indeterminate" /><p class="small" role="status">{{ progressText() }}</p> }
          <p class="muted small">{{ 'documents.formats' | t }}</p>
        </mat-card-content></mat-card>
      }
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'documents.list' | t: { period: p.key } }}</h2>
        <table class="data-table"><thead><tr><th>{{ 'documents.file' | t }}</th><th>{{ 'documents.uploaded' | t }}</th><th>{{ 'common.status' | t }}</th><th></th></tr></thead>
          <tbody>@for (d of docs(); track d.id) {
            <tr><td>{{ d.fileName }}@if (d.error) { <br /><span class="small error-text">{{ d.error }}</span> }</td><td class="nowrap">{{ d.uploadedAt | date: 'short' }}</td><td><cb-status [value]="d.status" /></td>
              <td>@if (d.extractionId) { <a mat-button [routerLink]="['/documents', d.id]">{{ (d.status === 'NEEDS_REVIEW' ? 'documents.review' : 'documents.view') | t }}</a> }
                  @if (d.status === 'FAILED') { <button mat-button (click)="retry(d)">{{ 'documents.retry' | t }}</button> }</td></tr>
          } @empty { <tr><td colspan="4" class="muted">{{ 'documents.none' | t }}</td></tr> }</tbody></table>
      </mat-card-content></mat-card>
    } @else { <p class="muted">{{ 'documents.choosePeriod' | t }}</p> }`,
})
export class DocumentsPage implements OnDestroy {
  s = inject(Session);
  private api = inject(Api);
  private uploader = inject(Uploader);
  private notify = inject(Notify);
  private i18n = inject(I18n);
  private router = inject(Router);
  types = DOC_TYPES;
  accept = ACCEPT;
  declaredType = '';
  docs = signal<DocumentRecord[]>([]);
  uploading = signal(false);
  progressText = signal('');
  drag = signal(false);
  private timer = setInterval(() => this.hasPending() && void this.load(), 4000);
  private hasPending = computed(() => this.docs().some((d) => d.status === 'QUEUED' || d.status === 'PROCESSING'));
  constructor() {
    effect(() => {
      if (this.s.periodId()) void this.load();
    });
  }
  ngOnDestroy() {
    clearInterval(this.timer);
  }
  async load() {
    const pid = this.s.periodId();
    if (!pid) return;
    try { this.docs.set(await this.api.get<DocumentRecord[]>(`/reporting-periods/${pid}/documents`)); } catch (e) { this.notify.error(e); }
  }
  pick(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) void this.send(f);
    (ev.target as HTMLInputElement).value = '';
  }
  drop(ev: DragEvent) {
    ev.preventDefault();
    this.drag.set(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) void this.send(f);
  }
  async send(file: File) {
    const pid = this.s.periodId();
    if (!pid) return;
    this.uploading.set(true);
    this.progressText.set(this.i18n.t('documents.uploading'));
    try {
      const d = await this.uploader.upload(pid, file, this.declaredType || undefined);
      await this.load();
      this.progressText.set(this.i18n.t('documents.processing'));
      const done = await this.uploader.waitForProcessing(d.id, () => void this.load());
      await this.load();
      if (done.status === 'NEEDS_REVIEW') await this.router.navigate(['/documents', done.id]);
      else if (done.status === 'FAILED') this.notify.error(new Error(done.error ?? 'Processing failed'));
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.uploading.set(false);
    }
  }
  async retry(d: DocumentRecord) {
    try { await this.api.post(`/documents/${d.id}/process`); await this.load(); } catch (e) { this.notify.error(e); }
  }
}

interface EditItem { index: number; include: boolean; measurementType: MeasurementType; reportingMonth: string; quantity: number | null; unit: string; fuelType: string | null; confidence: string; sourceSnippet: string | null; aiQuantity: number | null }

/** Side-by-side human review of AI-extracted values. Only confirmed values become measurements. */
@Component({
  selector: 'cb-review-extraction',
  standalone: true,
  imports: [FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatIconModule, TPipe, StatusChip],
  template: `
    <div class="page-head"><h1>{{ 'review.extractionTitle' | t }}</h1></div>
    @if (doc(); as d) {
      <div class="split">
        <section class="preview" [attr.aria-label]="'review.original' | t">
          <h2>{{ 'review.original' | t }} · {{ d.fileName }}</h2>
          @if (previewUrl()) {
            @if (d.contentType.startsWith('image/')) { <img [src]="previewUrl()" [alt]="d.fileName" /> }
            @else if (d.contentType === 'application/pdf') { <iframe [src]="previewUrl()" [title]="d.fileName"></iframe> }
            @else { <p class="muted">{{ 'review.noPreview' | t }}</p> }
          }
        </section>
        <section [attr.aria-label]="'review.extracted' | t">
          @if (ext(); as e) {
            <h2>{{ 'review.extracted' | t }} <cb-status [value]="e.status" /></h2>
            <p class="small muted">{{ ('docType.' + e.documentType) | t }} · {{ e.supplierName ?? '–' }} · {{ e.invoiceNumber ?? '–' }} · {{ 'review.engine' | t }}: {{ e.engine }}</p>
            @for (w of e.warnings; track w) { <p class="notice warn"><mat-icon aria-hidden="true">warning</mat-icon> {{ w }}</p> }
            @for (it of items; track it.index) {
              <mat-card appearance="outlined" class="item-card" [class.low]="it.confidence === 'low'"><mat-card-content>
                <div class="row item-head">
                  <mat-checkbox [(ngModel)]="it.include">{{ 'review.include' | t }}</mat-checkbox>
                  <span class="chip" [class]="'chip conf-' + it.confidence">{{ ('confidence.' + it.confidence) | t }}</span>
                </div>
                <div class="form-grid">
                  <mat-form-field appearance="outline"><mat-label>{{ 'review.type' | t }}</mat-label>
                    <mat-select [(ngModel)]="it.measurementType" (ngModelChange)="onTypeChange(it)">@for (t of mtypes; track t) { <mat-option [value]="t">{{ ('mtype.' + t) | t }}</mat-option> }</mat-select></mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>{{ 'review.month' | t }}</mat-label><input matInput type="month" [(ngModel)]="it.reportingMonth" /></mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>{{ 'review.quantity' | t }}</mat-label><input matInput type="number" [(ngModel)]="it.quantity" />
                    @if (it.aiQuantity !== it.quantity) { <mat-hint>{{ 'review.aiRead' | t }}: {{ it.aiQuantity ?? '–' }}</mat-hint> }</mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>{{ 'review.unit' | t }}</mat-label>
                    <mat-select [(ngModel)]="it.unit">@for (u of unitsFor(it.measurementType); track u) { <mat-option [value]="u">{{ u }}</mat-option> }</mat-select></mat-form-field>
                  @if (it.measurementType === 'FUEL') {
                    <mat-form-field appearance="outline" class="span2"><mat-label>{{ 'review.fuelType' | t }}</mat-label><input matInput [(ngModel)]="it.fuelType" placeholder="diesel" /></mat-form-field>
                  }
                </div>
                @if (it.sourceSnippet) { <p class="small source"><mat-icon aria-hidden="true">format_quote</mat-icon> {{ it.sourceSnippet }}</p> }
              </mat-card-content></mat-card>
            }
            @if (e.status === 'NEEDS_REVIEW' && s.role() !== 'BUYER') {
              <div class="row">
                <button mat-flat-button (click)="confirm()" [disabled]="busy()"><mat-icon>check</mat-icon> {{ 'review.confirm' | t }}</button>
                <button mat-stroked-button (click)="reject()" [disabled]="busy()"><mat-icon>close</mat-icon> {{ 'review.reject' | t }}</button>
              </div>
              <p class="muted small">{{ 'review.humanCheck' | t }}</p>
            }
            @if (result()) { <p class="notice" role="status">{{ result() }}</p> }
          }
        </section>
      </div>
    }`,
})
export class ReviewExtractionPage implements OnInit, OnDestroy {
  readonly id = input.required<string>();
  s = inject(Session);
  private api = inject(Api);
  private sanitizer = inject(DomSanitizer);
  private notify = inject(Notify);
  private i18n = inject(I18n);
  private router = inject(Router);
  private dialogs = inject(DialogService);
  mtypes: MeasurementType[] = ['ELECTRICITY', 'FUEL', 'PRODUCTION'];
  doc = signal<DocumentRecord & { contentType: string } | null>(null);
  ext = signal<Extraction | null>(null);
  previewUrl = signal<SafeResourceUrl | null>(null);
  private objectUrl: string | null = null;
  items: EditItem[] = [];
  busy = signal(false);
  result = signal<string | null>(null);

  onTypeChange(it: EditItem) {
    const valid = this.unitsFor(it.measurementType);
    if (!valid.includes(it.unit)) {
      it.unit = valid[0];
    }
    if (it.measurementType === 'FUEL' && !it.fuelType) {
      it.fuelType = 'diesel';
    } else if (it.measurementType !== 'FUEL') {
      it.fuelType = null;
    }
  }

  async ngOnInit() {
    try {
      const d = await this.api.get<DocumentRecord & { contentType: string }>(`/documents/${this.id()}`);
      this.doc.set(d);
      const blob = await this.api.blob(`/documents/${d.id}/file`);
      this.objectUrl = URL.createObjectURL(blob);
      this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
      if (d.extractionId) {
        const e = await this.api.get<Extraction>(`/extractions/${d.extractionId}`);
        this.ext.set(e);
        this.items = e.items.map((it, index) => ({
          index, include: it.quantity !== null, measurementType: it.measurementType, reportingMonth: it.reportingMonth ?? '',
          quantity: it.quantity, unit: it.unit ?? this.unitsFor(it.measurementType)[0], fuelType: it.fuelType, confidence: it.confidence,
          sourceSnippet: it.sourceSnippet, aiQuantity: it.quantity,
        }));
      }
    } catch (e) {
      this.notify.error(e);
    }
  }
  ngOnDestroy() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
  unitsFor(t: MeasurementType) {
    return t === 'ELECTRICITY' ? ['kWh', 'MWh'] : t === 'FUEL' ? ['L', 'kg', 't'] : ['t', 'kg'];
  }
  async confirm() {
    this.busy.set(true);
    try {
      const included = this.items.filter((i) => i.include);
      if (included.some((i) => i.quantity === null || !i.reportingMonth)) throw new Error(this.i18n.t('review.fillAll'));
      const payload = included.map((i) => ({ index: i.index, include: true, measurementType: i.measurementType, reportingMonth: i.reportingMonth, quantity: Number(i.quantity), unit: i.unit, fuelType: i.fuelType }));
      const r = await this.api.post<{ analysis: { resolvedIssues: string[]; openIssues: number; calculationId: string | null } }>(`/extractions/${this.ext()!.id}/confirm`, { items: payload });
      this.result.set(this.i18n.t('review.confirmed', { resolved: r.analysis.resolvedIssues.length, open: r.analysis.openIssues }));
      this.notify.ok('review.saved');
      await this.ngOnInit();
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  async reject() {
    const reason = await this.dialogs.prompt({
      title: this.i18n.t('review.reject'),
      message: this.i18n.t('review.rejectReason'),
      required: true,
    });
    if (!reason) return;
    try {
      await this.api.post(`/extractions/${this.ext()!.id}/reject`, { reason });
      await this.router.navigateByUrl('/documents');
    } catch (e) {
      this.notify.error(e);
    }
  }
}

interface AgentRun { id: string; status: string; startedAt: string; finalMessage: string | null; toolActions: { tool: string; ok: boolean }[]; model: string }

@Component({
  selector: 'cb-carbonops',
  standalone: true,
  imports: [DatePipe, FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressBarModule, TPipe, StatusChip, PeriodPicker],
  template: `
    <div class="page-head"><h1>{{ 'carbonops.title' | t }}</h1><cb-period-picker /></div>
    <p class="muted">{{ 'carbonops.intro' | t }}</p>
    <div class="row">
      <button mat-stroked-button (click)="analyze()" [disabled]="busy() || !s.periodId()"><mat-icon>rule</mat-icon> {{ 'carbonops.analyze' | t }}</button>
      @if (s.role() === 'OWNER' || s.role() === 'REVIEWER') { <button mat-flat-button (click)="runAgent()" [disabled]="busy() || !s.periodId()"><mat-icon>smart_toy</mat-icon> {{ 'carbonops.run' | t }}</button> }
    </div>
    @if (!s.periodId()) {
      <p class="notice warn"><mat-icon aria-hidden="true">info</mat-icon> {{ 'documents.choosePeriod' | t }}</p>
    }
    @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
    <div class="two-col">
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'carbonops.issues' | t }}</h2>
        @for (i of issues(); track i.id) {
          <div class="issue" [class]="'issue sev-' + i.severity">
            <cb-status [value]="i.severity" /> <cb-status [value]="i.status" />
            <p>{{ i.title }}</p>
            @if (i.details['aiExplanation']) { <p class="ai-box small">{{ i.details['aiExplanation'] }} <span class="ai-label">{{ 'common.aiGenerated' | t }}</span></p> }
          </div>
        } @empty { <p class="muted">{{ 'carbonops.noIssues' | t }}</p> }
      </mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content>
        <h2>{{ 'carbonops.tasks' | t }}</h2>
        @for (t of tasks(); track t.id) {
          <div class="task-card">
            <p><strong>{{ t.title }}</strong> <cb-status [value]="t.status" /> @if (t.approvalState === 'PENDING_APPROVAL') { <cb-status value="PENDING_APPROVAL" /> }</p>
            <p class="small">{{ t.messageEnglish }}</p>
            @if (t.messageLocalized) { <p class="small">{{ t.messageLocalized }} @if (t.machineTranslated) { <span class="ai-label">{{ 'common.machineTranslated' | t }}</span> }</p> }
            <p class="small muted">{{ 'carbonops.assignee' | t }}: {{ memberName(t.assigneeUid) }}</p>
            @if (t.approvalState === 'PENDING_APPROVAL' && s.role() === 'OWNER') {
              <mat-form-field appearance="outline" class="full" subscriptSizing="dynamic"><mat-label>{{ 'carbonops.editMessage' | t }}</mat-label><textarea matInput rows="2" [(ngModel)]="edits[t.id]"></textarea></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>{{ 'carbonops.assignee' | t }}</mat-label>
                <mat-select [(ngModel)]="assignees[t.id]">@for (m of assignable(); track m.uid) { <mat-option [value]="m.uid">{{ m.displayName }} ({{ ('role.' + m.role) | t }})</mat-option> }</mat-select></mat-form-field>
              <div class="row">
                <button mat-flat-button (click)="approve(t)"><mat-icon>send</mat-icon> {{ 'carbonops.approve' | t }}</button>
                <button mat-button (click)="decline(t)">{{ 'carbonops.decline' | t }}</button>
              </div>
            }
            <details><summary class="small">{{ 'carbonops.history' | t }}</summary>
              @for (h of t.history; track h.at + h.to) { <p class="small">{{ h.at | date: 'short' }} · {{ h.from ?? '–' }} → {{ h.to }} · {{ h.note }}</p> }
            </details>
          </div>
        } @empty { <p class="muted">{{ 'carbonops.noTasks' | t }}</p> }
      </mat-card-content></mat-card>
    </div>
    <mat-card appearance="outlined"><mat-card-content>
      <h2>{{ 'carbonops.runs' | t }}</h2>
      @for (r of runs(); track r.id) {
        <p class="small"><cb-status [value]="r.status" /> {{ r.startedAt | date: 'short' }} · {{ r.model }} · {{ r.toolActions.length }} {{ 'carbonops.toolCalls' | t }}</p>
        <p class="small muted">{{ toolList(r) }}</p>
        @if (r.finalMessage) { <p class="ai-box small">{{ r.finalMessage }}</p> }
      } @empty { <p class="muted small">{{ 'carbonops.noRuns' | t }}</p> }
    </mat-card-content></mat-card>`,
})
export class CarbonOpsPage {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  private i18n = inject(I18n);
  private dialogs = inject(DialogService);
  issues = signal<Issue[]>([]);
  tasks = signal<Task[]>([]);
  runs = signal<AgentRun[]>([]);
  members = signal<Member[]>([]);
  assignable = computed(() => this.members().filter((m) => m.status === 'ACTIVE' && (m.role === 'WORKER' || m.role === 'OWNER')));
  busy = signal(false);
  edits: Record<string, string> = {};
  assignees: Record<string, string> = {};
  constructor() {
    effect(() => {
      if (this.s.periodId()) void this.load();
    });
  }
  async load() {
    const pid = this.s.periodId()!;
    try {
      const [i, t, r, m] = await Promise.all([
        this.api.get<Issue[]>('/issues', { periodId: pid }),
        this.api.get<Task[]>('/tasks', { periodId: pid }),
        this.api.get<AgentRun[]>(`/reporting-periods/${pid}/agent-runs`),
        this.api.get<Member[]>('/members').catch(() => [] as Member[]),
      ]);
      this.issues.set(i.filter((x) => x.status === 'OPEN').concat(i.filter((x) => x.status !== 'OPEN')));
      this.tasks.set(t);
      this.runs.set(r);
      this.members.set(m);
      for (const task of t) {
        this.edits[task.id] ??= task.messageEnglish;
        this.assignees[task.id] ??= task.assigneeUid ?? '';
      }
    } catch (e) {
      this.notify.error(e);
    }
  }
  memberName(uid: string | null) {
    return this.members().find((m) => m.uid === uid)?.displayName ?? uid ?? '–';
  }
  toolList(r: AgentRun) {
    return r.toolActions.map((a) => `${a.ok ? '✓' : '✗'} ${a.tool}`).join(' · ');
  }
  async analyze() {
    if (!this.s.periodId()) return;
    this.busy.set(true);
    try { await this.api.post(`/reporting-periods/${this.s.periodId()}/analyze`); await this.load(); await this.s.loadPeriods(); } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
  async runAgent() {
    if (!this.s.periodId()) return;
    this.busy.set(true);
    try {
      await this.api.post('/carbonops/run', { periodId: this.s.periodId() });
      this.notify.ok('carbonops.ran');
      await this.load();
    } catch (e) {
      this.notify.error(e);
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }
  async approve(t: Task) {
    try {
      const body: Record<string, string> = {};
      if (this.edits[t.id] && this.edits[t.id] !== t.messageEnglish) body['messageEnglish'] = this.edits[t.id];
      if (this.assignees[t.id] && this.assignees[t.id] !== t.assigneeUid) body['assigneeUid'] = this.assignees[t.id];
      await this.api.post(`/tasks/${t.id}/approve`, body);
      this.notify.ok('carbonops.sent');
      await this.load();
    } catch (e) {
      this.notify.error(e);
    }
  }
  async decline(t: Task) {
    const reason = await this.dialogs.prompt({
      title: this.i18n.t('carbonops.decline'),
      message: this.i18n.t('carbonops.declineReason'),
      required: true,
    });
    if (!reason) return;
    try { await this.api.post(`/tasks/${t.id}/decline`, { reason }); await this.load(); } catch (e) { this.notify.error(e); }
  }
}

@Component({
  selector: 'cb-tasks',
  standalone: true,
  imports: [DatePipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, TPipe, StatusChip, SpeakButton],
  template: `
    <div class="page-head"><h1>{{ 'tasks.title' | t }}</h1></div>
    @for (t of tasks(); track t.id) {
      <mat-card appearance="outlined" class="task-card"><mat-card-content>
        <p><strong>{{ t.title }}</strong> <cb-status [value]="t.status" /></p>
        <p>{{ t.messageLocalized ?? t.messageEnglish }} <cb-speak [text]="t.messageLocalized ?? t.messageEnglish" />
          @if (t.machineTranslated) { <span class="ai-label">{{ 'common.machineTranslated' | t }}</span> }</p>
        <p class="small muted">{{ t.updatedAt | date: 'short' }}</p>
        @if (!['RESOLVED', 'REJECTED'].includes(t.status)) { <a mat-flat-button [routerLink]="['/tasks', t.id]"><mat-icon>photo_camera</mat-icon> {{ 'tasks.respond' | t }}</a> }
      </mat-card-content></mat-card>
    } @empty { <p class="muted">{{ 'tasks.none' | t }}</p> }`,
})
export class TasksPage implements OnInit {
  private api = inject(Api);
  private notify = inject(Notify);
  tasks = signal<Task[]>([]);
  async ngOnInit() {
    try { this.tasks.set(await this.api.get<Task[]>('/tasks', { mine: 'true' })); } catch (e) { this.notify.error(e); }
  }
}

/** Respond to a task: photo/file upload linked to the task, then confirm values. */
@Component({
  selector: 'cb-task-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, TPipe, StatusChip, SpeakButton],
  template: `
    @if (task(); as t) {
      <div class="page-head"><h1>{{ t.title }}</h1><cb-status [value]="t.status" /></div>
      <mat-card appearance="outlined" class="big-card"><mat-card-content>
        <p class="lead">{{ t.messageLocalized ?? t.messageEnglish }} <cb-speak [text]="t.messageLocalized ?? t.messageEnglish" /></p>
        @if (t.machineTranslated) { <p class="small muted">{{ 'common.machineTranslated' | t }} · {{ t.messageEnglish }}</p> }
        @if (!['RESOLVED', 'REJECTED'].includes(t.status)) {
          <label class="big-button"><mat-icon aria-hidden="true">photo_camera</mat-icon> {{ 'guided.takePhoto' | t }}
            <input type="file" accept="image/*,application/pdf,.csv,.xlsx" capture="environment" (change)="pick($event)" class="visually-hidden" /></label>
          @if (busy()) { <mat-progress-bar mode="indeterminate" /><p role="status">{{ status() }}</p> }
          <mat-form-field appearance="outline" class="full"><mat-label>{{ 'tasks.note' | t }}</mat-label><textarea matInput rows="2" [(ngModel)]="note"></textarea></mat-form-field>
          <button mat-stroked-button (click)="sendNote()" [disabled]="!note">{{ 'tasks.sendNote' | t }}</button>
        } @else { <p class="notice"><mat-icon>check_circle</mat-icon> {{ 'tasks.done' | t }}</p> }
      </mat-card-content></mat-card>
      <a mat-button routerLink="/tasks"><mat-icon>arrow_back</mat-icon> {{ 'common.back' | t }}</a>
    }`,
})
export class TaskDetailPage implements OnInit {
  readonly id = input.required<string>();
  private api = inject(Api);
  private uploader = inject(Uploader);
  private notify = inject(Notify);
  private router = inject(Router);
  private i18n = inject(I18n);
  task = signal<Task | null>(null);
  busy = signal(false);
  status = signal('');
  note = '';
  async ngOnInit() {
    try { this.task.set(await this.api.get<Task>(`/tasks/${this.id()}`)); } catch (e) { this.notify.error(e); }
  }
  async pick(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    const t = this.task();
    if (!f || !t) return;
    this.busy.set(true);
    try {
      this.status.set(this.i18n.t('documents.uploading'));
      const d = await this.uploader.upload(t.periodId, f, undefined, t.id);
      this.status.set(this.i18n.t('documents.processing'));
      const done = await this.uploader.waitForProcessing(d.id);
      if (done.status === 'NEEDS_REVIEW') await this.router.navigate(['/documents', done.id]);
      else this.notify.error(new Error(done.error ?? 'Processing failed'));
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  async sendNote() {
    try {
      this.task.set(await this.api.post<Task>(`/tasks/${this.id()}/respond`, { note: this.note }));
      this.note = '';
      this.notify.ok('common.saved');
    } catch (e) {
      this.notify.error(e);
    }
  }
}

/** Guided low-literacy worker mode: one task per screen, big buttons, read-aloud, visual progress. */
@Component({
  selector: 'cb-guided',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, TPipe, SpeakButton],
  template: `
    <section class="guided-home">
      <h1>{{ 'guided.hello' | t: { name: s.me()?.member?.displayName ?? '' } }} <cb-speak [text]="('guided.hello' | t: { name: s.me()?.member?.displayName ?? '' }) + '. ' + ('guided.youHave' | t: { n: open().length })" /></h1>
      <p class="lead">{{ 'guided.youHave' | t: { n: open().length } }}</p>
      <div class="progress-steps" role="progressbar" [attr.aria-valuenow]="done()" [attr.aria-valuemax]="tasks().length">
        <mat-progress-bar mode="determinate" [value]="tasks().length ? (done() / tasks().length) * 100 : 0" />
        <p>{{ 'guided.progress' | t: { done: done(), total: tasks().length } }}</p>
      </div>
      @if (open()[0]; as t) {
        <div class="guided-card">
          <mat-icon class="huge" aria-hidden="true">receipt_long</mat-icon>
          <h2>{{ t.messageLocalized ?? t.messageEnglish }}</h2>
          <cb-speak [text]="t.messageLocalized ?? t.messageEnglish" />
          <a mat-flat-button class="big-button" [routerLink]="['/tasks', t.id]"><mat-icon>photo_camera</mat-icon> {{ 'guided.takePhoto' | t }}</a>
        </div>
      } @else {
        <div class="guided-card"><mat-icon class="huge good" aria-hidden="true">task_alt</mat-icon><h2>{{ 'guided.allDone' | t }}</h2></div>
      }
      <p class="muted">{{ 'guided.help' | t }}</p>
    </section>`,
})
export class GuidedPage implements OnInit {
  s = inject(Session);
  private api = inject(Api);
  private notify = inject(Notify);
  tasks = signal<Task[]>([]);
  open = computed(() => this.tasks().filter((t) => !['RESOLVED', 'REJECTED'].includes(t.status)));
  done = computed(() => this.tasks().length - this.open().length);
  async ngOnInit() {
    try { this.tasks.set(await this.api.get<Task[]>('/tasks', { mine: 'true' })); } catch (e) { this.notify.error(e); }
  }
}
