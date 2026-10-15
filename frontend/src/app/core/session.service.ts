import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { AuthService } from './auth.service';
import { I18n } from './i18n.service';
import type { Facility, Lang, Me, Period } from './models';

/** The signed-in user's organization, role and working context (selected facility and period). */
@Injectable({ providedIn: 'root' })
export class Session {
  private api = inject(Api);
  private auth = inject(AuthService);
  private i18n = inject(I18n);

  readonly me = signal<Me | null>(null);
  readonly loading = signal(false);
  readonly role = computed(() => this.me()?.member?.role ?? null);
  readonly org = computed(() => this.me()?.organization ?? null);
  readonly guided = computed(() => !!this.me()?.member?.guidedMode);
  readonly facilities = signal<Facility[]>([]);
  readonly periods = signal<Period[]>([]);
  readonly facilityId = signal<string | null>(null);
  readonly periodId = signal<string | null>(null);
  readonly facility = computed(() => this.facilities().find((f) => f.id === this.facilityId()) ?? null);
  readonly period = computed(() => this.periods().find((p) => p.id === this.periodId()) ?? null);

  constructor() {
    effect(() => {
      const u = this.auth.user();
      if (u) void this.refresh();
      else {
        this.me.set(null);
        this.facilities.set([]);
        this.periods.set([]);
      }
    });
  }

  async refresh() {
    this.loading.set(true);
    try {
      const me = await this.api.get<Me>('/me');
      this.me.set(me);
      if (me.member?.language) await this.i18n.use(me.member.language);
      if (me.organization) await this.loadFacilities();
    } finally {
      this.loading.set(false);
    }
  }

  async loadFacilities() {
    if (this.role() === 'BUYER') return;
    const list = await this.api.get<Facility[]>('/facilities');
    this.facilities.set(list);
    let fid: string | null = null;
    try { fid = localStorage.getItem('cb.facility'); } catch { /* ignore */ }
    const chosen = list.find((f) => f.id === fid) ?? list[0] ?? null;
    await this.selectFacility(chosen?.id ?? null);
  }

  async selectFacility(id: string | null) {
    this.facilityId.set(id);
    try { if (id) localStorage.setItem('cb.facility', id); } catch { /* ignore */ }
    if (!id) {
      this.periods.set([]);
      this.periodId.set(null);
      return;
    }
    await this.loadPeriods();
  }

  async loadPeriods() {
    const id = this.facilityId();
    if (!id) return;
    const list = await this.api.get<Period[]>('/reporting-periods', { facilityId: id });
    this.periods.set(list);
    let pid: string | null = null;
    try { pid = localStorage.getItem('cb.period'); } catch { /* ignore */ }
    const chosen = list.find((p) => p.id === pid) ?? list[list.length - 1] ?? null;
    this.periodId.set(chosen?.id ?? null);
  }

  selectPeriod(id: string) {
    this.periodId.set(id);
    try { localStorage.setItem('cb.period', id); } catch { /* ignore */ }
  }

  async setPreferences(p: { language?: Lang; guidedMode?: boolean }) {
    if (p.language) await this.i18n.use(p.language);
    if (this.me()?.member) {
      await this.api.patch('/me/preferences', p);
      const me = this.me()!;
      this.me.set({ ...me, member: { ...me.member!, ...p } });
    }
  }
}
