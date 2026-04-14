import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Run, type TrajectoryDetail, type TrajectoryStep } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

type Diff = { added: string[]; removed: string[]; modified: string[] };

function computeDiff(steps: TrajectoryStep[]): Diff {
  if (steps.length < 2) return { added: [], removed: [], modified: [] };
  const first = steps[0].observation;
  const last = steps[steps.length - 1].observation;
  const firstKeys = new Set(Object.keys(first));
  const lastKeys = new Set(Object.keys(last));
  return {
    added:    [...lastKeys].filter((k) => !firstKeys.has(k)),
    removed:  [...firstKeys].filter((k) => !lastKeys.has(k)),
    modified: [...firstKeys].filter(
      (k) => lastKeys.has(k) && JSON.stringify(first[k]) !== JSON.stringify(last[k])
    ),
  };
}

function DiffPill({ label, n, color }: { label: string; n: number; color: string }) {
  if (!n) return null;
  return (
    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${color}`}>
      {label} {n}
    </span>
  );
}

function StepCard({ step, idx }: { step: TrajectoryStep; idx: number }) {
  const [open, setOpen] = useState(idx === 0);
  const isError = step.observation.status === "error";

  return (
    <div className="relative pl-10">
      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-4 h-6 w-6 rounded-full border-2 flex items-center justify-center text-[9px] font-black ${
          isError
            ? "border-slate-300 bg-slate-100 text-slate-700"
            : "border-slate-300 bg-white text-slate-500"
        }`}
      >
        {step.step_k}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <button
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70 transition-colors text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <code className="flex-1 text-sm font-bold text-slate-800">
            {step.tool_call?.name ?? "—"}
          </code>
          {step.tool_call?.kwargs && Object.keys(step.tool_call.kwargs).length > 0 && (
            <span className="text-[10px] text-slate-400 truncate max-w-[200px]">
              {Object.entries(step.tool_call.kwargs)
                .slice(0, 2)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(", ")}
            </span>
          )}
          {isError && (
            <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
              error
            </span>
          )}
          {(step.observation.status === "ok" || !isError) && !isError && (
            <span className="text-[10px] bg-emerald-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
              ok
            </span>
          )}
          <span className="text-slate-400 text-xs shrink-0">{open ? "▾" : "▸"}</span>
        </button>

        {/* Body */}
        {open && (
          <div className="border-t border-slate-100 divide-y divide-slate-100">
            {step.reasoning && (
              <div className="px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                  Reasoning
                </p>
                <p className="text-xs text-slate-600 italic leading-relaxed">{step.reasoning}</p>
              </div>
            )}
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Tool Call
              </p>
              <pre className="text-[11px] font-mono text-slate-700 bg-slate-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(step.tool_call, null, 2)}
              </pre>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Observation
              </p>
              <pre
                className={`text-[11px] font-mono rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed ${
                  isError
                    ? "bg-rose-50 text-rose-800"
                    : "bg-emerald-50 text-slate-900"
                }`}
              >
                {JSON.stringify(step.observation, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RunDetail() {
  const { run_id } = useParams<{ run_id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<Run | null>(null);
  const [traj, setTraj] = useState<TrajectoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!run_id) return;
    setLoading(true);
    Promise.all([
      api.getRun(run_id),
      api.getTrajectory(run_id).catch(() => null),
    ])
      .then(([r, t]) => { setRun(r); setTraj(t); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [run_id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-rose-600 text-sm mb-3">{error || "Run not found"}</p>
          <button className="text-sm text-slate-500 underline" onClick={() => navigate("/")}>
            ← Back to runs
          </button>
        </div>
      </div>
    );
  }

  const diff = traj ? computeDiff(traj.steps) : { added: [], removed: [], modified: [] };
  const hasDiff = diff.added.length + diff.removed.length + diff.modified.length > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-4">
        <button
          className="text-sm text-slate-400 hover:text-slate-700 transition-colors"
          onClick={() => navigate("/")}
        >
          ← Runs
        </button>
        <span className="text-slate-200">|</span>
        <span className="text-lg font-black tracking-tight text-slate-900">
          Agent<span className="text-rose-600">Eval</span>
        </span>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Run header */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-slate-900 truncate">{run.task_id}</h1>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">{run.run_id}</p>
            </div>
            <StatusBadge status={run.status} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Steps</p>
              <p className="text-2xl font-black text-slate-800 tabular-nums">{run.steps_count}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Created</p>
              <p className="text-sm text-slate-600 mt-0.5">{fmtDate(run.created_at)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Updated</p>
              <p className="text-sm text-slate-600 mt-0.5">{fmtDate(run.updated_at)}</p>
            </div>
          </div>

          {/* Env diff */}
          {traj && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                Env Diff (first → last observation)
              </p>
              {hasDiff ? (
                <div className="flex flex-wrap gap-2">
                  <DiffPill label="+added" n={diff.added.length} color="bg-emerald-100 text-slate-600 border-slate-200" />
                  <DiffPill label="~modified" n={diff.modified.length} color="bg-amber-100 text-amber-700 border-amber-200" />
                  <DiffPill label="-removed" n={diff.removed.length} color="bg-rose-100 text-rose-700 border-rose-200" />
                </div>
              ) : (
                <p className="text-xs text-slate-400">No field changes detected across steps</p>
              )}
            </div>
          )}

          {/* Final output */}
          {traj?.final_output && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Final Output
              </p>
              <p className="text-sm text-slate-700 leading-relaxed">{traj.final_output}</p>
            </div>
          )}
        </div>

        {/* No trajectory */}
        {!traj && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <p className="text-slate-400 text-sm">No trajectory stored for this run.</p>
            <p className="text-slate-400 text-xs mt-1">
              POST /api/v1/agent-eval/runs/{run_id}/trajectory to attach one.
            </p>
          </div>
        )}

        {/* Timeline */}
        {traj && traj.steps.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">
              Trajectory — {traj.steps.length} steps
            </p>
            {/* Timeline line */}
            <div className="relative">
              <div className="absolute left-[11px] top-5 bottom-5 w-px bg-slate-200" />
              <div className="space-y-3">
                {traj.steps.map((step, i) => (
                  <StepCard key={step.step_k} step={step} idx={i} />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
