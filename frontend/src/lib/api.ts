const BASE = "/api/v1/agent-eval";

export type Run = {
  run_id: string;
  task_id: string;
  status: "running" | "done" | "error" | string;
  steps_count: number;
  created_at: string;
  updated_at: string;
};

export type TrajectoryStep = {
  step_k: number;
  reasoning: string | null;
  tool_call: { name: string; kwargs: Record<string, unknown> };
  observation: Record<string, unknown>;
};

export type TrajectoryDetail = {
  run_id: string;
  task_id: string;
  steps_count: number;
  final_output: string | null;
  steps: TrajectoryStep[];
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  listRuns: (limit = 100) =>
    req<Run[]>(`/runs?limit=${limit}`),

  createRun: (task_id: string, run_id?: string) =>
    req<Run>("/runs", {
      method: "POST",
      body: JSON.stringify({ task_id, run_id }),
    }),

  getRun: (run_id: string) => req<Run>(`/runs/${run_id}`),

  deleteRun: (run_id: string) =>
    fetch(`${BASE}/runs/${run_id}`, { method: "DELETE" }),

  getTrajectory: (run_id: string) =>
    req<TrajectoryDetail>(`/runs/${run_id}/trajectory`),

  saveTrajectory: (run_id: string, trajectory_yaml: string) =>
    req<{ run_id: string; steps_count: number }>(`/runs/${run_id}/trajectory`, {
      method: "POST",
      body: JSON.stringify({ trajectory_yaml }),
    }),
};
