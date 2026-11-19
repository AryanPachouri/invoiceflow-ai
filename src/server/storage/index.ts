import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

/**
 * Document storage. Supabase Storage (private bucket, service-role key on the server only)
 * when configured; otherwise the local filesystem.
 */
export interface DocumentStorage {
  kind: "supabase" | "local";
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(keys: string[]): Promise<void>;
}

class LocalStorage implements DocumentStorage {
  kind = "local" as const;
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
    return key;
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async remove(keys: string[]) {
    await Promise.all(keys.map((k) => fs.rm(this.resolve(k), { force: true })));
  }
}

class SupabaseStorage implements DocumentStorage {
  kind = "supabase" as const;
  private clientPromise: Promise<import("@supabase/supabase-js").SupabaseClient>;
  constructor(url: string, key: string, private bucket: string) {
    this.clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
  }
  private bucketReady?: Promise<void>;
  private ensureBucket(c: import("@supabase/supabase-js").SupabaseClient) {
    this.bucketReady ??= (async () => {
      const { data } = await c.storage.getBucket(this.bucket);
      if (!data) {
        const { error } = await c.storage.createBucket(this.bucket, { public: false, fileSizeLimit: "10MB", allowedMimeTypes: ["application/pdf"] });
        if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create storage bucket "${this.bucket}": ${error.message}`);
      }
    })().catch((e) => { this.bucketReady = undefined; throw e; });
    return this.bucketReady;
  }
  async put(key: string, data: Buffer, contentType: string) {
    const c = await this.clientPromise;
    await this.ensureBucket(c);
    const { error } = await c.storage.from(this.bucket).upload(key, data, { contentType, upsert: true });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
    return key;
  }
  async get(key: string) {
    const c = await this.clientPromise;
    const { data, error } = await c.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Supabase Storage download failed: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(keys: string[]) {
    if (!keys.length) return;
    const c = await this.clientPromise;
    await c.storage.from(this.bucket).remove(keys);
  }
}

const g = globalThis as unknown as { __invoiceflowStorage?: DocumentStorage };

export function getStorage(): DocumentStorage {
  if (!g.__invoiceflowStorage) {
    g.__invoiceflowStorage =
      env.supabaseUrl && env.supabaseServiceRoleKey
        ? new SupabaseStorage(env.supabaseUrl, env.supabaseServiceRoleKey, env.storageBucket)
        : new LocalStorage(env.localStorageDir);
  }
  return g.__invoiceflowStorage;
}

export function setStorageForTesting(s: DocumentStorage | undefined) {
  g.__invoiceflowStorage = s;
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw last;
}
