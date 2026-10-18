import { Component, OnInit, inject, input, signal, computed } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { I18n, TPipe, UI_LANGUAGES } from '../core/i18n.service';
import { Session } from '../core/session.service';
import { Notify, StatusChip } from '../shared/ui';
import type { Lang } from '../core/models';

const LangSwitch = () => {
  return { languages: UI_LANGUAGES.filter((l) => l.available) };
};

@Component({
  selector: 'cb-landing',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatCardModule, MatMenuModule, TPipe],
  template: ` <header class="public-top">
      <a routerLink="/" class="brand" aria-label="Ecuraa"><img src="/logo.png" alt="Ecuraa" class="brand-logo" /></a>
      <span class="spacer"></span>
      <button mat-button [matMenuTriggerFor]="langMenu" class="lang-dropdown-btn" [attr.aria-label]="'common.language' | t">
        <mat-icon class="lang-icon">translate</mat-icon>
        <span>{{ currentLangLabel() }}</span>
        <mat-icon class="dropdown-arrow">arrow_drop_down</mat-icon>
      </button>
      <mat-menu #langMenu="matMenu">
        @for (l of languages; track l.code) {
          <button mat-menu-item (click)="i18n.use(l.code)" [class.active-lang]="i18n.lang() === l.code">
            <span>{{ l.label }}</span>
            @if (i18n.lang() === l.code) {
              <mat-icon class="active-check">check</mat-icon>
            }
          </button>
        }
      </mat-menu>
      <a mat-button routerLink="/login">{{ 'auth.login' | t }}</a>
      <a mat-flat-button routerLink="/register">{{ 'auth.getStarted' | t }}</a>
    </header>
    <main class="landing" id="main">
      <section class="hero">
        <h1>{{ 'landing.tagline' | t }}</h1>
        <p class="lead">{{ 'landing.lead' | t }}</p>
        <div class="hero-actions">
          <a mat-flat-button routerLink="/register" class="big">{{ 'auth.getStarted' | t }}</a>
        </div>
        <p class="muted small hero-disclaimer">{{ 'landing.disclaimer' | t }}</p>
        <div class="hero-banner-wrap">
          <img src="/banner.png" alt="Ecuraa - From Everyday Bills To Carbon Intelligence: Capture, Calculate, Comply, Improve" class="hero-banner-img" />
        </div>
      </section>
      <section class="grid3" aria-label="Features">
        @for (f of features; track f.key) {
          <mat-card appearance="outlined"
            ><mat-card-content>
              <mat-icon class="feature-icon" aria-hidden="true">{{ f.icon }}</mat-icon>
              <h2>{{ (f.key + '.title') | t }}</h2>
              <p>{{ (f.key + '.body') | t }}</p>
            </mat-card-content></mat-card
          >
        }
      </section>
      <section aria-labelledby="pricing">
        <h2 id="pricing">{{ 'landing.pricing' | t }}</h2>
        <div class="grid4">
          @for (p of plans; track p.name) {
            <mat-card appearance="outlined"
              ><mat-card-content
                ><h3>{{ p.name }}</h3>
                <p class="price">{{ p.price }}</p>
                <p class="small">{{ p.key | t }}</p></mat-card-content
              ></mat-card
            >
          }
        </div>
        <p class="muted small">{{ 'landing.pricingNote' | t }}</p>
      </section>
    </main>`,
})
export class Landing {
  i18n = inject(I18n);
  languages = UI_LANGUAGES.filter((l) => l.available);
  currentLangLabel = computed(() => this.languages.find((l) => l.code === this.i18n.lang())?.label.split(' ')[0] ?? 'English');
  features = [
    { key: 'landing.f1', icon: 'photo_camera' },
    { key: 'landing.f2', icon: 'smart_toy' },
    { key: 'landing.f3', icon: 'tune' },
    { key: 'landing.f4', icon: 'translate' },
    { key: 'landing.f5', icon: 'calculate' },
    { key: 'landing.f6', icon: 'verified' },
  ];
  plans = [
    { name: 'Free Trial', price: '$0', key: 'plan.trial' },
    { name: 'Starter', price: '$59/mo*', key: 'plan.starter' },
    { name: 'Growth', price: '$179/mo*', key: 'plan.growth' },
    { name: 'Business', price: '$449/mo*', key: 'plan.business' },
  ];
}

