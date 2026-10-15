import { ConflictError, type DocStore, type Filter, type StoreTx } from '../ports';

/**
 * In-memory document store with the same path semantics as Firestore.
 * Used for automated tests and fully-offline local development only.
 */
export class MemoryStore implements DocStore {
  private docs = new Map<string, unknown>();
  private lock: Promise<unknown> = Promise.resolve();

  async get<T>(path: string): Promise<T | null> {
    const v = this.docs.get(path);
    return v === undefined ? null : (clone(v) as T);
  }
  async create<T extends object>(path: string, data: T): Promise<void> {
    if (this.docs.has(path)) throw new ConflictError(`Document already exists: ${path}`);
    this.docs.set(path, clone(data));
  }
  async set<T extends object>(path: string, data: T): Promise<void> {
    this.docs.set(path, clone(data));
  }
  async update(path: string, data: Record<string, unknown>): Promise<void> {
    const cur = this.docs.get(path);
    if (cur === undefined) throw new Error(`Document not found: ${path}`);
    this.docs.set(path, { ...(cur as object), ...clone(data) });
  }
  async delete(path: string): Promise<void> {
    this.docs.delete(path);
  }
  async list<T>(collectionPath: string, filters: Filter[] = []): Promise<T[]> {
    const depth = collectionPath.split('/').length + 1;
    const out: T[] = [];
    for (const [p, v] of this.docs) {
      if (p.startsWith(collectionPath + '/') && p.split('/').length === depth && matches(v, filters)) out.push(clone(v) as T);
    }
    return out;
  }
  async listGroup<T>(collectionId: string, filters: Filter[] = []): Promise<T[]> {
    const out: T[] = [];
    for (const [p, v] of this.docs) {
      const seg = p.split('/');
      if (seg.length >= 2 && seg[seg.length - 2] === collectionId && matches(v, filters)) out.push(clone(v) as T);
    }
    return out;
  }
  async transaction<R>(fn: (tx: StoreTx) => Promise<R>): Promise<R> {
    const run = this.lock.then(async () => {
      const writes: (() => void)[] = [];
      const tx: StoreTx = {
        get: (p) => this.get(p),
        set: (p, d) => void writes.push(() => this.docs.set(p, clone(d))),
        update: (p, d) =>
          void writes.push(() => {
            const cur = this.docs.get(p);
            if (cur === undefined) throw new Error(`Document not found: ${p}`);
            this.docs.set(p, { ...(cur as object), ...clone(d) });
          }),
        create: (p, d) =>
          void writes.push(() => {
            if (this.docs.has(p)) throw new ConflictError(`Document already exists: ${p}`);
            this.docs.set(p, clone(d));
          }),
      };
      const result = await fn(tx);
      for (const w of writes) w();
      return result;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }
}

function matches(v: unknown, filters: Filter[]): boolean {
  const obj = v as Record<string, unknown>;
  return filters.every(([field, op, value]) =>
    op === '==' ? obj[field] === value : Array.isArray(value) && value.includes(obj[field]),
  );
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
