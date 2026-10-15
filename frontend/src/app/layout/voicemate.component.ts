import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Api } from '../core/api.service';
import { I18n, TPipe } from '../core/i18n.service';
import { Notify, SpeakButton } from '../shared/ui';

interface Msg { from: 'me' | 'ai'; text: string }

/** Carbon VoiceMate: simple-language help with optional voice input (transcript is always shown before sending). */
@Component({
  selector: 'cb-voicemate',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, TPipe, SpeakButton],
  template: `
    <section class="voicemate" aria-labelledby="vm-title">
      <h2 id="vm-title"><mat-icon aria-hidden="true">support_agent</mat-icon> {{ 'voice.title' | t }}</h2>
      <p class="muted small">{{ 'voice.intro' | t }}</p>
      <div class="vm-log" aria-live="polite">
        @for (m of log(); track $index) {
          <div class="vm-msg" [class.me]="m.from === 'me'">
            <span>{{ m.text }}</span>
            @if (m.from === 'ai') { <cb-speak [text]="m.text" /> <span class="ai-label">{{ 'common.aiGenerated' | t }}</span> }
          </div>
        }
      </div>
      @if (busy()) { <mat-progress-bar mode="indeterminate" /> }
      @if (transcriptPending()) { <p class="notice">{{ 'voice.checkTranscript' | t }}</p> }
      <form (ngSubmit)="send()" class="vm-form">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
          <mat-label>{{ 'voice.ask' | t }}</mat-label>
          <textarea matInput name="q" [(ngModel)]="question" rows="2" maxlength="1000"></textarea>
        </mat-form-field>
        <div class="row">
          <button mat-stroked-button type="button" (click)="toggleRecord()" [attr.aria-pressed]="recording()">
            <mat-icon>{{ recording() ? 'stop' : 'mic' }}</mat-icon> {{ (recording() ? 'voice.stop' : 'voice.speak') | t }}
          </button>
          <button mat-flat-button type="submit" [disabled]="busy() || !question.trim()"><mat-icon>send</mat-icon> {{ 'common.send' | t }}</button>
        </div>
      </form>
      <p class="muted small">{{ 'voice.needHelp' | t }}</p>
    </section>`,
})
export class VoiceMate {
  private api = inject(Api);
  private i18n = inject(I18n);
  private notify = inject(Notify);
  log = signal<Msg[]>([]);
  busy = signal(false);
  recording = signal(false);
  transcriptPending = signal(false);
  question = '';
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async send() {
    const q = this.question.trim();
    if (!q) return;
    this.log.update((l) => [...l, { from: 'me', text: q }]);
    this.question = '';
    this.transcriptPending.set(false);
    this.busy.set(true);
    try {
      const r = await this.api.post<{ reply: string }>('/assistant/chat', { message: q, language: this.i18n.lang() });
      this.log.update((l) => [...l, { from: 'ai', text: r.reply }]);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async toggleRecord() {
    if (this.recording()) {
      this.recorder?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '' });
      this.recorder.ondataavailable = (e) => this.chunks.push(e.data);
      this.recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        this.recording.set(false);
        await this.transcribe(new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' }));
      };
      this.recorder.start();
      this.recording.set(true);
      setTimeout(() => this.recording() && this.recorder?.stop(), 55_000);
    } catch (e) {
      this.notify.error(e);
    }
  }

  private async transcribe(blob: Blob) {
    this.busy.set(true);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      const r = await this.api.post<{ transcript: string }>('/assistant/transcribe', { audioBase64: b64, mimeType: blob.type, language: this.i18n.lang() });
      // Show the transcript for review; the user edits/confirms before sending.
      this.question = r.transcript;
      this.transcriptPending.set(true);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