@Component({
  selector: 'cb-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    TPipe,
  ],
  template: ` <main class="auth-page" id="main">
    <mat-card appearance="outlined" class="auth-card"
      ><mat-card-content>
        <div class="auth-logo-wrap"><a routerLink="/" aria-label="Ecuraa"><img src="/logo.png" alt="Ecuraa" class="auth-logo" /></a></div>
        <h1>{{ 'auth.login' | t }}</h1>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'auth.email' | t }}</mat-label
            ><input matInput type="email" formControlName="email" autocomplete="email" required />
            @if (form.controls.email.hasError('required') && form.controls.email.touched) {
              <mat-error>{{ 'validation.required' | t }}</mat-error>
            }
            @if (form.controls.email.hasError('email') && form.controls.email.touched) {
              <mat-error>{{ 'validation.email' | t }}</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'auth.password' | t }}</mat-label
            ><input
              matInput
              [type]="hidePassword() ? 'password' : 'text'"
              formControlName="password"
              autocomplete="current-password"
              required
            />
            <button
              mat-icon-button
              matSuffix
              type="button"
              (click)="hidePassword.set(!hidePassword())"
              [attr.aria-label]="(hidePassword() ? 'auth.showPassword' : 'auth.hidePassword') | t"
              tabindex="-1"
            >
              <mat-icon>{{ hidePassword() ? 'visibility' : 'visibility_off' }}</mat-icon>
            </button>
            @if (form.controls.password.hasError('required') && form.controls.password.touched) {
              <mat-error>{{ 'validation.required' | t }}</mat-error>
            }
          </mat-form-field>
          @if (busy()) {
            <mat-progress-bar mode="indeterminate" />
          }
          <button mat-flat-button class="full" type="submit" [disabled]="form.invalid || busy()">
            {{ 'auth.login' | t }}
          </button>
        </form>
        <p>
          <a routerLink="/reset">{{ 'auth.forgot' | t }}</a> ·
          <a routerLink="/register">{{ 'auth.createAccount' | t }}</a>
        </p>
      </mat-card-content></mat-card
    >
  </main>`,
})
export class Login {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private notify = inject(Notify);
  busy = signal(false);
  hidePassword = signal(true);
  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  async submit() {
    this.busy.set(true);
    try {
      await this.auth.login(this.form.value.email!, this.form.value.password!);
      await this.router.navigateByUrl(sessionStorage.getItem('cb.after') ?? '/home');
      sessionStorage.removeItem('cb.after');
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'cb-register',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    TPipe,
  ],
  template: ` <main class="auth-page" id="main">
    <mat-card appearance="outlined" class="auth-card"
      ><mat-card-content>
        <div class="auth-logo-wrap"><a routerLink="/" aria-label="Ecuraa"><img src="/logo.png" alt="Ecuraa" class="auth-logo" /></a></div>
        <h1>{{ 'auth.createAccount' | t }}</h1>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'auth.name' | t }}</mat-label
            ><input matInput formControlName="name" autocomplete="name" required />
            @if (form.controls.name.hasError('required') && form.controls.name.touched) {
              <mat-error>{{ 'validation.required' | t }}</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'auth.email' | t }}</mat-label
            ><input matInput type="email" formControlName="email" autocomplete="email" required />
            @if (form.controls.email.hasError('required') && form.controls.email.touched) {
              <mat-error>{{ 'validation.required' | t }}</mat-error>
            }
            @if (form.controls.email.hasError('email') && form.controls.email.touched) {
              <mat-error>{{ 'validation.email' | t }}</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'auth.password' | t }}</mat-label
            ><input
              matInput
              [type]="hidePassword() ? 'password' : 'text'"
              formControlName="password"
              autocomplete="new-password"
              required
            />
            <button
              mat-icon-button
              matSuffix
              type="button"
              (click)="hidePassword.set(!hidePassword())"
              [attr.aria-label]="(hidePassword() ? 'auth.showPassword' : 'auth.hidePassword') | t"
              tabindex="-1"
            >
              <mat-icon>{{ hidePassword() ? 'visibility' : 'visibility_off' }}</mat-icon>
            </button>
            <mat-hint>{{ 'auth.passwordHint' | t }}</mat-hint>
            @if (form.controls.password.hasError('required') && form.controls.password.touched) {
              <mat-error>{{ 'validation.required' | t }}</mat-error>
            }
            @if (form.controls.password.hasError('minlength') && form.controls.password.touched) {
              <mat-error>{{ 'validation.minlength' | t: { min: 8 } }}</mat-error>
            }
          </mat-form-field>
          @if (busy()) {
            <mat-progress-bar mode="indeterminate" />
          }
          <button mat-flat-button class="full" type="submit" [disabled]="form.invalid || busy()">
            {{ 'auth.createAccount' | t }}
          </button>
        </form>
        <p>
          <a routerLink="/login">{{ 'auth.haveAccount' | t }}</a>
        </p>
      </mat-card-content></mat-card
    >
  </main>`,
})
export class Register {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private notify = inject(Notify);
  busy = signal(false);
  hidePassword = signal(true);
  form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });
  async submit() {
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      await this.auth.register(v.email, v.password, v.name);
      sessionStorage.setItem('cb.name', v.name);
      await this.router.navigateByUrl(sessionStorage.getItem('cb.after') ?? '/onboarding');
      sessionStorage.removeItem('cb.after');
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'cb-reset',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TPipe,
  ],
  template: ` <main class="auth-page" id="main">
    <mat-card appearance="outlined" class="auth-card"
      ><mat-card-content>
        <div class="auth-logo-wrap"><a routerLink="/" aria-label="Ecuraa"><img src="/logo.png" alt="Ecuraa" class="auth-logo" /></a></div>
        <h1>{{ 'auth.forgot' | t }}</h1>
        <mat-form-field appearance="outline"
          ><mat-label>{{ 'auth.email' | t }}</mat-label
          ><input matInput type="email" [(ngModel)]="email"
        /></mat-form-field>
        <button mat-flat-button class="full" (click)="send()" [disabled]="!email">
          {{ 'auth.sendReset' | t }}
        </button>
        @if (sent()) {
          <p class="notice" role="status">{{ 'auth.resetSent' | t }}</p>
        }
        <p>
          <a routerLink="/login">{{ 'auth.login' | t }}</a>
        </p>
      </mat-card-content></mat-card
    >
  </main>`,
})
export class ResetPassword {
  private auth = inject(AuthService);
  private notify = inject(Notify);
  email = '';
  sent = signal(false);
  async send() {
    try {
      await this.auth.resetPassword(this.email);
      this.sent.set(true);
    } catch (e) {
      this.notify.error(e);
    }
  }
}

