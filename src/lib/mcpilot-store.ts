"use client";

import { create } from "zustand";

export interface CallResult {
  ok: boolean;
  isError: boolean;
  content: string;
  parsed: unknown;
  durationMs: number;
  status: number;
  tool: string;
  args: Record<string, unknown>;
  error?: string;
  at: number;
}

export interface HealthInfo {
  status: string;
  service: string;
  version: string;
  tools: number;
  adminModeEnabled: boolean;
}

interface McpilotState {
  // health
  health: HealthInfo | null;
  healthLoading: boolean;
  healthError: string | null;
  fetchHealth: () => Promise<void>;

  // selection
  selectedTool: string | null;
  selectTool: (name: string | null) => void;

  // active call
  calling: boolean;
  lastResult: CallResult | null;
  history: CallResult[];
  callTool: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<CallResult | null>;

  clearHistory: () => void;
}

async function fetchHealthInternal(): Promise<{
  health: HealthInfo | null;
  error: string | null;
}> {
  try {
    const res = await fetch("/api/mcpilot/health", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      return { health: null, error: data?.error || `HTTP ${res.status}` };
    }
    if (!data.health) {
      return { health: null, error: data?.error || "No health payload" };
    }
    return { health: data.health, error: null };
  } catch (e) {
    return { health: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function callToolInternal(
  tool: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const res = await fetch("/api/mcpilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
    cache: "no-store",
  });
  let data: Partial<CallResult> = {};
  try {
    data = await res.json();
  } catch {
    data = { error: "Non-JSON response from proxy" };
  }
  return {
    ok: data.ok ?? false,
    isError: data.isError ?? !res.ok,
    content: data.content ?? "",
    parsed: data.parsed ?? null,
    durationMs: data.durationMs ?? 0,
    status: data.status ?? res.status,
    tool: data.tool ?? tool,
    args: data.args ?? args,
    error: data.error,
    at: Date.now(),
  };
}

export const useMcpilot = create<McpilotState>((set, get) => ({
  health: null,
  healthLoading: false,
  healthError: null,

  selectedTool: null,

  calling: false,
  lastResult: null,
  history: [],

  fetchHealth: async () => {
    set({ healthLoading: true, healthError: null });
    const { health, error } = await fetchHealthInternal();
    set({ health, healthLoading: false, healthError: error });
  },

  selectTool: (name) => set({ selectedTool: name }),

  callTool: async (tool, args) => {
    set({ calling: true });
    try {
      const result = await callToolInternal(tool, args);
      set((s) => ({
        lastResult: result,
        history: [result, ...s.history].slice(0, 50),
        calling: false,
      }));
      return result;
    } catch (e) {
      const result: CallResult = {
        ok: false,
        isError: true,
        content: "",
        parsed: null,
        durationMs: 0,
        status: 0,
        tool,
        args,
        error: e instanceof Error ? e.message : String(e),
        at: Date.now(),
      };
      set((s) => ({
        lastResult: result,
        history: [result, ...s.history].slice(0, 50),
        calling: false,
      }));
      return result;
    }
  },

  clearHistory: () => set({ history: [], lastResult: null }),
}));
