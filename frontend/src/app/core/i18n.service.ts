import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import type { Lang } from './models';

export const UI_LANGUAGES: { code: Lang; label: string; available: boolean }[] = [
  { code: 'en', label: 'English', available: true },
  { code: 'ta', label: 'தமிழ் (Tamil)', available: true },
  { code: 'fr', label: 'Français (French)', available: true },
  { code: 'si', label: 'සිංහල (Sinhala) - coming soon', available: false },
  { code: 'hi', label: 'हिन्दी (Hindi) - planned', available: false },
  { code: 'id', label: 'Bahasa Indonesia - planned', available: false },
  { code: 'vi', label: 'Tiếng Việt - planned', available: false },
  { code: 'th', label: 'ไทย (Thai) - planned', available: false },
  { code: 'ms', label: 'Bahasa Melayu - planned', available: false },
];

/**
 * Runtime translation catalogs (public/i18n/{lang}.json). Switching language re-renders text only;
 * component and form state is untouched, so nothing typed is lost.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>('en');
  private catalogs = signal<Record<string, Record<string, string>>>({});

  constructor() {
    let saved: Lang | null = null;
    try { saved = localStorage.getItem('cb.lang') as Lang | null; } catch { /* storage unavailable */ }
    void this.use(saved && UI_LANGUAGES.some((l) => l.code === saved && l.available) ? saved : 'en');
  }

  async use(lang: Lang) {
    const target = UI_LANGUAGES.find((l) => l.code === lang && l.available) ? lang : 'en';
    await Promise.all([this.load('en'), this.load(target)]);
    this.lang.set(target);
    document.documentElement.lang = target;
    try { localStorage.setItem('cb.lang', target); } catch { /* ignore */ }
  }

  private async load(lang: string) {
    if (this.catalogs()[lang]) return;
    try {
      const res = await fetch(`i18n/${lang}.json`);
      const data = (await res.json()) as Record<string, string>;
      this.catalogs.update((c) => ({ ...c, [lang]: data }));
    } catch {
      this.catalogs.update((c) => ({ ...c, [lang]: {} }));
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    const c = this.catalogs();
    let s = c[this.lang()]?.[key] ?? c['en']?.[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }
}

@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private i18n = inject(I18n);
  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
