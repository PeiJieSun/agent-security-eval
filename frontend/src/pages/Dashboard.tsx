import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Eval } from "../lib/api";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function EvalStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600",
    running: "bg-blue-100 text-blue-700",
    done: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [evals, setEvals] = useState<Eval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
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

  // Aggregate stats
  const total = evals.length;
  const done = evals.filter((e) => e.status === "done").length;
  const running = evals.filter((e) => e.status === "running").length;
  const errors = evals.filter((e) => e.status === "error").length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
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
        <span className="text-sm text-slate-500">LLM Agent Security Evaluation</span>
        <div className="ml-auto flex items-center gap-3">
          <a href="/standards" className="text-xs text-blue-600 hover:underline">
            Metric Standards ↗
          </a>
          <button
            onClick={() => navigate("/evals/new")}
            className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 transition-colors"
          >
            + New Eval
          </button>
          <button onClick={load} className="text-slate-400 hover:text-slate-600 text-lg" title="Refresh">↻</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Stats panel */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Evals", value: total, color: "text-gray-800" },
            { label: "Completed", value: done, color: "text-green-700" },
            { label: "Running", value: running, color: "text-blue-700" },
            { label: "Errors", value: errors, color: "text-red-700" },
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
            <button className="underline" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {/* Evals table */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_auto_auto_auto] items-center gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span>Task</span>
            <span>Model</span>
            <span>Eval ID</span>
            <span>Status</span>
            <span>Created</span>
            <span />
          </div>

          {loading && (
            <div className="px-5 py-10 text-center text-sm text-slate-400">Loading…</div>
          )}

          {!loading && evals.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-slate-400 text-sm mb-2">No evaluations yet.</p>
              <button
                onClick={() => navigate("/evals/new")}
                className="text-blue-600 text-sm hover:underline"
              >
                Run your first evaluation →
              </button>
            </div>
          )}

          {evals.map((ev, i) => (
            <div
              key={ev.eval_id}
              className={`grid grid-cols-[2fr_1fr_1fr_auto_auto_auto] items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-rose-50/40 transition-colors ${
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
                className="text-slate-300 hover:text-rose-500 transition-colors text-sm w-6 text-center"
                onClick={(e) => handleDelete(e, ev.eval_id)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400 mt-3 text-center">
          Dashboard auto-refreshes every 5s · Metrics follow{" "}
          <a href="/standards" className="text-blue-500 hover:underline">
            AgentDojo §3.4 + InjecAgent §2.3
          </a>
        </p>
      </main>
    </div>
  );
}
