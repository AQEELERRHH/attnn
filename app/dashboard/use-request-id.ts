"use client";

import * as React from "react";

/**
 * A request id for a money-moving request (wallet/send, wallet/agent). The server
 * turns it into Circle's idempotency key, so the same id can only ever move money once.
 *
 *   idFor(key)  → the id for this exact request (e.g. "send:0xabc…:25.00"). Asking
 *                 again for the same key returns the same id, so a retry after an
 *                 error or a double click can't pay twice.
 *   done()      → after success; the next request gets a fresh id.
 */
export function useRequestId() {
  const current = React.useRef<{ key: string; id: string } | null>(null);
  const idFor = React.useCallback((key: string) => {
    if (current.current?.key !== key) current.current = { key, id: crypto.randomUUID() };
    return current.current.id;
  }, []);
  const done = React.useCallback(() => {
    current.current = null;
  }, []);
  return { idFor, done };
}
