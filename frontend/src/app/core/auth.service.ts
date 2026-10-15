import { Injectable, signal } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onIdTokenChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { environment } from './environment';

/** Firebase Authentication. The ID token is sent to the API, which verifies it server-side. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = getAuth(initializeApp(environment.firebase));
  private _emu = environment.authEmulatorUrl
    ? connectAuthEmulator(this.auth, environment.authEmulatorUrl, { disableWarnings: true })
    : null;
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);
  private readyResolve!: () => void;
  readonly whenReady = new Promise<void>((r) => (this.readyResolve = r));

  constructor() {
    onIdTokenChanged(this.auth, (u) => {
      this.user.set(u);
      if (!this.ready()) {
        this.ready.set(true);
        this.readyResolve();
      }
    });
  }

  async token(): Promise<string | null> {
    return this.auth.currentUser ? this.auth.currentUser.getIdToken() : null;
  }
  async login(email: string, password: string) {
    await signInWithEmailAndPassword(this.auth, email, password);
  }
  async register(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(cred.user, { displayName });
  }
  async resetPassword(email: string) {
    await sendPasswordResetEmail(this.auth, email);
  }
  /** Send Firebase verification email to the currently signed-in user. */
  async sendVerificationEmail(): Promise<void> {
    await this.whenReady;
    const user = this.auth.currentUser;
    if (!user) throw new Error('Please sign in first.');

    await reload(user);
    if (user.emailVerified) throw new Error('Email is already verified.');

    await sendEmailVerification(user);
  }

  /** Refresh the email-verified state and ID token after following the email link. */
  async checkEmailVerification(): Promise<boolean> {
    await this.whenReady;
    const user = this.auth.currentUser;
    if (!user) throw new Error('Please sign in first.');

    await reload(user);
    await user.getIdToken(true);
    this.user.set(user);
    return user.emailVerified;
  }

  async logout() {
    await signOut(this.auth);
  }
}
