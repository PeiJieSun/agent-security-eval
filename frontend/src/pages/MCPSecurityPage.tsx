import { useState, useEffect, useCallback } from "react";
import { getActiveProfile } from "../lib/settings";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MCPScenario {
  scenario_id: string;
  name: string;
  description: string;
  attack_type: string;
  server_count: number;
  tool_count: number;
  poisoned_tools: number;
  user_instruction: string;
  benign_action: string;
  attack_goal: string;
  source_citation: string;
}

interface MCPResult {
  result_id: string;
  scenario_id: string;
  attack_type: string;
  verdict: "safe" | "compromised" | "error";
  attacked: boolean;
  benign_completed: boolean;
  agent_response: string;
  tool_calls_made: string[];
  attack_indicators_found: string[];
  model: string;
  created_at: string;
  error?: string;
}

interface MCPRun {
  run_id: string;
  status: string;
  total: number;
  done: number;
  compromised: number;   // precomputed count from DB row
  results: MCPResult[];
  created_at: string;
  error?: string;
}

const ATTACK_TYPE_LABELS: Record<string, string> = {
  tool_poisoning: "工具投毒",
  schema_injection: "Schema 注入",
  xserver_escalation: "跨服务器提权",
};

const API = "http://localhost:18002/api/v1/mcp-eval";

// ── Component ─────────────────────────────────────────────────────────────────

