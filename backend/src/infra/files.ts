import type { Bucket } from '@google-cloud/storage';
import type { FileStore } from '../ports';

/** Private Google Cloud Storage bucket. Files are never public; downloads stream through the authorised API. */
export class GcsFileStore implements FileStore {
  constructor(private readonly bucket: Bucket) {}
  async write(path: string, data: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(path).save(data, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  }
  async read(path: string): Promise<Buffer> {
    const [buf] = await this.bucket.file(path).download();
    return buf;
  }
  async exists(path: string): Promise<boolean> {
    const [e] = await this.bucket.file(path).exists();
    return e;
  }
}

/** In-memory file store for tests and offline development. */
export class MemoryFileStore implements FileStore {
  private files = new Map<string, Buffer>();
  async write(path: string, data: Buffer): Promise<void> {
    this.files.set(path, Buffer.from(data));
  }
  async read(path: string): Promise<Buffer> {
    const f = this.files.get(path);
    if (!f) throw new Error(`File not found: ${path}`);
    return Buffer.from(f);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}
