import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Run } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";

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

export default function Dashboard() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.listRuns()
      .then(setRuns)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    const tid = taskId.trim();
    if (!tid) return;
    setCreating(true);
    try {
      await api.createRun(tid);
      setTaskId("");
      load();
      inputRef.current?.focus();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, runId: string) {
    e.stopPropagation();
    await api.deleteRun(runId);
    setRuns((prev) => prev.filter((r) => r.run_id !== runId));
  }

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
        <span className="text-sm text-slate-500">LLM Agent Security Evaluation Framework</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          API connected
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Create run */}
        <div className="mb-6 flex gap-3">
          <input
            ref={inputRef}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-400"
            placeholder="Task ID — e.g. email-exfil-task-1"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button
            className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-40 transition-colors"
            onClick={handleCreate}
            disabled={creating || !taskId.trim()}
          >
            {creating ? "Creating…" : "+ New Run"}
          </button>
          <button
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-50 shadow-sm transition-colors"
            onClick={load}
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
            <span className="flex-1">{error}</span>
            <button className="underline hover:no-underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}

        {/* Stats row */}
        {!loading && runs.length > 0 && (
          <div className="mb-4 flex gap-3">
            {(["running", "done", "error"] as const).map((s) => {
              const n = runs.filter((r) => r.status === s).length;
              if (!n) return null;
              return (
                <div key={s} className="flex items-center gap-1.5 text-sm">
                  <StatusBadge status={s} />
                  <span className="text-slate-500 tabular-nums">{n}</span>
                </div>
              );
            })}
            <span className="ml-auto text-xs text-slate-400">{runs.length} total runs</span>
          </div>
        )}

        {/* Table */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[2fr_1fr_auto_auto_auto_auto] items-center gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span>Task ID</span>
            <span>Run ID</span>
            <span>Steps</span>
            <span>Status</span>
            <span>Created</span>
            <span />
          </div>

          {loading && (
            <div className="px-5 py-10 text-center text-sm text-slate-400">Loading…</div>
          )}

          {!loading && runs.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-slate-400 text-sm mb-1">No evaluation runs yet.</p>
              <p className="text-slate-400 text-xs">Enter a task ID above and press Enter to start one.</p>
            </div>
          )}

          {runs.map((run, i) => (
            <div
              key={run.run_id}
              className={`grid grid-cols-[2fr_1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-rose-50/40 transition-colors ${
                i < runs.length - 1 ? "border-b border-slate-100" : ""
              }`}
              onClick={() => navigate(`/runs/${run.run_id}`)}
            >
              <span className="text-sm font-semibold text-slate-800 truncate">{run.task_id}</span>
              <span className="text-[11px] font-mono text-slate-400 truncate">{run.run_id}</span>
              <span className="text-sm tabular-nums text-slate-600 font-semibold text-right">
                {run.steps_count}
              </span>
              <StatusBadge status={run.status} />
              <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(run.created_at)}</span>
              <button
                className="text-slate-300 hover:text-rose-500 transition-colors text-sm w-6 text-center"
                onClick={(e) => handleDelete(e, run.run_id)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
