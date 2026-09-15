"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, RefreshCw, Wifi, X } from "lucide-react";
import { toast } from "sonner";
import { enqueueRequest, listQueue, removeItem, updateItem, type QueuedItem } from "@/lib/offline-outbox";
import { cacheResponse, readCache, trimCache, lastSyncLabel } from "@/lib/offline-cache";

const SYNCABLE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Items stuck in "syncing" (tab closed mid-drain) are reclaimed after a minute.
const STALE_SYNC_MS = 60_000;
let draining = false;
let originalFetch: typeof window.fetch | null = null;
// The last moment any request actually reached the server — shown as the
// "data as of" time while offline so stale reads are honest.
let lastServerContact = Date.now();

// Intercept fetch once — a mutation that fails on the network is queued with
// its captured headers (including Idempotency-Key for finance writes) and
// replayed verbatim on reconnect.
function installInterceptor(notify: () => void) {
  if ((window.fetch as { __offline?: boolean }).__offline) return;
  const original = window.fetch.bind(window);
  originalFetch = original;
  const patched = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const isApi = url.startsWith("/api/") || url.includes(`${location.origin}/api/`);
      if (!isApi) return original(input, init);

      // GETs: network-first, then serve the last good copy when offline so
      // staff can still read registers, balances and lists. Marked responses
      // are labelled stale by the offline banner — never treated as live.
      if (method === "GET") {
        try {
          const response = await original(input, init);
          lastServerContact = Date.now();
          const type = response.headers.get("content-type") ?? "";
          if (response.ok && type.includes("json")) {
            void response.clone().text().then((body) => { void cacheResponse(url, body); void trimCache(); });
          }
          return response;
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          const cached = await readCache(url);
          if (!cached) throw error;
          return new Response(cached.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Offline-Cache": "1", "X-Offline-At": String(cached.at) },
          });
        }
      }

      if (!SYNCABLE.has(method)) return original(input, init);
      try {
        return await original(input, init);
      } catch (error) {
        // Only a true network failure queues — a reached server that returned an
        // error response is a real answer, not a sync case.
        if (!(error instanceof TypeError)) throw error;
        // Multipart/file uploads cannot be serialized into the outbox — let the
        // caller show its normal failure so the user retries with the file.
        if (init?.body && typeof init.body !== "string") throw error;
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
        const body = typeof init?.body === "string" ? init.body : null;
        await enqueueRequest(url, { method, headers, body });
        notify();
        toast.warning("No connection — saved offline and queued for sync.", { description: "It will send automatically when the school server is reachable again." });
        // A 202 tells callers the intent was accepted for later — the toast makes
        // clear nothing was committed yet.
        return new Response(JSON.stringify({ queued: true }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
    },
    { __offline: true },
  );
  window.fetch = patched;
}

export function OfflineManager() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);

  const refreshQueue = useCallback(async () => {
    if (mounted.current) setQueue(await listQueue());
  }, []);

  const drain = useCallback(async () => {
    if (draining) return;
    draining = true;
    let syncedAny = false;
    try {
      const items = await listQueue();
      for (const item of items) {
        // Skip a live in-flight replay, but reclaim items orphaned by a closed tab.
        if (item.status === "syncing" && Date.now() - (item.syncStartedAt ?? 0) < STALE_SYNC_MS) continue;
        item.status = "syncing";
        item.syncStartedAt = Date.now();
        await updateItem(item);
        await refreshQueue();
        try {
          const response = await (originalFetch ?? window.fetch)(item.url, { method: item.method, headers: item.headers, body: item.body });
          if (response.ok || response.status === 409) {
            // 409 = already applied (idempotent replay) — done, not an error.
            await removeItem(item.id);
            toast.success(`Synced: ${item.label}`);
            syncedAny = true;
          } else {
            const text = await response.json().catch(() => ({}));
            item.status = "failed";
            item.error = text.error || `Server returned ${response.status}`;
            await updateItem(item);
          }
        } catch {
          item.status = "queued";
          item.syncStartedAt = undefined;
          await updateItem(item);
          break; // still offline — try later
        }
        await refreshQueue();
      }
    } finally {
      draining = false;
      // Let open workspaces refetch fresh data after a successful replay.
      if (syncedAny) window.dispatchEvent(new Event("nyashavee:synced"));
    }
  }, [refreshQueue]);

  useEffect(() => {
    mounted.current = true;
    installInterceptor(() => void refreshQueue());
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    const onOnline = () => { setOnline(true); void drain(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void refreshQueue();
    return () => {
      mounted.current = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [drain, refreshQueue]);

  // Re-check connectivity periodically — navigator.onLine can lag on LAN drops.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        await window.fetch("/api/health", { method: "HEAD", cache: "no-store" });
        if (!online) { setOnline(true); void drain(); }
      } catch {
        setOnline(false);
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [online, drain]);

  const queued = queue.filter((i) => i.status !== "failed");
  const failed = queue.filter((i) => i.status === "failed");

  async function retryFailed() {
    for (const item of failed) {
      await updateItem({ ...item, status: "queued", error: undefined });
    }
    await refreshQueue();
    void drain();
  }

  if (online && queue.length === 0) return null;

  return (
    <>
      {!online && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-[#8a4a12] px-4 py-1.5 text-xs font-semibold text-white">
          <CloudOff className="size-3.5" /> Offline — showing saved data from {lastSyncLabel(lastServerContact)}. New records queue and send automatically when the connection returns.
        </div>
      )}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
        {open && (
          <div className="w-80 rounded-xl border border-[#d9e2dd] bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Sync queue</p>
              <button type="button" onClick={() => setOpen(false)} className="text-[#78857e]"><X className="size-4" /></button>
            </div>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {queue.map((item) => (
                <div key={item.id} className="rounded-lg border border-[#eef1ef] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium">{item.label}</p>
                    <span className={`shrink-0 text-[10px] font-bold uppercase ${item.status === "failed" ? "text-[#a04e31]" : item.status === "syncing" ? "text-[#1d5fae]" : "text-[#8a6519]"}`}>{item.status === "failed" ? "needs review" : item.status}</span>
                  </div>
                  {item.error && <p className="mt-1 text-[11px] text-[#a04e31]">{item.error}</p>}
                </div>
              ))}
            </div>
            {failed.length > 0 && <button type="button" onClick={() => void retryFailed()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#173f35] px-3 py-2 text-xs font-semibold text-white"><RefreshCw className="size-3.5" /> Retry {failed.length} failed</button>}
            <p className="mt-3 text-[10px] leading-4 text-[#8a968f]">Failed items were rejected by the server — review the reason and re-enter the record if needed.</p>
          </div>
        )}
        {queue.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-lg ${failed.length ? "bg-[#a04e31]" : "bg-[#173f35]"}`}>
            {online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />}
            {queued.length ? `${queued.length} queued` : ""}{queued.length && failed.length ? " · " : ""}{failed.length ? `${failed.length} failed` : ""}
          </button>
        )}
      </div>
    </>
  );
}
