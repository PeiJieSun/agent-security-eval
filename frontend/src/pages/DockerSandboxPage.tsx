import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SandboxScenario {
  spec_id: string;
  name: string;
  description: string;
  framework: string;
  tool_count: number;
  injectable_tools: number;
  attack_type: string;
  user_instruction: string;
  benign_success_check: string;
  attack_success_check: string;
  timeout_sec: number;
  network_disabled: boolean;
  tags: string[];
}

interface ToolCall {
  step: number;
  tool_name: string;
  arguments: Record<string, unknown>;
  response: string;
  injected: boolean;
}

interface SandboxResult {
  result_id: string;
  spec_id: string;
  framework: string;
  verdict: "safe" | "compromised" | "error" | "timeout";
  benign_completed: boolean;
  attacked: boolean;
  tool_calls: ToolCall[];
  final_output: string;
  container_id: string;
  duration_sec: number;
  model: string;
  created_at: string;
  error?: string;
}

interface SandboxRun {
  run_id: string;
  spec_ids: string[];
  status: string;
  total: number;
  done: number;
  results: SandboxResult[];
  created_at: string;
  model: string;
  use_docker: boolean;
}

const API = "http://localhost:18002/api/v1/sandbox";

interface EnvStatus {
  docker_cli: boolean;
  docker_version: string | null;
  daemon_running: boolean;
  runtime: string;
  image_present: boolean;
  image_tag: string;
  image_size: string | null;
  dockerfile_exists: boolean;
  build_context_path: string;
}

interface BuildStatus {
  status: "idle" | "running" | "done" | "error";
  mode: string;
  phase: string;
  message: string;
  log: string[];
  error: string;
  started_at: string;
}

const BUILD_PHASE_DEFS = [
  { id: "preparing",  label: "准备上下文", desc: "读取 sandbox/ Dockerfile" },
  { id: "resolving",  label: "解析基础镜像", desc: "FROM python:3.11-slim" },
  { id: "fetching",   label: "拉取基础层", desc: "下载 python:3.11-slim 层" },
  { id: "installing", label: "安装依赖",   desc: "pip install openai pydantic requests" },
  { id: "copying",    label: "拷贝脚本",   desc: "COPY sandbox_agent.py" },
  { id: "finishing",  label: "打标签",     desc: "agent-security-eval/sandbox:latest" },
  { id: "done",       label: "完成",       desc: "镜像已就绪" },
];

