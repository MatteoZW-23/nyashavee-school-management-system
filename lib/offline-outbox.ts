// Offline outbox — queued mutations live in IndexedDB until they replay to the
// school server. Nothing here ever mutates server state itself; replay goes
// through the normal authenticated POST path, which enforces permissions,
// validation and (for finance) the captured Idempotency-Key.

export type QueuedItem = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  createdAt: number;
  status: "queued" | "syncing" | "failed";
  // Reclaim guard: a tab closed mid-sync leaves status "syncing" — after this
  // window the next drain treats the item as queued again.
  syncStartedAt?: number;
  label: string;
  error?: string;
};

const DB_NAME = "nyashavee-outbox";
const STORE = "requests";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
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

export function labelFor(url: string, body: string | null) {
  try {
    const action = body ? (JSON.parse(body) as { action?: string }).action : undefined;
    const table: Record<string, string> = {
      record_payment: "Fee payment", create_invoice: "Invoice", mark_staff: "Staff register",
      submit_proof: "Payment proof", save_register: "Class register",
    };
    const verb = action ? (table[action] ?? action.replaceAll("_", " ")) : url.split("/api/")[1]?.split("?")[0] ?? url;
    return `${verb} → ${url.split("?")[0].replace("/api/", "")}`;
  } catch {
    return url;
  }
}

export async function enqueueRequest(url: string, init: { method: string; headers: Record<string, string>; body: string | null }): Promise<QueuedItem> {
  const item: QueuedItem = {
    id: crypto.randomUUID(),
    url,
    method: init.method,
    headers: init.headers,
    body: init.body,
    createdAt: Date.now(),
    status: "queued",
    label: labelFor(url, init.body),
  };
  await withStore("readwrite", (store) => store.put(item));
  return item;
}

export async function listQueue(): Promise<QueuedItem[]> {
  try {
    const items = await withStore("readonly", (store) => store.getAll() as IDBRequest<QueuedItem[]>);
    return items.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function updateItem(item: QueuedItem): Promise<void> {
  await withStore("readwrite", (store) => store.put(item));
}

export async function removeItem(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
