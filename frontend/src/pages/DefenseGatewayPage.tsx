import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "../components/AppShell";

const API = "/api/v1/agent-eval/defense";

const CAT_COLORS: Record<string, string> = {
  sanitize: "bg-blue-100 text-blue-700",
  permission: "bg-red-100 text-red-700",
  rate_limit: "bg-amber-100 text-amber-700",
  memory: "bg-purple-100 text-purple-700",
  kill_switch: "bg-red-200 text-red-900",
};

interface Policy {
  rule_id: string; name: string; category: string; trigger: string;
  action: string; reason: string; enabled: boolean; source: string; config: Record<string, unknown>;
}
interface LogEntry {
  timestamp: string; policy_rule_id: string; tool_name: string;
  action_taken: string; detail: string;
}
interface Status {
  active: boolean; policy_count: number; total_intercepted: number;
  total_passed: number; kill_switch_triggered: boolean;
}
interface SimResult {
  allowed: boolean; reason: string; original_response: string;
  sanitized_response: string; was_modified: boolean;
}

export default function DefenseGatewayPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [simTool, setSimTool] = useState("");
  const [simArgs, setSimArgs] = useState("{}");
  const [simResp, setSimResp] = useState("");
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [genLoading, setGenLoading] = useState(false);

  const refresh = useCallback(async () => {
    const [s, p, l] = await Promise.all([
      fetch(`${API}/status`).then(r => r.json()),
      fetch(`${API}/policies`).then(r => r.json()),
      fetch(`${API}/log?limit=50`).then(r => r.json()),
    ]);
    setStatus(s); setPolicies(p); setLogs(l);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async () => {
    await fetch(`${API}/${status?.active ? "deactivate" : "activate"}`, { method: "POST" });
    refresh();
  };

  const togglePolicy = async (ruleId: string) => {
    await fetch(`${API}/policies/${ruleId}/toggle`, { method: "PUT" });
    refresh();
  };

  const deletePolicy = async (ruleId: string) => {
    if (!confirm(`删除策略 ${ruleId}？`)) return;
    await fetch(`${API}/policies/${ruleId}`, { method: "DELETE" });
    refresh();
  };

  const generateFromTcg = async () => {
    setGenLoading(true);
    try {
      await fetch(`${API}/generate-from-tcg`, { method: "POST" });
      refresh();
    } finally { setGenLoading(false); }
  };

  const simulate = async () => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(simArgs); } catch { /* keep empty */ }
    const res = await fetch(`${API}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_name: simTool, arguments: args, response_text: simResp }),
    });
    setSimResult(await res.json());
    refresh();
  };

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader title="安全网关" subtitle="运行时防御层 — 拦截、净化、频率限制、Kill Switch" />

      {/* ── Status Card ── */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${status?.active ? "bg-emerald-500" : "bg-slate-300"}`} />
            <span className="text-sm font-medium text-slate-700">{status?.active ? "已激活" : "未激活"}</span>
          </div>
          <Stat label="已拦截" value={status?.total_intercepted ?? 0} color="text-red-600" />
          <Stat label="已放行" value={status?.total_passed ?? 0} color="text-emerald-600" />
          <Stat label="策略数" value={status?.policy_count ?? 0} color="text-slate-600" />
          {status?.kill_switch_triggered && (
            <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded">KILL SWITCH</span>
          )}
        </div>
        <button onClick={toggle}
          className={`text-xs font-medium px-4 py-1.5 rounded transition-colors ${status?.active ? "bg-slate-200 text-slate-700 hover:bg-slate-300" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
          {status?.active ? "停用" : "激活"}
        </button>
      </div>

      {/* ── Policies ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">防御策略</h2>
          <button onClick={generateFromTcg} disabled={genLoading}
            className="text-xs px-3 py-1 rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
            {genLoading ? "生成中…" : "从 ToolCallGraph 自动生成"}
          </button>
        </div>
        <div className="grid gap-3">
          {policies.map(p => (
            <div key={p.rule_id} className={`rounded-lg border bg-white p-4 flex items-start justify-between gap-4 ${!p.enabled ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${CAT_COLORS[p.category] ?? "bg-slate-100 text-slate-600"}`}>
                    {p.category}
                  </span>
                  <span className="text-sm font-medium text-slate-800 truncate">{p.name}</span>
                  {p.source === "auto_tcg" && <span className="text-[10px] text-blue-500 font-mono">auto</span>}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{p.trigger}</p>
                <p className="text-xs text-slate-400 mt-0.5">动作: <span className="font-medium text-slate-600">{p.action}</span> — {p.reason}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => togglePolicy(p.rule_id)}
                  className={`text-[11px] px-2 py-0.5 rounded border ${p.enabled ? "border-emerald-300 text-emerald-700" : "border-slate-300 text-slate-500"}`}>
                  {p.enabled ? "启用" : "禁用"}
                </button>
                <button onClick={() => deletePolicy(p.rule_id)} className="text-[11px] px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50">删除</button>
              </div>
            </div>
          ))}
          {policies.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">暂无策略</p>}
        </div>
      </section>

      {/* ── Simulate ── */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">测试拦截</h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <input value={simTool} onChange={e => setSimTool(e.target.value)} placeholder="tool_name"
            className="border rounded px-2 py-1.5 text-xs text-slate-700" />
          <input value={simArgs} onChange={e => setSimArgs(e.target.value)} placeholder='arguments JSON'
            className="border rounded px-2 py-1.5 text-xs text-slate-700 font-mono" />
          <input value={simResp} onChange={e => setSimResp(e.target.value)} placeholder="模拟工具返回文本"
            className="border rounded px-2 py-1.5 text-xs text-slate-700" />
        </div>
        <button onClick={simulate} disabled={!simTool}
          className="text-xs px-4 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40">模拟</button>
        {simResult && (
          <div className="mt-3 rounded border p-3 text-xs space-y-1">
            <p><span className="font-medium">判定：</span>
              <span className={simResult.allowed ? "text-emerald-600" : "text-red-600"}>{simResult.allowed ? "放行" : "拦截"}</span>
              {" — "}{simResult.reason}
            </p>
            {simResult.was_modified && (
              <>
                <p className="text-slate-500"><span className="font-medium">原文：</span>{simResult.original_response}</p>
                <p className="text-blue-600"><span className="font-medium">净化后：</span>{simResult.sanitized_response}</p>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Log ── */}
      <section>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">拦截日志</h2>
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">时间</th>
                <th className="text-left px-3 py-2 font-medium">规则</th>
                <th className="text-left px-3 py-2 font-medium">工具</th>
                <th className="text-left px-3 py-2 font-medium">动作</th>
                <th className="text-left px-3 py-2 font-medium">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-400 font-mono whitespace-nowrap">{l.timestamp.slice(11, 19)}</td>
                  <td className="px-3 py-2 text-slate-600 font-mono">{l.policy_rule_id}</td>
                  <td className="px-3 py-2 text-slate-700 font-medium">{l.tool_name}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${l.action_taken === "block" ? "bg-red-100 text-red-700" : l.action_taken === "strip" ? "bg-blue-100 text-blue-700" : l.action_taken === "halt" ? "bg-red-200 text-red-900" : "bg-slate-100 text-slate-600"}`}>
                      {l.action_taken}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 truncate max-w-[300px]">{l.detail}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">暂无拦截记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}
