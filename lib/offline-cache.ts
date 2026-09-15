// Offline read cache — successful GET /api/* responses are stored so the UI
// still renders when the school server is unreachable. Entries are a
// convenience copy, never authoritative: the banner marks the app offline and
// every item shows when it was last synced.
export type CachedResponse = { url: string; body: string; at: number };

const DB_NAME = "nyashavee-cache";
const STORE = "responses";
const MAX_ENTRIES = 300;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "url" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheResponse(url: string, body: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put({ url, body, at: Date.now() } satisfies CachedResponse));
  } catch { /* storage full/blocked — caching is best-effort */ }
}

export async function readCache(url: string): Promise<CachedResponse | null> {
  try {
    const row = await withStore("readonly", (store) => store.get(url) as IDBRequest<CachedResponse | undefined>);
    return row ?? null;
  } catch {
    return null;
  }
}

// Keep the cache bounded — oldest entries drop first.
export async function trimCache(): Promise<void> {
  try {
    const db = await openDb();
    const rows = await new Promise<CachedResponse[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll() as IDBRequest<CachedResponse[]>;
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (rows.length <= MAX_ENTRIES) return;
    const stale = rows.sort((a, b) => a.at - b.at).slice(0, rows.length - MAX_ENTRIES);
    await withStore("readwrite", (store) => {
      for (const row of stale) store.delete(row.url);
      return store.count();
    });
  } catch { /* best-effort */ }
}

export function lastSyncLabel(at: number | null): string {
  if (!at) return "";
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} days ago`;
}
