import { Component, Injectable, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Api, ApiError } from '../core/api.service';
import { I18n, TPipe } from '../core/i18n.service';
import { Session } from '../core/session.service';

/** User feedback: success and error messages, never raw stack traces. */
@Injectable({ providedIn: 'root' })
export class Notify {
  private bar = inject(MatSnackBar);
  private i18n = inject(I18n);
  ok(key: string, params?: Record<string, string | number>) {
    this.bar.open(this.i18n.t(key, params), '✓', { duration: 3500, politeness: 'polite' });
  }
  error(e: unknown) {
    const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
    this.bar.open(msg, this.i18n.t('common.close'), { duration: 7000, politeness: 'assertive', panelClass: 'snack-error' });
  }
}

/** Status chip with text + icon (never colour alone). */
@Component({
  selector: 'cb-status',
  standalone: true,
  imports: [MatIconModule, TPipe],
  template: `<span class="chip" [class]="'chip ' + tone()" role="status"><mat-icon aria-hidden="true">{{ icon() }}</mat-icon>{{ ('status.' + value()) | t }}</span>`,
})
export class StatusChip {
  readonly value = input.required<string>();
  readonly tone = computed(() => {
    const v = this.value();
    if (['RESOLVED', 'CONFIRMED', 'APPROVED', 'COMPLETE', 'READY_FOR_REVIEW', 'READY_FOR_HUMAN_REVIEW', 'APPROVED_FOR_SHARING', 'SUCCEEDED', 'COMPLETED', 'ACTIVE', 'CLOSED'].includes(v)) return 'good';
    if (['FAILED', 'REJECTED', 'HIGH', 'MISSING_EVIDENCE', 'INCONSISTENT_DATA', 'NEEDS_CORRECTION', 'DECLINED', 'SUSPENDED'].includes(v)) return 'bad';
    if (['PROCESSING', 'QUEUED', 'REVALIDATING', 'SUBMITTED', 'IN_PROGRESS', 'RUNNING'].includes(v)) return 'busy';
    return 'warn';
  });
  readonly icon = computed(() => ({ good: 'check_circle', bad: 'error', busy: 'hourglass_top', warn: 'info' })[this.tone()]);
}

/** Facility + reporting-period selector shared by working pages. */
@Component({
  selector: 'cb-period-picker',
  standalone: true,
  imports: [MatSelectModule, MatFormFieldModule, TPipe],
  template: `
    <div class="picker">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>{{ 'common.facility' | t }}</mat-label>
        <mat-select [value]="s.facilityId()" (valueChange)="s.selectFacility($event)">
          @for (f of s.facilities(); track f.id) { <mat-option [value]="f.id">{{ f.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>{{ 'common.period' | t }}</mat-label>
        <mat-select [value]="s.periodId()" (valueChange)="s.selectPeriod($event)">
          @for (p of s.periods(); track p.id) { <mat-option [value]="p.id">{{ p.key }} · {{ ('status.' + p.status) | t }}</mat-option> }
        </mat-select>
      </mat-form-field>
    </div>`,
})
export class PeriodPicker {
  s = inject(Session);
}

export interface ChartPoint { label: string; value: number | null }

/** Accessible SVG bar chart with an optional data table. */
@Component({
  selector: 'cb-bar-chart',
  standalone: true,
  imports: [DecimalPipe, TPipe],
  template: `
    <figure class="chart">
      <figcaption>{{ title() }} <span class="muted">({{ unit() }})</span></figcaption>
      <svg [attr.viewBox]="'0 0 ' + width + ' 160'" role="img" [attr.aria-label]="title()">
        <line x1="32" y1="130" [attr.x2]="width - 8" y2="130" class="axis" />
        @for (p of points(); track p.label; let i = $index) {
          @if (p.value !== null) {
            <rect [attr.x]="x(i)" [attr.y]="130 - h(p.value)" [attr.width]="barW()" [attr.height]="h(p.value)" rx="3" class="bar" [class.hl]="i === points().length - 1">
              <title>{{ p.label }}: {{ p.value | number: '1.0-3' }} {{ unit() }}</title>
            </rect>
            <text [attr.x]="x(i) + barW() / 2" [attr.y]="124 - h(p.value)" text-anchor="middle" class="val">{{ p.value | number: '1.0-2' }}</text>
          } @else {
            <text [attr.x]="x(i) + barW() / 2" y="124" text-anchor="middle" class="val muted">–</text>
          }
          <text [attr.x]="x(i) + barW() / 2" y="148" text-anchor="middle" class="lbl">{{ p.label }}</text>
        }
      </svg>
      <button class="link" type="button" (click)="showTable.set(!showTable())">{{ (showTable() ? 'chart.hideTable' : 'chart.showTable') | t }}</button>
      @if (showTable()) {
        <table class="data-table"><thead><tr><th>{{ 'common.period' | t }}</th><th>{{ unit() }}</th></tr></thead>
          <tbody>@for (p of points(); track p.label) { <tr><td>{{ p.label }}</td><td>{{ p.value === null ? '–' : (p.value | number: '1.0-4') }}</td></tr> }</tbody></table>
      }
    </figure>`,
})
export class BarChart {
  readonly title = input.required<string>();
  readonly unit = input.required<string>();
  readonly points = input.required<ChartPoint[]>();
  readonly width = 360;
  readonly showTable = signal(false);
  private max = computed(() => Math.max(1e-9, ...this.points().map((p) => p.value ?? 0)));
  barW = computed(() => Math.max(12, (this.width - 48) / Math.max(1, this.points().length) - 10));
  x(i: number) {
    return 36 + i * (this.barW() + 10);
  }
  h(v: number) {
    return Math.max(2, (v / this.max()) * 100);
  }
}

/** Read-aloud button (Cloud Text-to-Speech through the API). */
@Component({
  selector: 'cb-speak',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, TPipe],
  template: `<button mat-icon-button type="button" (click)="play()" [disabled]="busy()" [matTooltip]="'voice.readAloud' | t" [attr.aria-label]="'voice.readAloud' | t"><mat-icon>volume_up</mat-icon></button>`,
})
export class SpeakButton {
  readonly text = input.required<string>();
  private api = inject(Api);
  private i18n = inject(I18n);
  private notify = inject(Notify);
  busy = signal(false);
  async play() {
    this.busy.set(true);
    try {
      const r = await this.api.post<{ audioBase64: string; mimeType: string }>('/assistant/speak', { text: this.text(), language: this.i18n.lang() });
      await new Audio(`data:${r.mimeType};base64,${r.audioBase64}`).play();
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