const FRAMEWORK_COLORS: Record<string, string> = {
  openai_agents: "bg-green-50 border-green-200 text-green-700",
  langchain:     "bg-blue-50 border-blue-200 text-blue-700",
  crewai:        "bg-purple-50 border-purple-200 text-purple-700",
  autogen:       "bg-yellow-50 border-yellow-200 text-yellow-700",
  custom:        "bg-gray-50 border-gray-200 text-gray-700",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DockerSandboxPage() {
  const [scenarios, setScenarios] = useState<SandboxScenario[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentRun, setCurrentRun] = useState<SandboxRun | null>(null);
  const [runs, setRuns] = useState<SandboxRun[]>([]);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [activeTab, setActiveTab] = useState<"scenarios" | "results" | "history">("scenarios");
  const [useDocker, setUseDocker] = useState(false);
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const [building, setBuilding] = useState(false);
  const buildLogRef = useRef<HTMLDivElement>(null);

  const refreshEnv = useCallback(() => {
    setEnvLoading(true);
    fetch(`${API}/env-status`)
      .then(r => r.json())
      .then((s: EnvStatus) => { setEnvStatus(s); setEnvLoading(false); })
      .catch(() => setEnvLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${API}/scenarios`).then((r) => r.json()).then(setScenarios).catch(console.error);
    fetch(`${API}/runs`).then((r) => r.json()).then(setRuns).catch(console.error);
    refreshEnv();
  }, [refreshEnv]);

  // Poll build status while building
  useEffect(() => {
    if (!building) return;
    const iv = setInterval(() => {
      fetch(`${API}/build-status`)
        .then(r => r.json())
        .then((p: BuildStatus) => {
          setBuildStatus(p);
          if (buildLogRef.current) buildLogRef.current.scrollTop = buildLogRef.current.scrollHeight;
          if (p.status === "done" || p.status === "error") {
            setBuilding(false);
            refreshEnv();
          }
        }).catch(() => {});
    }, 800);
    return () => clearInterval(iv);
  }, [building, refreshEnv]);

  const startBuild = async () => {
    setBuilding(true);
    setBuildStatus({ status: "running", mode: "build", phase: "preparing", message: "启动构建…", log: [], error: "", started_at: "" });
    await fetch(`${API}/build-image`, { method: "POST" });
  };

  const pollRun = useCallback((runId: string) => {
    setPolling(true);
    const interval = setInterval(async () => {
      const r = await fetch(`${API}/runs/${runId}`);
      const data: SandboxRun = await r.json();
      setCurrentRun(data);
      if (data.status === "done" || data.status === "error") {
        clearInterval(interval);
        setPolling(false);
        setRuns((prev) => [data, ...prev.filter((x) => x.run_id !== runId)]);
      }
    }, 2000);
  }, []);

  const launch = async () => {
    const profiles = JSON.parse(localStorage.getItem("llm_profiles") || "[]");
    const profile = profiles[0];
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        model: profile?.model || "gpt-4o-mini",
        api_key: profile?.apiKey || "",
        base_url: profile?.baseUrl || "https://api.openai.com/v1",
        use_docker: useDocker,
      };
      if (selectedIds.size > 0) body.spec_ids = Array.from(selectedIds);
      const r = await fetch(`${API}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: SandboxRun = await r.json();
      setCurrentRun(data);
      setActiveTab("results");
      pollRun(data.run_id);
    } catch (e) {
      alert("启动失败: " + e);
    } finally {
      setLoading(false);
    }
  };

  const toggleScenario = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const verdictBadge = (v: string) => {
    const styles: Record<string, string> = {
      compromised: "border-red-400 text-red-500",
      safe:        "border-green-400 text-green-600",
      error:       "border-gray-300 text-gray-500",
      timeout:     "border-yellow-400 text-yellow-600",
    };
    const labels: Record<string, string> = {
      compromised: "已攻陷", safe: "安全", error: "错误", timeout: "超时",
    };
    return (
      <span className={`text-xs px-2 py-0.5 border rounded ${styles[v] ?? "border-gray-200 text-gray-400"}`}>
        {labels[v] ?? v}
      </span>
    );
  };

  const stats = (results: SandboxResult[]) => {
    const total = results.length;
    const compromised = results.filter((r) => r.verdict === "compromised").length;
    const safe = results.filter((r) => r.verdict === "safe").length;
    const asr = total > 0 ? ((compromised / total) * 100).toFixed(1) : "—";
    return { total, compromised, safe, asr };
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Docker 沙箱评测</h1>
        <p className="text-sm text-gray-500 mt-1">
          在隔离容器中评测任意框架的 LLM Agent（OpenAI Agents SDK / LangChain / CrewAI / AutoGen / Custom）
          对 IPI 攻击的抵抗能力。当前运行：
          <span className={`ml-1 px-1.5 py-0.5 rounded text-xs font-medium ${
            useDocker ? "bg-green-100 text-green-700" : "bg-amber-50 text-amber-700"
          }`}>
            {useDocker ? "真实 Docker 模式" : "模拟模式"}
          </span>
        </p>
      </div>

      {/* ── Environment readiness panel ───────────────────────────────── */}
      <div className={`mb-6 rounded-xl border overflow-hidden ${
        envStatus?.image_present ? "border-emerald-200 bg-emerald-50/40" :
        envStatus?.daemon_running ? "border-amber-200 bg-amber-50/40" :
        "border-slate-200 bg-white"
      }`}>
        {/* Header bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-current/10">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            envStatus?.image_present ? "bg-emerald-500" :
            envStatus?.daemon_running ? "bg-amber-400 animate-pulse" :
            envLoading ? "bg-slate-300 animate-pulse" :
            "bg-red-400"
          }`} />
          <span className="text-sm font-bold text-slate-800">
            {envStatus?.image_present ? "沙箱环境就绪" :
             envStatus?.daemon_running ? "Docker 运行中，镜像未拉取" :
             envLoading ? "正在检测环境…" :
             "Docker 未就绪"}
          </span>
          {envStatus && (
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ml-auto ${
              envStatus.runtime === "orbstack"
                ? "bg-violet-50 border-violet-200 text-violet-700"
                : envStatus.runtime === "docker_desktop"
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-slate-50 border-slate-200 text-slate-500"
            }`}>
              {envStatus.runtime === "orbstack" ? "OrbStack ✓" :
               envStatus.runtime === "docker_desktop" ? "Docker Desktop" :
               envStatus.daemon_running ? envStatus.runtime : "runtime 未知"}
            </span>
          )}
          <button onClick={refreshEnv} className="ml-2 text-slate-400 hover:text-slate-700 text-xs transition-colors" title="刷新">↺</button>
        </div>

        {/* Status chips row */}
        <div className="flex items-center gap-3 px-5 py-3 flex-wrap">
          {[
            { label: "docker CLI", ok: envStatus?.docker_cli, detail: envStatus?.docker_version ? `v${envStatus.docker_version}` : undefined },
            { label: "daemon 运行", ok: envStatus?.daemon_running },
            { label: "镜像已拉取", ok: envStatus?.image_present, detail: envStatus?.image_size ?? undefined },
          ].map(chip => (
            <div key={chip.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs ${
              chip.ok === undefined
                ? "border-slate-200 text-slate-400 bg-white"
                : chip.ok
                ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                : "border-red-300 text-red-600 bg-red-50"
            }`}>
              <span className={`text-[10px] font-bold ${chip.ok === undefined ? "text-slate-300" : chip.ok ? "text-emerald-600" : "text-red-500"}`}>
                {chip.ok === undefined ? "?" : chip.ok ? "✓" : "✗"}
              </span>
              {chip.label}
              {chip.detail && <span className="font-mono text-[10px] opacity-70">({chip.detail})</span>}
            </div>
          ))}

          {/* Build button */}
          {envStatus?.daemon_running && !envStatus.image_present && !building && (
            <div className="ml-auto flex items-center gap-2">
              {envStatus.dockerfile_exists ? (
                <button
                  onClick={startBuild}
                  className="px-4 py-1.5 rounded-full bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <span>构建镜像</span>
                  <span className="text-slate-300">▶</span>
                </button>
              ) : (
                <span className="text-xs text-red-500">sandbox/Dockerfile 未找到</span>
              )}
              <span className="text-[10px] text-slate-400 font-mono">{envStatus.build_context_path?.split("/").slice(-2).join("/")}</span>
            </div>
          )}
          {building && (
            <span className="ml-auto text-xs text-amber-600 animate-pulse font-medium">构建中…</span>
          )}
          {envStatus?.image_present && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-emerald-700 font-medium">{envStatus.image_tag}</span>
              <button
                onClick={() => setUseDocker(u => !u)}
                className={`px-3 py-1 rounded-full border text-xs font-semibold transition-colors ${
                  useDocker
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-300 text-slate-600 hover:border-slate-500"
                }`}
              >
                {useDocker ? "真实沙箱 ON" : "开启真实沙箱"}
              </button>
            </div>
          )}
        </div>

        {/* Build progress animation */}
        {(building || buildStatus?.status === "done" || buildStatus?.status === "error") && buildStatus && (
          <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
            {/* Phase steps */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {BUILD_PHASE_DEFS.map((ph, i) => {
                const phases = BUILD_PHASE_DEFS.map(p => p.id);
                const curIdx = phases.indexOf(buildStatus.phase);
                const phIdx = phases.indexOf(ph.id);
                const isDone = buildStatus.status === "done" || phIdx < curIdx;
                const isActive = buildStatus.status === "running" && phIdx === curIdx;
                return (
                  <div key={ph.id} className="flex items-center gap-1.5 flex-shrink-0">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                      isDone   ? "bg-emerald-500 text-white" :
                      isActive ? "bg-amber-500 text-white animate-pulse" :
                      "bg-slate-100 text-slate-400"
                    }`}>
                      {isDone ? "✓" : isActive ? "▶" : i + 1}
                    </div>
                    <span className={`text-[11px] font-medium whitespace-nowrap ${
                      isDone ? "text-emerald-700" : isActive ? "text-amber-700" : "text-slate-400"
                    }`}>{ph.label}</span>
                    {i < BUILD_PHASE_DEFS.length - 1 && (
                      <div className={`w-6 h-px flex-shrink-0 ${isDone ? "bg-emerald-300" : "bg-slate-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Current message */}
            <p className={`text-xs font-mono rounded px-3 py-2 ${
              buildStatus.status === "error" ? "bg-red-50 text-red-700" :
              buildStatus.status === "done"  ? "bg-emerald-50 text-emerald-700" :
              "bg-slate-50 text-slate-700"
            }`}>
              {buildStatus.message || "…"}
            </p>

            {/* Scrollable build log */}
            {buildStatus.log.length > 0 && (
              <div ref={buildLogRef} className="bg-slate-900 rounded-lg p-3 max-h-48 overflow-y-auto overscroll-contain">
                {buildStatus.log.map((line, i) => (
                  <p key={i} className={`text-[10px] font-mono leading-5 ${
                    line.includes("Successfully") ? "text-emerald-400 font-bold" :
                    line.includes("RUN") || line.includes("pip") ? "text-amber-300" :
                    line.includes("COPY") || line.includes("FROM") ? "text-blue-300" :
                    line.includes("Error") || line.includes("error") ? "text-red-400" :
                    "text-slate-400"
                  }`}>{line}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-gray-200 mb-6">
        {(["scenarios", "results", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-gray-800 text-gray-900"
                : "border-transparent text-gray-400 hover:text-gray-700"
            }`}
          >
            {tab === "scenarios" ? `场景库 (${scenarios.length})` : tab === "results" ? "当前运行" : "历史记录"}
          </button>
        ))}
      </div>

      {/* Scenarios */}
      {activeTab === "scenarios" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="flex gap-2 text-xs">
                <button onClick={() => setSelectedIds(new Set(scenarios.map((s) => s.spec_id)))}
                  className="text-gray-500 hover:text-gray-800 underline">全选</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => setSelectedIds(new Set())}
                  className="text-gray-500 hover:text-gray-800 underline">清除</button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useDocker}
                  onChange={(e) => setUseDocker(e.target.checked)}
                  className="rounded"
                />
                真实 Docker（需要 daemon）
              </label>
            </div>
            <button
              onClick={launch}
              disabled={loading || polling}
              className="px-4 py-1.5 text-sm border border-gray-800 text-gray-800 hover:bg-gray-800 hover:text-white rounded transition-colors disabled:opacity-40"
            >
              {loading || polling ? "运行中..." : `启动 (${selectedIds.size > 0 ? selectedIds.size : "全部"})`}
            </button>
          </div>

          <div className="divide-y divide-gray-100 border border-gray-200 rounded">
            {scenarios.map((s) => (
              <div
                key={s.spec_id}
                onClick={() => toggleScenario(s.spec_id)}
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.spec_id)}
                    onChange={() => {}}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{s.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 border rounded ${
                        FRAMEWORK_COLORS[s.framework] ?? "border-gray-200 text-gray-500"
                      }`}>{s.framework}</span>
                      <span className="text-xs px-1.5 py-0.5 border border-gray-200 text-gray-400 rounded">
                        {s.attack_type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{s.description}</p>
                    <div className="text-xs text-gray-400 space-y-0.5">
                      <div><span className="font-medium text-gray-500">指令：</span>{s.user_instruction}</div>
                      <div className="flex gap-4">
                        <span>{s.tool_count} 工具</span>
                        <span className="text-amber-600">{s.injectable_tools} 含注入</span>
                        <span>{s.network_disabled ? "网络隔离" : "有网络"}</span>
                        <span>超时 {s.timeout_sec}s</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Architecture diagram — reacts to useDocker / polling / currentRun */}
          {(() => {
            const isReal    = useDocker && !!envStatus?.image_present;
            const isRunning = polling;
            const lastResult = currentRun?.results?.slice(-1)[0];
            const verdict = currentRun?.status === "done" ? (
              currentRun.results.some(r => r.verdict === "compromised") ? "compromised" : "safe"
            ) : null;

            return (
              <div className={`mt-6 rounded-xl border p-6 overflow-hidden transition-all duration-500 ${
                isReal
                  ? "border-blue-300 bg-gradient-to-br from-blue-50/60 to-slate-50"
                  : "border-slate-200 bg-slate-50"
              }`}>
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 tracking-wide">沙箱执行架构 (M5-1)</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      isRunning
                        ? "border-amber-300 text-amber-700 bg-amber-50 animate-pulse"
                        : isReal
                        ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                        : "border-slate-300 text-slate-500 bg-white"
                    }`}>
                      {isRunning ? "运行中" : isReal ? "真实沙箱" : "模拟模式"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {isReal && (
                      <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">DOCKER_AVAILABLE=true</span>
                    )}
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${
                      isReal
                        ? "text-blue-600 bg-blue-50 border-blue-200"
                        : "text-slate-400 bg-white border-slate-200"
                    }`}>
                      {isReal ? "agent-security-eval/sandbox:latest" : "mock runner"}
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <div className="flex items-center gap-4 lg:gap-8">

                    {/* ── Agent Container ── */}
                    {/* Wrap in isolation boundary when real Docker */}
                    <div className="relative">
                      {isReal && (
                        <div className={`absolute -inset-3 rounded-2xl border-2 border-dashed transition-colors ${
                          isRunning ? "border-blue-400" : "border-blue-300"
                        }`}>
                          <span className="absolute -top-2.5 left-3 text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-50 px-1.5">
                            Docker 隔离边界
                          </span>
                        </div>
                      )}
                      <div className={`w-[152px] rounded-xl shadow-sm p-5 text-center z-10 relative transition-all ${
                        isReal
                          ? isRunning
                            ? "bg-blue-50 border-2 border-blue-400"
                            : "bg-white border-2 border-blue-300"
                          : "bg-white border border-slate-200 opacity-70"
                      }`}>
                        <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-3 relative ${
                          isReal ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"
                        }`}>
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {isRunning && (
                            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full animate-ping" />
                          )}
                        </div>
                        <p className={`text-sm font-bold ${isReal ? "text-blue-800" : "text-slate-400"}`}>
                          {isReal ? "Agent 容器" : "Agent (Mock)"}
                        </p>
                        <p className={`text-[10px] mt-1 font-mono rounded border py-0.5 ${
                          isReal
                            ? "text-blue-600 bg-blue-50 border-blue-200"
                            : "text-slate-400 bg-slate-50 border-slate-200"
                        }`}>
                          {isReal ? "--network=none" : "本进程模拟"}
                        </p>
                      </div>
                    </div>

                    {/* ── JSON-RPC connector ── */}
                    <div className="flex-1 flex flex-col items-center justify-center relative py-1">
                      <div className={`w-full absolute top-1/2 left-0 -mt-px border-t-2 transition-all ${
                        isRunning ? "border-amber-400 border-solid" : "border-slate-300 border-dashed"
                      } ${isRunning ? "opacity-100" : "opacity-60"}`} />
                      {isRunning && (
                        <div className="w-full absolute top-1/2 left-0 -mt-px overflow-hidden">
                          <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-[slide_1.2s_linear_infinite] w-1/3" />
                        </div>
                      )}
                      <span className={`text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest z-10 relative mb-1 ${
                        isRunning
                          ? "bg-amber-50 text-amber-600 border border-amber-200"
                          : "bg-slate-100 text-slate-400"
                      }`}>JSON-RPC</span>
                      <div className="w-full flex justify-between px-2 z-10 relative">
                        <span className={`text-[10px] px-1 ${isRunning ? "text-amber-500 bg-amber-50" : "text-slate-400 bg-slate-50"}`}>◀ 结果</span>
                        <span className={`text-[10px] px-1 ${isRunning ? "text-amber-500 bg-amber-50" : "text-slate-400 bg-slate-50"}`}>工具 ▶</span>
                      </div>
                    </div>

                    {/* ── Tool Server ── */}
                    <div className={`w-[180px] rounded-xl shadow-sm p-5 text-center z-10 relative transition-all ${
                      isRunning
                        ? "bg-amber-50 border-2 border-amber-400"
                        : "bg-white border border-amber-200"
                    }`}>
                      <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-3 ${
                        isRunning ? "bg-amber-100 text-amber-600" : "bg-amber-50 text-amber-400"
                      }`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                        </svg>
                      </div>
                      <p className={`text-sm font-bold ${isRunning ? "text-amber-800" : "text-slate-600"}`}>拦截与注入</p>
                      <p className="text-[11px] text-slate-500 mt-1 font-mono">Host Tool Server</p>
                      <div className="absolute -bottom-10 left-1/2 -ml-px w-px h-10 border-l-2 border-dotted border-slate-300 z-0" />
                      <div className="absolute -bottom-6 left-1/2 ml-2 text-[10px] font-bold text-slate-400 z-10 whitespace-nowrap">轨迹日志 ↓</div>
                    </div>
                  </div>

                  {/* ── Oracle / Verdict ── */}
                  <div className="mt-10 flex justify-end">
                    <div className={`w-[280px] rounded-xl shadow-lg p-4 flex items-center gap-4 relative z-10 transition-all ${
                      verdict === "compromised"
                        ? "bg-red-900 border border-red-700"
                        : verdict === "safe"
                        ? "bg-emerald-900 border border-emerald-700"
                        : isRunning
                        ? "bg-slate-800 border border-amber-700"
                        : "bg-slate-800 border border-slate-700"
                    }`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        verdict === "compromised" ? "bg-red-700" :
                        verdict === "safe"        ? "bg-emerald-700" :
                        isRunning                 ? "bg-amber-700" :
                        "bg-slate-700"
                      }`}>
                        {verdict === "compromised" ? (
                          <svg className="w-5 h-5 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        ) : verdict === "safe" ? (
                          <svg className="w-5 h-5 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        ) : isRunning ? (
                          <svg className="w-5 h-5 text-amber-300 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        ) : (
                          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-200">轨迹判定 (Oracle)</p>
                        <p className={`text-[11px] mt-0.5 font-mono ${
                          verdict === "compromised" ? "text-red-400" :
                          verdict === "safe"        ? "text-emerald-400" :
                          isRunning                 ? "text-amber-400 animate-pulse" :
                          "text-slate-400"
                        }`}>
                          {verdict === "compromised"
                            ? `已攻陷 ${currentRun?.results.filter(r=>r.verdict==="compromised").length}/${currentRun?.total}`
                            : verdict === "safe"
                            ? `全部安全 (${currentRun?.total} 场景)`
                            : isRunning
                            ? `判定中… ${currentRun?.done ?? 0}/${currentRun?.total ?? "?"}`
                            : "verdict: safe | compromised"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer note */}
                <div className="mt-6 pt-5 border-t border-slate-200 flex items-start gap-3">
                  <svg className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div>
                    <p className="text-xs text-slate-600 font-medium">使用说明与权限 (OrbStack 支持)</p>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      沙箱依赖本机 <code className="bg-white border px-1 rounded">docker</code> 命令行工具。由于您使用 OrbStack，它已自动接管 Docker 进程，因此<strong>无需额外配置权限</strong>，保持 OrbStack 后台运行即可。若需开启真实测试，请先构建沙箱镜像，并在启动后端时注入环境变量开启实体沙箱。
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Results */}
      {activeTab === "results" && (
        <div>
          {!currentRun ? (
            <p className="text-sm text-gray-400">尚未运行任何评测。</p>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-medium text-gray-900">{currentRun.run_id}</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 border rounded ${
                    currentRun.status === "done" ? "border-green-400 text-green-600"
                    : "border-blue-400 text-blue-500"
                  }`}>{currentRun.status}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {currentRun.use_docker ? "Docker 模式" : "模拟模式"}
                  </span>
                </div>
                <span className="text-sm text-gray-500">{currentRun.done}/{currentRun.total}</span>
              </div>

              <div className="w-full h-1.5 bg-gray-100 rounded mb-4">
                <div
                  className="h-1.5 bg-gray-700 rounded transition-all"
                  style={{ width: `${currentRun.total > 0 ? (currentRun.done / currentRun.total) * 100 : 0}%` }}
                />
              </div>

              {currentRun.results.length > 0 && (() => {
                const { total, compromised, safe, asr } = stats(currentRun.results);
                return (
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {[
                      { label: "已测", value: total },
                      { label: "已攻陷", value: compromised },
                      { label: "安全", value: safe },
                      { label: "ASR", value: `${asr}%` },
                    ].map((m) => (
                      <div key={m.label} className="border border-gray-200 rounded p-3 text-center">
                        <div className="text-lg font-semibold text-gray-900">{m.value}</div>
                        <div className="text-xs text-gray-400">{m.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="divide-y divide-gray-100 border border-gray-200 rounded">
                {currentRun.results.map((r) => (
                  <div key={r.result_id}>
                    <div
                      className="p-4 cursor-pointer hover:bg-gray-50"
                      onClick={() => setExpandedResult(expandedResult === r.result_id ? null : r.result_id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {verdictBadge(r.verdict)}
                          <span className="text-xs px-1.5 py-0.5 border border-gray-200 text-gray-400 rounded">
                            {r.framework}
                          </span>
                          <span className="text-sm font-medium text-gray-900">{r.spec_id}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>{r.tool_calls.length} 次调用</span>
                          <span>{r.duration_sec}s</span>
                          <span>{expandedResult === r.result_id ? "▲" : "▼"}</span>
                        </div>
                      </div>
                    </div>

                    {expandedResult === r.result_id && (
                      <div className="px-4 pb-4 space-y-2">
                        {/* Tool call sequence */}
                        {r.tool_calls.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">工具调用序列</p>
                            <div className="space-y-1">
                              {r.tool_calls.map((tc) => (
                                <div key={tc.step}
                                  className={`flex items-start gap-2 p-2 rounded text-xs ${
                                    tc.injected ? "bg-amber-50 border border-amber-100"
                                    : "bg-gray-50 border border-gray-100"
                                  }`}
                                >
                                  <span className="text-gray-400 shrink-0">#{tc.step}</span>
                                  <span className="font-medium text-gray-700">{tc.tool_name}</span>
                                  {tc.injected && (
                                    <span className="text-amber-600">← 含注入</span>
                                  )}
                                  <span className="text-gray-400 truncate">{tc.response.slice(0, 100)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Final output */}
                        {r.final_output && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Agent 输出</p>
                            <p className="text-xs bg-gray-50 border border-gray-100 rounded p-2 text-gray-600">
                              {r.final_output}
                            </p>
                          </div>
                        )}

                        {r.error && (
                          <p className="text-xs text-red-400">错误：{r.error}</p>
                        )}
                        <p className="text-xs text-gray-300">Container: {r.container_id}</p>
                      </div>
                    )}
                  </div>
                ))}
                {currentRun.results.length === 0 && (
                  <div className="p-6 text-center text-sm text-gray-400">等待结果...</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {activeTab === "history" && (
        <div>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-400">暂无历史记录。</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded">
              {runs.map((r) => {
                const { total, compromised, asr } = stats(r.results);
                return (
                  <div
                    key={r.run_id}
                    className="p-4 cursor-pointer hover:bg-gray-50"
                    onClick={() => { setCurrentRun(r); setActiveTab("results"); }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{r.run_id}</span>
                        <span className="text-xs text-gray-400">
                          {r.use_docker ? "Docker" : "模拟"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 flex gap-4">
                        <span>{total} 场景</span>
                        <span className="text-red-400">{compromised} 攻陷</span>
                        <span>ASR {asr}%</span>
                        <span>{new Date(r.created_at).toLocaleString("zh-CN")}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
