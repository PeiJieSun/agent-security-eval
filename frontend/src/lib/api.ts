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

export type InjectionStyle = "naive" | "camouflaged" | "authority" | "encoded" | "chinese_obfuscated";

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
  eval_type: string;
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

  // M2-2: PoT Backdoor
  listPotTasks: () => req<{ task_id: string; description: string; trigger_phrase: string; expected_backdoor_action: string }[]>("/safety-evals/pot-backdoor/tasks"),
  createPotBackdoor: (body: { task_id?: string; model?: string; api_key?: string; base_url?: string }) =>
    req<SafetyEval>("/safety-evals/pot-backdoor", { method: "POST", body: JSON.stringify(body) }),

  // M2-3: Tool Call Graph
  getToolCallGraph: () => req<{
    nodes: { id: string; count: number; is_high_risk: boolean }[];
    edges: { from_tool: string; to_tool: string; weight: number; transition_rate: number }[];
    top_paths: string[][];
    risk_coverage: number;
    total_trajectories: number;
    unique_tools: number;
    high_risk_tools_found: string[];
    summary: string;
  }>("/tool-call-graph"),

  // M2-4: Evolutionary Attack
  listEvoTasks: () => req<{ task_id: string; description: string }[]>("/safety-evals/evo-attack/tasks"),
  createEvoAttack: (body: { task_id?: string; n_generations?: number; model?: string; api_key?: string; base_url?: string }) =>
    req<SafetyEval>("/safety-evals/evo-attack", { method: "POST", body: JSON.stringify(body) }),

  // Batch eval
  listBatches: () => req<{
    batch_id: string; model: string; status: string;
    total: number; done_count: number; failed_count: number;
    created_at: string; updated_at: string;
    config: { domains?: string[]; injection_styles?: string[]; task_ids?: string[] };
  }[]>("/batch-evals"),
  getBatch: (batch_id: string) => req<{
    batch_id: string; model: string; status: string;
    total: number; done_count: number; failed_count: number;
    created_at: string; updated_at: string;
    config: { domains?: string[]; injection_styles?: string[]; task_ids?: string[] };
  }>(`/batch-evals/${batch_id}`),
  createBatch: (body: {
    domains?: string[]; injection_styles?: string[]; task_ids?: string[];
    model?: string; api_key?: string; base_url?: string;
  }) => req<{ batch_id: string; status: string; total: number; done_count: number; failed_count: number }>(
    "/batch-evals", { method: "POST", body: JSON.stringify(body) }
  ),
  cancelBatch: (batch_id: string) =>
    req<{ batch_id: string; status: string }>(`/batch-evals/${batch_id}`, { method: "DELETE" }),
  getBatchEvals: (batch_id: string) => req<{
    total: number;
    with_report: number;
    summary: { benign_utility: number; utility_under_attack: number; targeted_asr: number };
    evals: {
      eval_id: string; task_id: string; model: string; status: string; created_at: string;
      domain: string; description: string; attack_type: string;
      benign_utility: number | null; utility_under_attack: number | null; targeted_asr: number | null;
      injection_style: string | null;
    }[];
  }>(`/batch-evals/${batch_id}/evals`),

  // M3-3: Release Gate
  getReleaseGate: (eval_id: string) =>
    req<{ passed: boolean; eval_id: string; task_id: string; model: string; benign_utility: number; targeted_asr: number; utility_under_attack: number; failed_criteria: string[]; summary: string }>(`/release-gate/${eval_id}`),
  listReleaseHistory: () =>
    req<{ eval_id: string; task_id: string; model: string; created_at: string; benign_utility: number; targeted_asr: number; utility_under_attack: number }[]>("/release-history"),

  // M3-5: Behavior Trend
  getBehaviorTrend: (task_id: string) =>
    req<{ task_id: string; snapshot_count: number; snapshots: { eval_id: string; created_at: string; benign_utility: number; targeted_asr: number; utility_under_attack: number; tool_dist: Record<string, number> }[]; drift_detected: boolean; drift_score: number; kl_divergence: number; asr_slope: number; utility_slope: number; summary: string }>(`/behavior-trend/${task_id}`),
  listBehaviorTasks: () => req<{ task_id: string; snapshot_count: number }[]>("/behavior-trend/tasks"),

  // Backend settings persistence
  getSettings: () => req<{ api_key_masked: string; api_key_set: boolean; base_url: string; model: string }>("/settings"),
  updateSettings: (body: { api_key?: string; base_url?: string; model?: string }) =>
    req<{ api_key_masked: string; api_key_set: boolean; base_url: string; model: string }>(
      "/settings", { method: "PUT", body: JSON.stringify(body) }
    ),
};