export default function MCPSecurityPage() {
  const [scenarios, setScenarios] = useState<MCPScenario[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentRun, setCurrentRun] = useState<MCPRun | null>(null);
  const [runs, setRuns] = useState<MCPRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [activeTab, setActiveTab] = useState<"scenarios" | "results" | "history">("scenarios");

  // ── Load scenarios ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${API}/scenarios`)
      .then((r) => r.json())
      .then(setScenarios)
      .catch(console.error);
    fetch(`${API}/runs`)
      .then((r) => r.json())
      .then(setRuns)
      .catch(console.error);
  }, []);

  // ── Polling ─────────────────────────────────────────────────────────────────

  const pollRun = useCallback((runId: string) => {
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`${API}/runs/${runId}`);
        const data: MCPRun = await r.json();
        setCurrentRun(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(interval);
          setPolling(false);
          setRuns((prev) => [data, ...prev.filter((x) => x.run_id !== runId)]);
        }
      } catch {
        clearInterval(interval);
        setPolling(false);
      }
    }, 2000);
  }, []);

  // ── Launch run ──────────────────────────────────────────────────────────────

  const launchRun = async () => {
    const profile = getActiveProfile();
    if (!profile?.apiKey) {
      alert("请先在「设置」页面配置 API Key");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        model: profile.model || "gpt-4o-mini",
        api_key: profile.apiKey,
        base_url: profile.baseUrl || "https://api.openai.com/v1",
      };
      if (selectedIds.size > 0) {
        body.scenario_ids = Array.from(selectedIds);
      }
      const r = await fetch(`${API}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      setCurrentRun({ ...data, results: [], created_at: new Date().toISOString() });
      setActiveTab("results");
      pollRun(data.run_id);
    } catch (e) {
      alert("启动失败: " + e);
    } finally {
      setLoading(false);
    }
  };

  // ── Toggle scenario selection ───────────────────────────────────────────────

  const toggleScenario = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(scenarios.map((s) => s.scenario_id)));
  const clearAll = () => setSelectedIds(new Set());

  // ── Render helpers ──────────────────────────────────────────────────────────

  const verdictBadge = (verdict: string) => {
    if (verdict === "compromised") return <span className="text-xs px-2 py-0.5 border border-red-400 text-red-500 rounded">已攻陷</span>;
    if (verdict === "safe") return <span className="text-xs px-2 py-0.5 border border-green-400 text-green-600 rounded">安全</span>;
    return <span className="text-xs px-2 py-0.5 border border-gray-300 text-gray-500 rounded">错误</span>;
  };

  const attackTypeBadge = (t: string) => (
    <span className="text-xs px-2 py-0.5 border border-gray-300 text-gray-500 rounded">
      {ATTACK_TYPE_LABELS[t] ?? t}
    </span>
  );

  const summaryStats = (results: MCPResult[]) => {
    const total = results.length;
    const compromised = results.filter((r) => r.verdict === "compromised").length;
    const safe = results.filter((r) => r.verdict === "safe").length;
    const asr = total > 0 ? ((compromised / total) * 100).toFixed(1) : "—";
    return { total, compromised, safe, asr };
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">MCP 安全测评</h1>
        <p className="text-sm text-gray-500 mt-1">
          测评 LLM Agent 对 MCP (Model Context Protocol) 工具投毒攻击的抵抗能力。
          参考：Invariant Labs MCP Security Advisory (Apr 2025)
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

      {/* Scenarios tab */}
      {activeTab === "scenarios" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-gray-500 hover:text-gray-800 underline">全选</button>
              <span className="text-gray-300">|</span>
              <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-800 underline">清除</button>
              {selectedIds.size > 0 && (
                <span className="text-xs text-gray-500">已选 {selectedIds.size} 个</span>
              )}
            </div>
            <button
              onClick={launchRun}
              disabled={loading || polling}
              className="px-4 py-1.5 text-sm border border-gray-800 text-gray-800 hover:bg-gray-800 hover:text-white rounded transition-colors disabled:opacity-40"
            >
              {loading || polling ? "运行中..." : `启动测评 (${selectedIds.size > 0 ? selectedIds.size : "全部"})`}
            </button>
          </div>

          <div className="divide-y divide-gray-100 border border-gray-200 rounded">
            {scenarios.map((s) => (
              <div
                key={s.scenario_id}
                onClick={() => toggleScenario(s.scenario_id)}
                className={`p-4 cursor-pointer transition-colors ${
                  selectedIds.has(s.scenario_id) ? "bg-gray-50" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.scenario_id)}
                      onChange={() => {}}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-900">{s.name}</span>
                        {attackTypeBadge(s.attack_type)}
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{s.description}</p>
                      <div className="text-xs text-gray-400 space-y-0.5">
                        <div><span className="font-medium text-gray-600">用户指令：</span>{s.user_instruction}</div>
                        <div><span className="font-medium text-gray-600">攻击目标：</span>{s.attack_goal}</div>
                        <div className="flex gap-4">
                          <span>{s.server_count} 服务器</span>
                          <span>{s.tool_count} 工具</span>
                          <span className="text-amber-600">{s.poisoned_tools} 已投毒</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-gray-300 shrink-0">{s.scenario_id}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 mt-3">
            来源：{scenarios[0]?.source_citation}
          </p>
        </div>
      )}

      {/* Results tab */}
      {activeTab === "results" && (
        <div>
          {!currentRun ? (
            <p className="text-sm text-gray-400">尚未运行任何测评。</p>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-sm font-medium text-gray-900">运行 {currentRun.run_id}</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 border rounded ${
                    currentRun.status === "done" ? "border-green-400 text-green-600"
                    : currentRun.status === "error" ? "border-red-400 text-red-500"
                    : "border-blue-400 text-blue-500"
                  }`}>{currentRun.status}</span>
                </div>
                <span className="text-sm text-gray-500">{currentRun.done} / {currentRun.total}</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-gray-100 rounded mb-4">
                <div
                  className="h-1.5 bg-gray-700 rounded transition-all"
                  style={{ width: `${currentRun.total > 0 ? (currentRun.done / currentRun.total) * 100 : 0}%` }}
                />
              </div>

              {/* Summary stats */}
              {currentRun.results.length > 0 && (() => {
                const { total, compromised, safe, asr } = summaryStats(currentRun.results);
                return (
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {[
                      { label: "已测场景", value: total },
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

              {/* Results list */}
              <div className="divide-y divide-gray-100 border border-gray-200 rounded">
                {currentRun.results.map((r) => (
                  <div key={r.result_id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {verdictBadge(r.verdict)}
                        {attackTypeBadge(r.attack_type)}
                        <span className="text-sm font-medium text-gray-900">{r.scenario_id}</span>
                      </div>
                      <span className="text-xs text-gray-400">{r.model}</span>
                    </div>
                    {r.attack_indicators_found.length > 0 && (
                      <div className="text-xs text-red-500 mb-1">
                        检测到攻击指标：{r.attack_indicators_found.join(", ")}
                      </div>
                    )}
                    {r.tool_calls_made.length > 0 && (
                      <div className="text-xs text-gray-400 mb-1">
                        工具调用：{r.tool_calls_made.join(" → ")}
                      </div>
                    )}
                    {r.agent_response && (
                      <details className="mt-1">
                        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                          查看 Agent 输出
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                          {r.agent_response}
                        </pre>
                      </details>
                    )}
                    {r.error && (
                      <p className="text-xs text-red-400">错误：{r.error}</p>
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

      {/* History tab */}
      {activeTab === "history" && (
        <div>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-400">暂无历史记录。</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded">
              {runs.map((r) => {
                const asr = r.total > 0 ? ((r.compromised / r.total) * 100).toFixed(1) : "—";
                return (
                  <div
                    key={r.run_id}
                    className="p-4 cursor-pointer hover:bg-gray-50"
                    onClick={async () => {
                      setActiveTab("results");
                      // Fetch full run with results from API
                      try {
                        const res = await fetch(`${API}/runs/${r.run_id}`);
                        const full = await res.json();
                        setCurrentRun(full);
                      } catch {
                        setCurrentRun(r);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{r.run_id}</span>
                        <span className={`text-xs px-2 py-0.5 border rounded ${
                          r.status === "done" ? "border-green-400 text-green-600"
                          : r.status === "error" ? "border-red-400 text-red-500"
                          : "border-blue-400 text-blue-500"
                        }`}>{r.status}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        <span>{r.total} 场景</span>
                        <span className="text-red-500">{r.compromised} 攻陷</span>
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
