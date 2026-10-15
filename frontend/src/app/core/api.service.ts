import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { from, firstValueFrom, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from './environment';

/** Attaches the Firebase ID token to API calls. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBase)) return next(req);
  const auth = inject(AuthService);
  return from(auth.token()).pipe(switchMap((t) => next(t ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req)));
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private base = environment.apiBase;

  get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) p = p.set(k, v);
    return this.wrap(firstValueFrom(this.http.get<T>(this.base + path, { params: p })));
  }
  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.wrap(firstValueFrom(this.http.post<T>(this.base + path, body)));
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.wrap(firstValueFrom(this.http.patch<T>(this.base + path, body)));
  }
  upload<T>(path: string, form: FormData): Promise<T> {
    return this.wrap(firstValueFrom(this.http.post<T>(this.base + path, form)));
  }
  blob(path: string, params?: Record<string, string>): Promise<Blob> {
    return this.wrap(firstValueFrom(this.http.get(this.base + path, { params, responseType: 'blob' })));
  }

  /** Downloads an authorised file and saves it with the given name. */
  async download(path: string, fileName: string, params?: Record<string, string>) {
    const b = await this.blob(path, params);
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private async wrap<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        let body = e.error;
        if (body instanceof Blob) {
          try { body = JSON.parse(await body.text()); } catch { body = null; }
        }
        const err = body?.error;
        throw new ApiError(e.status, err?.code ?? 'NETWORK', err?.message ?? (e.status === 0 ? 'Cannot reach the server. Check your connection.' : 'Request failed'), err?.details);
      }
      throw e;
    }
  }
}
