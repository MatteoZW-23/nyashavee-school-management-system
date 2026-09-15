// Shared API helpers for workspace mutation handlers.

// The offline fetch interceptor answers 202 { queued: true } when a mutation
// cannot reach the school server. Handlers must not show their normal success
// toast for that — the record is queued, not saved yet.
export function isQueuedResponse(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { queued?: unknown }).queued === true;
}

export const OFFLINE_QUEUED_MESSAGE = "Saved on this device — it will send to the server when the connection returns.";