@Component({
  selector: 'cb-onboarding',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressBarModule,
    TPipe,
  ],
  template: ` <main class="auth-page" id="main">
    <mat-card appearance="outlined" class="auth-card wide"
      ><mat-card-content>
        <div class="auth-logo-wrap"><a routerLink="/" aria-label="Ecuraa"><img src="/logo.png" alt="Ecuraa" class="auth-logo" /></a></div>
        <h1>{{ 'onboarding.title' | t }}</h1>
        <p class="muted">{{ 'onboarding.intro' | t }}</p>
        @if (auth.user() && !auth.user()?.emailVerified) {
          <div class="notice" role="status">
            <p>{{ 'auth.verifyEmailPrompt' | t }}</p>
            <div class="row">
              <button
                mat-stroked-button
                type="button"
                (click)="sendVerification()"
                [disabled]="busy()"
              >
                {{ 'auth.sendVerification' | t }}
              </button>
              <button mat-button type="button" (click)="checkVerification()" [disabled]="busy()">
                {{ 'auth.checkVerification' | t }}
              </button>
            </div>
          </div>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" class="form-grid">
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'onboarding.company' | t }}</mat-label
            ><input matInput formControlName="name" required
          /></mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'onboarding.yourName' | t }}</mat-label
            ><input matInput formControlName="displayName" required
          /></mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'onboarding.country' | t }}</mat-label
            ><input matInput formControlName="country" required
          /></mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'onboarding.industry' | t }}</mat-label
            ><input matInput formControlName="industry" required
          /></mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'onboarding.contactEmail' | t }}</mat-label
            ><input matInput type="email" formControlName="contactEmail" required
          /></mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'onboarding.registration' | t }}</mat-label
            ><input matInput formControlName="registrationNumber"
          /></mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'onboarding.phone' | t }}</mat-label
            ><input matInput formControlName="phone"
          /></mat-form-field>
          <mat-form-field appearance="outline"
            ><mat-label>{{ 'common.language' | t }}</mat-label>
            <mat-select formControlName="preferredLanguage">
              @for (l of languages; track l.code) {
                <mat-option [value]="l.code">{{ l.label }}</mat-option>
              }
            </mat-select></mat-form-field
          >
          <mat-form-field appearance="outline" class="span2"
            ><mat-label>{{ 'onboarding.address' | t }}</mat-label
            ><input matInput formControlName="address"
          /></mat-form-field>
          @if (busy()) {
            <mat-progress-bar mode="indeterminate" class="span2" />
          }
          <button mat-flat-button class="span2" type="submit" [disabled]="form.invalid || busy()">
            {{ 'onboarding.create' | t }}
          </button>
        </form>
        <p class="muted small">{{ 'onboarding.inviteHint' | t }}</p>
      </mat-card-content></mat-card
    >
  </main>`,
})
export class Onboarding {
  private fb = inject(FormBuilder);
  private api = inject(Api);
  private session = inject(Session);
  private router = inject(Router);
  private notify = inject(Notify);
  private i18n = inject(I18n);
  readonly auth = inject(AuthService);
  languages = UI_LANGUAGES.filter((l) => l.available);
  busy = signal(false);
  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    displayName: [
      sessionStorage.getItem('cb.name') ?? this.auth.user()?.displayName ?? '',
      Validators.required,
    ],
    country: ['Sri Lanka', Validators.required],
    industry: ['Aluminium manufacturing', Validators.required],
    contactEmail: [this.auth.user()?.email ?? '', [Validators.required, Validators.email]],
    registrationNumber: [''],
    phone: [''],
    address: [''],
    preferredLanguage: ['en' as Lang],
  });
  async sendVerification(): Promise<void> {
    this.busy.set(true);
    try {
      await this.auth.sendVerificationEmail();
      this.notify.ok('auth.verificationSent');
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async checkVerification(): Promise<void> {
    this.busy.set(true);
    try {
      const verified = await this.auth.checkEmailVerification();
      if (verified) {
        this.notify.ok('auth.verificationSuccess');
      } else {
        this.notify.error(new Error(this.i18n.t('auth.verificationPending')));
      }
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async submit() {
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      await this.api.post('/organizations', {
        ...v,
        registrationNumber: v.registrationNumber || undefined,
        phone: v.phone || undefined,
        address: v.address || undefined,
      });
      await this.session.refresh();
      this.notify.ok('onboarding.done');
      await this.router.navigateByUrl('/facilities');
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'cb-invite',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    TPipe,
  ],
  template: ` <main class="auth-page" id="main">
    <mat-card appearance="outlined" class="auth-card"
      ><mat-card-content>
        @if (info(); as i) {
          <h1>{{ 'invite.title' | t: { org: i.organizationName } }}</h1>
          <p>
            {{ 'invite.role' | t }}: <strong>{{ ('role.' + i.role) | t }}</strong> · {{ i.email }}
          </p>
          @if (i.expired || i.accepted) {
            <p class="notice error">{{ (i.expired ? 'invite.expired' : 'invite.used') | t }}</p>
          } @else if (!auth.user()) {
            <p>{{ 'invite.signInFirst' | t }}</p>
            <button mat-flat-button (click)="goAuth('/register')">
              {{ 'auth.createAccount' | t }}
            </button>
            <button mat-button (click)="goAuth('/login')">{{ 'auth.login' | t }}</button>
          } @else {
            <mat-form-field appearance="outline"
              ><mat-label>{{ 'auth.name' | t }}</mat-label
              ><input matInput [(ngModel)]="name"
            /></mat-form-field>
            <mat-form-field appearance="outline"
              ><mat-label>{{ 'common.language' | t }}</mat-label>
              <mat-select [(ngModel)]="lang">
                @for (l of languages; track l.code) {
                  <mat-option [value]="l.code">{{ l.label }}</mat-option>
                }
              </mat-select></mat-form-field
            >
            <button mat-flat-button class="full" (click)="accept()" [disabled]="!name">
              {{ 'invite.accept' | t }}
            </button>
          }
        } @else {
          <p>{{ 'common.loading' | t }}</p>
        }
      </mat-card-content></mat-card
    >
  </main>`,
})
export class InviteAccept implements OnInit {
  readonly token = input.required<string>();
  auth = inject(AuthService);
  private api = inject(Api);
  private session = inject(Session);
  private router = inject(Router);
  private notify = inject(Notify);
  languages = UI_LANGUAGES.filter((l) => l.available);
  info = signal<{
    organizationName: string;
    email: string;
    role: string;
    expired: boolean;
    accepted: boolean;
  } | null>(null);
  name = this.auth.user()?.displayName ?? '';
  lang: Lang = 'en';
  async ngOnInit() {
    try {
      this.info.set(await this.api.get(`/invites/${this.token()}`));
    } catch (e) {
      this.notify.error(e);
    }
  }
  goAuth(path: string) {
    sessionStorage.setItem('cb.after', `/invite/${this.token()}`);
    void this.router.navigateByUrl(path);
  }
  async accept() {
    try {
      await this.api.post(`/invites/${this.token()}/accept`, {
        displayName: this.name,
        language: this.lang,
      });
      await this.session.refresh();
      await this.router.navigateByUrl('/home');
    } catch (e) {
      this.notify.error(e);
    }
  }
}

interface SharedView {
  buyerName: string;
  expiresAt: string;
  supplier: { name: string; country: string };
  facility: { name: string; country: string; products: string[] } | null;
  report: {
    periodKey: string;
    version: number;
    status: string;
    reviewedAt?: string;
    reviewerComment?: string;
  };
  readiness: { status: string; checks: { label: string; passed: boolean; detail: string }[] };
  calculation: {
    totalTCo2e: number;
    intensityTCo2ePerT: number | null;
    electricityKWh: number;
    dieselKg: number;
    productionT: number;
    boundary: string;
    coverage: { element: string; included: boolean; note: string }[];
    factorSet: string;
    formulaVersion: string;
  } | null;
  clarifications: { at: string; name: string; message: string }[];
}

/** European buyer portal: shows only the explicitly shared, approved report. No account needed. */
@Component({
  selector: 'cb-shared',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    TPipe,
    StatusChip,
  ],
  template: ` <header class="public-top">
      <span class="brand"><img src="/logo.png" alt="Ecuraa" class="brand-logo" /> <span class="brand-sub">· {{ 'buyer.portal' | t }}</span></span>
    </header>
    <main class="page" id="main">
      @if (error()) {
        <mat-card appearance="outlined"
          ><mat-card-content
            ><h1>{{ 'buyer.unavailable' | t }}</h1>
            <p>{{ error() }}</p></mat-card-content
          ></mat-card
        >
      }
      @if (view(); as v) {
        <h1>{{ v.supplier.name }} · {{ v.report.periodKey }}</h1>
        <p class="muted">
          {{ 'buyer.sharedWith' | t: { name: v.buyerName } }} · {{ 'buyer.expires' | t }}
          {{ v.expiresAt | date: 'mediumDate' }}
        </p>
        <div class="kpis">
          <div class="kpi">
            <span>{{ 'kpi.total' | t }}</span
            ><strong>{{ v.calculation?.totalTCo2e | number: '1.0-4' }} t CO₂e</strong>
          </div>
          <div class="kpi">
            <span>{{ 'kpi.intensity' | t }}</span
            ><strong>{{ v.calculation?.intensityTCo2ePerT ?? '–' }} t/t</strong>
          </div>
          <div class="kpi">
            <span>{{ 'kpi.version' | t }}</span
            ><strong>v{{ v.report.version }}</strong>
          </div>
          <div class="kpi">
            <span>{{ 'kpi.status' | t }}</span
            ><cb-status [value]="v.report.status" />
          </div>
        </div>
        <mat-card appearance="outlined"
          ><mat-card-content>
            <h2>{{ 'results.boundary' | t }}</h2>
            <p>{{ v.calculation?.boundary }}</p>
            <ul class="checklist">
              @for (c of v.calculation?.coverage ?? []; track c.element) {
                <li>
                  <mat-icon>{{ c.included ? 'check' : 'remove' }}</mat-icon> {{ c.element }} —
                  <span class="muted">{{ c.note }}</span>
                </li>
              }
            </ul>
            <p class="small muted">
              {{ v.calculation?.factorSet }} · {{ v.calculation?.formulaVersion }}
            </p>
          </mat-card-content></mat-card
        >
        <mat-card appearance="outlined"
          ><mat-card-content>
            <h2>{{ 'readiness.title' | t }}</h2>
            <ul class="checklist">
              @for (c of v.readiness.checks; track c.label) {
                <li>
                  <mat-icon>{{ c.passed ? 'check_circle' : 'pending' }}</mat-icon> {{ c.label }} —
                  <span class="muted">{{ c.detail }}</span>
                </li>
              }
            </ul>
            @if (v.report.reviewerComment) {
              <p>
                <strong>{{ 'review.comment' | t }}:</strong> {{ v.report.reviewerComment }}
              </p>
            }
            <p class="notice">{{ 'buyer.notCertified' | t }}</p>
          </mat-card-content></mat-card
        >
        <div class="row">
          <button mat-flat-button (click)="download('pdf')">
            <mat-icon>picture_as_pdf</mat-icon> PDF
          </button>
          <button mat-stroked-button (click)="download('csv')">CSV</button>
          <button mat-stroked-button (click)="download('xlsx')">XLSX</button>
        </div>
        <mat-card appearance="outlined"
          ><mat-card-content>
            <h2>{{ 'buyer.clarify' | t }}</h2>
            @for (c of v.clarifications; track c.at) {
              <p class="small">
                <strong>{{ c.name }}</strong> · {{ c.at | date: 'short' }}<br />{{ c.message }}
              </p>
            }
            <mat-form-field appearance="outline" class="full"
              ><mat-label>{{ 'auth.name' | t }}</mat-label
              ><input matInput [(ngModel)]="name"
            /></mat-form-field>
            <mat-form-field appearance="outline" class="full"
              ><mat-label>{{ 'buyer.question' | t }}</mat-label
              ><textarea matInput rows="3" [(ngModel)]="message"></textarea>
            </mat-form-field>
            <button mat-flat-button (click)="clarify()" [disabled]="!name || !message">
              {{ 'common.send' | t }}
            </button>
          </mat-card-content></mat-card
        >
      }
    </main>`,
})
export class SharedReport implements OnInit {
  readonly token = input.required<string>();
  private api = inject(Api);
  private notify = inject(Notify);
  view = signal<SharedView | null>(null);
  error = signal<string | null>(null);
  name = '';
  message = '';
  async ngOnInit() {
    try {
      this.view.set(await this.api.get<SharedView>(`/shared/${this.token()}`));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  download(f: string) {
    void this.api
      .download(`/shared/${this.token()}/download`, `report.${f}`, { format: f })
      .catch((e) => this.notify.error(e));
  }
  async clarify() {
    try {
      await this.api.post(`/shared/${this.token()}/clarifications`, {
        name: this.name,
        message: this.message,
      });
      this.message = '';
      this.notify.ok('buyer.sent');
      await this.ngOnInit();
    } catch (e) {
      this.notify.error(e);
    }
  }
}
