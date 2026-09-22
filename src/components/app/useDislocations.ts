"use client";

import { useEffect, useState } from "react";
import type { Dislocation } from "@/app/api/dislocations/route";

export interface DislocationsState {
  rows: Dislocation[] | null;
  breakevenBps: number | null;
  failed: boolean;
}

// One request per page load, shared by every section that reads it: the route
// walks every pair's history, and the sources behind it rate-limit.
let pending: Promise<{ dislocations?: Dislocation[]; breakevenBps?: number }> | null = null;

export function useDislocations(): DislocationsState {
  const [state, setState] = useState<DislocationsState>({ rows: null, breakevenBps: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    pending ??= fetch("/api/dislocations").then((r) => r.json());
    pending.then(
      (body) => {
        if (cancelled) return;
        // A partial answer is not worth keeping for the next mount.
        if (!body.dislocations?.length) pending = null;
        setState({ rows: body.dislocations ?? [], breakevenBps: body.breakevenBps ?? null, failed: false });
      },
      () => {
        pending = null;
        if (!cancelled) setState((s) => ({ ...s, failed: true }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
