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
  } catch { return iso; }
}

const STATUS_LABEL: Record<string, string> = {
  pending: "等待", running: "运行中", done: "完成", error: "出错",
};

function StatusDot({ status }: { status: string }) {
  const dot: Record<string, string> = {
    pending: "bg-slate-300",
    running: "bg-blue-500 animate-pulse",
    done:    "bg-emerald-500",
    error:   "bg-red-500",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dot[status] ?? dot.pending}`} />
      <span className="text-xs text-slate-500">{STATUS_LABEL[status] ?? status}</span>
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

  const total   = evals.length;
  const done    = evals.filter((e) => e.status === "done").length;
  const running = evals.filter((e) => e.status === "running" || e.status === "pending").length;
  const errors  = evals.filter((e) => e.status === "error").length;

  return (
    <div className="px-8 py-7 max-w-5xl mx-auto">
      {/* Page title + actions */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[15px] font-semibold text-slate-900">评测列表</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            一类威胁 · 外部攻击防御 —&nbsp;
            <a href="/standards" className="underline underline-offset-2 hover:text-slate-600">
              AgentDojo §3.4 + InjecAgent §2.3
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!hasApiKey() && (
            <button
              onClick={() => navigate("/settings")}
              className="text-xs text-slate-500 border border-slate-300 px-3 py-1.5 rounded hover:bg-slate-50"
            >
              ⚠ 配置 API Key
            </button>
          )}
          <button onClick={load} className="text-slate-400 hover:text-slate-600 text-sm w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100" title="刷新">↻</button>
        </div>
      </div>

      {/* 统计栏 */}
        <div className="flex items-center gap-6 mb-5 px-1">
          {[
            { label: "总评测", value: total },
            { label: "已完成", value: done },
            { label: "进行中", value: running },
            { label: "出错",   value: errors },
          ].map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-slate-800">{s.value}</span>
              <span className="text-xs text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 border border-slate-200 px-4 py-3 rounded-lg text-sm text-slate-600 flex items-center gap-3">
            <span className="flex-1">{error}</span>
            <button className="text-slate-400 hover:text-slate-600" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* 评测列表 */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_auto_auto_auto_auto] items-center gap-4 border-b border-slate-100 px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            <span>任务</span><span>模型</span><span>评测 ID</span><span>状态</span><span>时间</span><span /><span />
          </div>

          {loading && (
            <div className="px-5 py-10 text-center text-sm text-slate-400">加载中…</div>
          )}

          {!loading && evals.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-slate-400 text-sm mb-2">暂无评测记录</p>
              <button onClick={() => navigate("/evals/new")} className="text-slate-600 text-sm underline underline-offset-2">
                开始第一次评测 →
              </button>
            </div>
          )}

          {evals.map((ev, i) => (
            <div
              key={ev.eval_id}
              className={`grid grid-cols-[2fr_1fr_1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                i < evals.length - 1 ? "border-b border-slate-100" : ""
              }`}
              onClick={() => navigate(`/evals/${ev.eval_id}`)}
            >
              <span className="text-sm font-medium text-slate-800 truncate">{ev.task_id}</span>
              <span className="text-xs font-mono text-slate-500 truncate">{ev.model}</span>
              <span className="text-[11px] font-mono text-slate-400 truncate">{ev.eval_id}</span>
              <StatusDot status={ev.status} />
              <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(ev.created_at)}</span>
              <button
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                  ev.status === "running"
                    ? "border-slate-700 text-slate-700 hover:bg-slate-100"
                    : "border-transparent text-slate-300 hover:text-slate-500"
                }`}
                onClick={(e) => { e.stopPropagation(); navigate(`/evals/${ev.eval_id}/monitor`); }}
              >
                {ev.status === "running" ? "● 监控" : "监控"}
              </button>
              <button
                className="text-slate-300 hover:text-slate-600 text-sm w-5 text-center"
                onClick={(e) => handleDelete(e, ev.eval_id)}
              >✕</button>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-400 mt-3 text-center">每 5 秒自动刷新</p>
    </div>
  );
}
