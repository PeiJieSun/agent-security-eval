const BASE = "/api/v1/agent-eval";

// ── Trajectory types (existing) ───────────────────────────────────────────

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

// ── Eval types (new) ──────────────────────────────────────────────────────

export type EvalStatus = "pending" | "running" | "done" | "error";

export type Eval = {
  eval_id: string;
  task_id: string;
  model: string;
  status: EvalStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type MetricResult = {
  id: string;
  name: string;
  value: number;
  numerator: number;
  denominator: number;
  source: string;
  arxiv_id: string;
  definition: string;
  notes: string | null;
};

export type InjectionStyle = "naive" | "camouflaged" | "authority" | "encoded";

export type EvalReport = {
  eval_id: string;
  task_id: string;
  model: string;
  injection_style: InjectionStyle;
  benign_utility: MetricResult;
  utility_under_attack: MetricResult;
  targeted_asr: MetricResult;
  asr_valid: MetricResult;
  robustness_delta: number;
  benign_trajectory_id: string;
  attack_trajectory_id: string;
  output_is_valid: boolean;
};

export type MetricStandard = {
  id: string;
  name: string;
  definition: string;
  source: string;
  authors: string;
  venue: string;
  arxiv_id: string;
  url: string;
  bibtex: string;
};

export type TaskInfo = {
  task_id: string;
  description: string;
  attack_type: string;
  tags: string[];
  environment_type: string;
  injection_style?: InjectionStyle;
  user_instruction?: string;
  attack_payload?: string;
  attack_target_tool?: string;
  benign_success_expr?: string;
  attack_success_expr?: string;
  inbox_preview?: Array<{ sender: string; subject: string; body: string }>;
};

export type CreateEvalRequest = {
  task_id: string;
  model?: string;
  api_key?: string;
  base_url?: string;
};

export type SafetyEval = {
  safety_id: string;
  eval_type: "consistency" | "eval_awareness" | "cot_audit" | "backdoor_scan";
  task_id: string;
  model: string;
  status: "pending" | "running" | "done" | "error";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type ConsistencyTaskInfo = {
  task_id: string;
  variant_count: number;
  variants: Array<{ id: string; instruction: string }>;
};

export type SafetyStandard = {
  id: string;
  eval_type: string;
  name: string;
  name_en: string;
  milestone: string;
  definition: string;
  definition_zh: string;
  source: string;
  source_full: string;
  authors: string;
  venue: string;
  arxiv_id: string;
  url: string;
  url_secondary?: string;
  verbatim_quote: string;
  bibtex: string;
  threshold: string;
  tags: string[];
};

// ── HTTP helper ───────────────────────────────────────────────────────────

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── API client ────────────────────────────────────────────────────────────

export const api = {
  // Runs (legacy trajectory recording)
  listRuns: (limit = 100) => req<Run[]>(`/runs?limit=${limit}`),
  createRun: (task_id: string, run_id?: string) =>
    req<Run>("/runs", { method: "POST", body: JSON.stringify({ task_id, run_id }) }),
  getRun: (run_id: string) => req<Run>(`/runs/${run_id}`),
  deleteRun: (run_id: string) => fetch(`${BASE}/runs/${run_id}`, { method: "DELETE" }),
  getTrajectory: (run_id: string) => req<TrajectoryDetail>(`/runs/${run_id}/trajectory`),
  getTrajectoryDirect: (traj_id: string) => req<TrajectoryDetail>(`/trajectories/${traj_id}`),
  saveTrajectory: (run_id: string, trajectory_yaml: string) =>
    req<{ run_id: string; steps_count: number }>(`/runs/${run_id}/trajectory`, {
      method: "POST",
      body: JSON.stringify({ trajectory_yaml }),
    }),

  // Evals (new)
  listEvals: (limit = 50) => req<Eval[]>(`/evals?limit=${limit}`),
  createEval: (body: CreateEvalRequest) =>
    req<Eval>("/evals", { method: "POST", body: JSON.stringify(body) }),
  getEval: (eval_id: string) => req<Eval>(`/evals/${eval_id}`),
  deleteEval: (eval_id: string) => req<void>(`/evals/${eval_id}`, { method: "DELETE" }),
  getReport: (eval_id: string) => req<EvalReport>(`/evals/${eval_id}/report`),

  // Standards
  getMetricStandards: () => req<MetricStandard[]>("/metric-standards"),

  // Tasks
  listTasks: () => req<TaskInfo[]>("/tasks"),
  getTask: (task_id: string) => req<TaskInfo>(`/tasks/${task_id}`),

  // Connection test
  testConnection: (body: { api_key?: string; base_url?: string; model?: string }) =>
    req<{ ok: boolean; model?: string; latency_ms?: number; reply?: string; error?: string }>(
      "/test-connection",
      { method: "POST", body: JSON.stringify(body) }
    ),

  // Safety evals (M1-6, M2-5, M2-6, M2-7)
  listSafetyEvals: (eval_type?: string, limit = 50) =>
    req<SafetyEval[]>(`/safety-evals${eval_type ? `?eval_type=${eval_type}&` : "?"}limit=${limit}`),
  getSafetyEval: (safety_id: string) => req<SafetyEval>(`/safety-evals/${safety_id}`),
  getSafetyResult: (safety_id: string) => req<Record<string, unknown>>(`/safety-evals/${safety_id}/result`),
  deleteSafetyEval: (safety_id: string) => req<void>(`/safety-evals/${safety_id}`, { method: "DELETE" }),
  createConsistencyEval: (body: { task_id?: string; model?: string; api_key?: string; base_url?: string }) =>
    req<SafetyEval>("/safety-evals/consistency", { method: "POST", body: JSON.stringify(body) }),
  createEvalAwareness: (body: { task_id: string; n_runs?: number; model?: string; api_key?: string; base_url?: string }) =>
    req<SafetyEval>("/safety-evals/eval-awareness", { method: "POST", body: JSON.stringify(body) }),
  createCoTAudit: (body: { trajectory_id: string; task_id: string; model?: string; api_key?: string; base_url?: string }) =>
    req<SafetyEval>("/safety-evals/cot-audit", { method: "POST", body: JSON.stringify(body) }),
  createBackdoorScan: (body: { task_id: string; trigger_ids?: string[]; model?: string; api_key?: string; base_url?: string }) =>
    req<SafetyEval>("/safety-evals/backdoor-scan", { method: "POST", body: JSON.stringify(body) }),
  listConsistencyTasks: () => req<ConsistencyTaskInfo[]>("/safety-evals/consistency-tasks/list"),

  // Safety standards citation registry
  getSafetyStandards: () => req<SafetyStandard[]>("/safety-evals/standards"),
};
