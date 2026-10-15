import type { Firestore } from 'firebase-admin/firestore';
import { ConflictError, type DocStore, type Filter, type StoreTx } from '../ports';

/** Cloud Firestore adapter. Only the backend service account accesses Firestore; client access is denied by rules. */
export class FirestoreStore implements DocStore {
  constructor(private readonly db: Firestore) {}

  async get<T>(path: string): Promise<T | null> {
    const snap = await this.db.doc(path).get();
    return snap.exists ? (snap.data() as T) : null;
  }
  async create<T extends object>(path: string, data: T): Promise<void> {
    try {
      await this.db.doc(path).create(stripUndefined(data));
    } catch (e: unknown) {
      if ((e as { code?: number }).code === 6) throw new ConflictError(`Document already exists: ${path}`);
      throw e;
    }
  }
  async set<T extends object>(path: string, data: T): Promise<void> {
    await this.db.doc(path).set(stripUndefined(data));
  }
  async update(path: string, data: Record<string, unknown>): Promise<void> {
    await this.db.doc(path).update(stripUndefined(data));
  }
  async delete(path: string): Promise<void> {
    await this.db.doc(path).delete();
  }
  async list<T>(collectionPath: string, filters: Filter[] = []): Promise<T[]> {
    let q: FirebaseFirestore.Query = this.db.collection(collectionPath);
    for (const [f, op, v] of filters) q = q.where(f, op, v);
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as T);
  }
  async listGroup<T>(collectionId: string, filters: Filter[] = []): Promise<T[]> {
    let q: FirebaseFirestore.Query = this.db.collectionGroup(collectionId);
    for (const [f, op, v] of filters) q = q.where(f, op, v);
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as T);
  }
  async transaction<R>(fn: (tx: StoreTx) => Promise<R>): Promise<R> {
    return this.db.runTransaction(async (t) => {
      const tx: StoreTx = {
        get: async <T>(p: string) => {
          const s = await t.get(this.db.doc(p));
          return s.exists ? (s.data() as T) : null;
        },
        set: (p, d) => void t.set(this.db.doc(p), stripUndefined(d)),
        update: (p, d) => void t.update(this.db.doc(p), stripUndefined(d)),
        create: (p, d) => void t.create(this.db.doc(p), stripUndefined(d)),
      };
      return fn(tx);
    });
  }
}

/** Firestore rejects `undefined`; remove such keys recursively. */
function stripUndefined<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
