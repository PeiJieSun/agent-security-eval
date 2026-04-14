import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Eval } from "../lib/api";
import { hasApiKey } from "../lib/settings";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  done: "已完成",
  error: "出错",
};

function EvalStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600",
    running: "bg-blue-100 text-blue-700 animate-pulse",
    done: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${styles[status] ?? styles.pending}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [evals, setEvals] = useState<Eval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listEvals()
      .then(setEvals)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const handleDelete = async (e: React.MouseEvent, eval_id: string) => {
    e.stopPropagation();
    await api.deleteEval(eval_id);
    setEvals((prev) => prev.filter((ev) => ev.eval_id !== eval_id));
  };

  const total = evals.length;
  const done = evals.filter((e) => e.status === "done").length;
  const running = evals.filter((e) => e.status === "running" || e.status === "pending").length;
  const errors = evals.filter((e) => e.status === "error").length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航栏 */}
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="text-lg font-black tracking-tight text-slate-900">
            Agent<span className="text-rose-600">Eval</span>
          </span>
          <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">
            :18002
          </span>
        </div>
        <span className="text-slate-300 text-sm">|</span>
        <span className="text-sm text-slate-500">LLM Agent 安全评测框架</span>
        <div className="ml-auto flex items-center gap-3">
          <a href="/standards" className="text-xs text-blue-600 hover:underline">评测标准 ↗</a>
          <button
            onClick={() => navigate("/safety")}
            className="text-xs px-3 py-1.5 rounded-lg border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors"
          >
            🛡 二类威胁检测
          </button>
          <button
            onClick={() => navigate("/settings")}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              hasApiKey()
                ? "border-gray-200 text-gray-500 hover:bg-gray-50"
                : "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
            }`}
          >
            ⚙ {hasApiKey() ? "LLM 配置" : "配置 API Key"}
          </button>
          <button
            onClick={() => navigate("/evals/new")}
            className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 transition-colors"
          >
            + 一键测评
          </button>
          <button onClick={load} className="text-slate-400 hover:text-slate-600 text-lg" title="刷新">↻</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">

        {/* ── 测评框架总览 ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* 当前区域：一类威胁 */}
          <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">⚔️</span>
              <span className="font-bold text-rose-800">一类威胁：外部攻击防御</span>
              <span className="ml-auto text-[10px] bg-rose-200 text-rose-800 font-bold px-2 py-0.5 rounded">当前区域</span>
            </div>
            <p className="text-xs text-rose-700 leading-relaxed">
              攻击者在<strong>外部</strong>，通过工具返回值嵌入恶意指令（间接提示注入 IPI）。
              测试：Agent 是否会被外部攻击者劫持？
            </p>
            <div className="mt-2 text-[11px] text-rose-600 space-y-0.5">
              <div>指标：Benign Utility · Utility Under Attack · Targeted ASR · ASR-valid</div>
              <div>来源：AgentDojo (NeurIPS 2024) · InjecAgent (2024)</div>
            </div>
          </div>

          {/* 另一区域：二类威胁 */}
          <button
            onClick={() => navigate("/safety")}
            className="rounded-2xl border-2 border-purple-200 bg-purple-50 px-5 py-4 text-left hover:border-purple-400 hover:bg-purple-100 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">🛡</span>
              <span className="font-bold text-purple-800">二类威胁：Agent 自身诚实性</span>
              <span className="ml-auto text-xs text-purple-500 group-hover:text-purple-700">进入 →</span>
            </div>
            <p className="text-xs text-purple-700 leading-relaxed">
              威胁来自 Agent <strong>内部</strong>——Agent 可能表演性对齐、推理不诚实、有后门触发器、行为不一致。
              测试：这个 Agent 值得信任吗？
            </p>
            <div className="mt-2 text-[11px] text-purple-600 space-y-0.5">
              <div>检测：一致性探测 · 评测感知 · CoT 审计 · 后门扫描</div>
              <div>来源：PromptBench · Alignment Faking · Lanham 2023 · Hidden Killer</div>
            </div>
          </button>
        </div>

        {/* 统计面板 */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "总评测数", value: total, color: "text-gray-800" },
            { label: "已完成", value: done, color: "text-green-700" },
            { label: "进行中", value: running, color: "text-blue-700" },
            { label: "出错", value: errors, color: "text-red-700" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm text-center">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 bg-rose-50 border border-rose-200 px-4 py-3 rounded-xl text-sm text-rose-700 flex items-center gap-3">
            <span className="flex-1">{error}</span>
            <button className="underline" onClick={() => setError(null)}>关闭</button>
          </div>
        )}

        {/* 评测列表 */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_auto_auto_auto] items-center gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span>任务</span>
            <span>模型</span>
            <span>评测 ID</span>
            <span>状态</span>
            <span>创建时间</span>
            <span />
          </div>

          {loading && (
            <div className="px-5 py-10 text-center text-sm text-slate-400">加载中…</div>
          )}

          {!loading && evals.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-slate-400 text-sm mb-2">暂无评测记录。</p>
              <button
                onClick={() => navigate("/evals/new")}
                className="text-blue-600 text-sm hover:underline"
              >
                开始第一次评测 →
              </button>
            </div>
          )}

          {evals.map((ev, i) => (
            <div
              key={ev.eval_id}
              className={`grid grid-cols-[2fr_1fr_1fr_auto_auto_auto_auto] items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-rose-50/40 transition-colors ${
                i < evals.length - 1 ? "border-b border-slate-100" : ""
              }`}
              onClick={() => navigate(`/evals/${ev.eval_id}`)}
            >
              <span className="text-sm font-semibold text-slate-800 truncate">{ev.task_id}</span>
              <span className="text-xs font-mono text-slate-500 truncate">{ev.model}</span>
              <span className="text-[11px] font-mono text-slate-400 truncate">{ev.eval_id}</span>
              <EvalStatusBadge status={ev.status} />
              <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(ev.created_at)}</span>
              <button
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
                  ev.status === "running"
                    ? "bg-slate-900 text-green-400 hover:bg-slate-700 border border-slate-700"
                    : "text-slate-300 hover:text-slate-500 border border-transparent"
                }`}
                onClick={(e) => { e.stopPropagation(); navigate(`/evals/${ev.eval_id}/monitor`); }}
                title="实时监控"
              >
                {ev.status === "running" ? "🔴 监控" : "监控"}
              </button>
              <button
                className="text-slate-300 hover:text-rose-500 transition-colors text-sm w-6 text-center"
                onClick={(e) => handleDelete(e, ev.eval_id)}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400 mt-3 text-center">
          每 5 秒自动刷新 · 指标来源：
          <a href="/standards" className="text-blue-500 hover:underline">
            AgentDojo §3.4 + InjecAgent §2.3
          </a>
        </p>
      </main>
    </div>
  );
}
