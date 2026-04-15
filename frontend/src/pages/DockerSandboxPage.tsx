import { useState, useEffect, useCallback } from "react";

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

  useEffect(() => {
    fetch(`${API}/scenarios`).then((r) => r.json()).then(setScenarios).catch(console.error);
    fetch(`${API}/runs`).then((r) => r.json()).then(setRuns).catch(console.error);
  }, []);

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

          {/* Architecture note */}
          <div className="mt-6 border border-slate-200 rounded-xl bg-slate-50 p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-8">
              <p className="text-sm font-bold text-slate-800 tracking-wide">沙箱执行架构 (M5-1)</p>
              <div className="flex gap-2">
                <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">DOCKER_AVAILABLE=true</span>
                <span className="text-[10px] font-mono text-slate-500 bg-white border border-slate-200 px-2 py-1 rounded">agent-security-eval/sandbox:latest</span>
              </div>
            </div>

            <div className="relative">
              {/* Flow diagram */}
              <div className="flex items-center gap-4 lg:gap-8">
                {/* Agent */}
                <div className="w-[160px] bg-white border border-blue-200 rounded-xl shadow-sm p-5 text-center z-10">
                  <div className="w-12 h-12 mx-auto bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  </div>
                  <p className="text-sm font-bold text-slate-700">Agent 容器</p>
                  <p className="text-[11px] text-slate-500 mt-1 font-mono bg-slate-50 rounded border py-0.5">--network=none</p>
                </div>

                {/* JSON-RPC */}
                <div className="flex-1 flex flex-col items-center justify-center relative">
                  <div className="w-full absolute top-1/2 left-0 -mt-px border-t border-slate-300 border-dashed" />
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-3 py-1 rounded-full uppercase tracking-widest z-10 relative mb-1">JSON-RPC</span>
                  <div className="w-full flex justify-between px-2 text-slate-400 z-10 relative">
                     <span className="text-[10px] bg-slate-50 px-1">◀ 结果</span>
                     <span className="text-[10px] bg-slate-50 px-1">工具 ▶</span>
                  </div>
                </div>

                {/* Tool Server */}
                <div className="w-[180px] bg-white border border-amber-200 rounded-xl shadow-sm p-5 text-center z-10 relative">
                  <div className="w-12 h-12 mx-auto bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
                  </div>
                  <p className="text-sm font-bold text-slate-700">拦截与注入</p>
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">Host Tool Server</p>
                  
                  {/* Arrow down to recorder */}
                  <div className="absolute -bottom-10 left-1/2 -ml-px w-px h-10 border-l-2 border-slate-300 border-dotted z-0" />
                  <div className="absolute -bottom-6 left-1/2 ml-2 text-[10px] font-bold text-slate-400 z-10">轨迹日志 ↓</div>
                </div>
              </div>

              {/* Trajectory */}
              <div className="mt-10 flex justify-end">
                <div className="w-[260px] bg-slate-800 text-white rounded-xl shadow-lg p-4 flex items-center gap-4 relative z-10">
                  <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-200">轨迹判定 (Oracle)</p>
                    <p className="text-[11px] text-emerald-400 mt-0.5 font-mono">verdict: safe | compromised</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-200 flex items-start gap-3">
              <svg className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div>
                <p className="text-xs text-slate-600 font-medium">使用说明与权限 (OrbStack 支持)</p>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  沙箱依赖本机 <code className="bg-white border px-1 rounded">docker</code> 命令行工具。由于您使用 OrbStack，它已自动接管 Docker 进程，因此<strong>无需额外配置权限</strong>，保持 OrbStack 后台运行即可。若需开启真实测试，请先拉取或构建沙箱镜像，并在启动后端时注入环境变量开启实体沙箱。
                </p>
              </div>
            </div>
          </div>
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
