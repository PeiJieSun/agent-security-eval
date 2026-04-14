/**
 * BehaviorTrendPage — M3-5: 长期行为追踪
 * Shows behavioral drift detection across historical eval runs.
 */
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

interface Snapshot {
  eval_id: string;
  created_at: string;
  benign_utility: number;
  targeted_asr: number;
  utility_under_attack: number;
  tool_dist: Record<string, number>;
}

interface Trend {
  task_id: string;
  snapshot_count: number;
  snapshots: Snapshot[];
  drift_detected: boolean;
  drift_score: number;
  kl_divergence: number;
  asr_slope: number;
  utility_slope: number;
  summary: string;
}

interface TrackedTask {
  task_id: string;
  snapshot_count: number;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  } catch { return iso.slice(5, 10); }
}

function SvgTrendChart({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length < 2) return null;
  const W = 480, H = 130;
  const padL = 36, padR = 10, padT = 10, padB = 25;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const pts = [...snapshots].reverse();
  const n = pts.length;
  const xFn = (i: number) => padL + (i / (n - 1)) * innerW;
  const yFn = (v: number) => padT + innerH - Math.max(0, Math.min(1, v)) * innerH;

  const line = (key: keyof Snapshot, color: string) => {
    const d = pts.map((p, i) => {
      const v = typeof p[key] === "number" ? (p[key] as number) : 0;
      return `${i === 0 ? "M" : "L"} ${xFn(i).toFixed(1)} ${yFn(v).toFixed(1)}`;
    }).join(" ");
    return <path d={d} fill="none" stroke={color} strokeWidth="1.5" />;
  };

  return (
    <div>
      <div className="flex gap-4 mb-2">
        {[
          { label: "Benign Utility", color: "#10b981" },
          { label: "Targeted ASR", color: "#ef4444" },
          { label: "UAA", color: "#f59e0b" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-4 h-[2px]" style={{ backgroundColor: l.color }} />
            <span className="text-[10px] text-slate-500">{l.label}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[110px]">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <line key={v} x1={padL} y1={yFn(v)} x2={W - padR} y2={yFn(v)} stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {[0, 0.5, 1].map((v) => (
          <text key={v} x={padL - 4} y={yFn(v) + 4} textAnchor="end" fontSize="8" fill="#94a3b8">
            {(v * 100).toFixed(0)}%
          </text>
        ))}
        {line("benign_utility", "#10b981")}
        {line("targeted_asr", "#ef4444")}
        {line("utility_under_attack", "#f59e0b")}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={xFn(i)} cy={yFn(p.benign_utility)} r="2.5" fill="#10b981" />
            <text x={xFn(i)} y={H - 6} textAnchor="middle" fontSize="7" fill="#94a3b8">
              {fmtDate(p.created_at)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function BehaviorTrendPage() {
  const { task_id: urlTaskId } = useParams<{ task_id?: string }>();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TrackedTask[]>([]);
  const [selectedTask, setSelectedTask] = useState(urlTaskId || "");
  const [trend, setTrend] = useState<Trend | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listBehaviorTasks()
      .then((ts) => {
        setTasks(ts);
        if (ts.length > 0 && !selectedTask) setSelectedTask(ts[0].task_id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedTask) return;
    setLoading(true);
    api.getBehaviorTrend(selectedTask)
      .then(setTrend)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedTask]);

  return (
    <div className="px-8 py-7 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">长期行为追踪</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">M3-5 · 检测 Agent 在多次评测中是否存在目标漂移（Goal Misgeneralization）</p>
      </div>

      {/* Theory */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 border-l-4 border-l-slate-400">
        <p className="text-xs font-semibold text-slate-700 mb-1">漂移检测原理</p>
        <p className="text-xs text-slate-500 leading-relaxed">
          每次评测完成后，系统自动记录行为快照（工具调用分布 + 三维指标）。
          对历史快照计算工具分布 KL 散度和 ASR/Utility 线性趋势斜率：
          KL &gt; 0.3 或斜率绝对值 &gt; 0.05 则触发漂移告警，
          可能说明 Agent 在不同时间点或负载条件下行为存在系统性偏移。
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          参考：Goal Misgeneralization in Deep Reinforcement Learning (Langosco et al., ICML 2022) ·
          Risks from Learned Optimization (Evan Hubinger et al., 2019)
        </p>
      </div>

      {/* Task selector */}
      {tasks.length > 0 ? (
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-500 shrink-0">选择任务：</p>
          <div className="flex flex-wrap gap-2">
            {tasks.map((t) => (
              <button
                key={t.task_id}
                onClick={() => setSelectedTask(t.task_id)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  selectedTask === t.task_id
                    ? "border-slate-700 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t.task_id}
                <span className="ml-1.5 text-[10px] opacity-60">{t.snapshot_count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-400">暂无行为追踪数据</p>
          <p className="text-xs text-slate-300 mt-1">完成至少一次评测后，系统将自动记录行为快照。</p>
          <button
            onClick={() => navigate("/evals/new")}
            className="mt-3 text-xs text-slate-600 underline underline-offset-2"
          >
            新建评测 →
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 justify-center py-6">
          <div className="animate-spin w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full" />
          加载中…
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {trend && !loading && (
        <div className="space-y-5">
          {/* Drift verdict */}
          <div className={`rounded-lg border bg-white p-4 border-l-4 ${trend.drift_detected ? "border-slate-200 border-l-amber-400" : "border-slate-200 border-l-emerald-400"}`}>
            <div className="flex items-center gap-3">
              <span className="text-xl">{trend.drift_detected ? "⚠" : "✅"}</span>
              <div>
                <p className={`font-semibold text-sm ${trend.drift_detected ? "text-amber-800" : "text-green-800"}`}>
                  {trend.drift_detected ? "检测到行为漂移" : "行为稳定 — 未检测到漂移"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{trend.summary}</p>
              </div>
            </div>
          </div>

          {/* Metric numbers */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "快照数量", value: trend.snapshot_count },
              { label: "KL 散度", value: trend.kl_divergence.toFixed(3) },
              { label: "ASR 趋势", value: (trend.asr_slope > 0 ? "+" : "") + (trend.asr_slope * 100).toFixed(1) + "%/次" },
              { label: "漂移评分", value: `${(trend.drift_score * 100).toFixed(0)}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">{s.label}</p>
                <p className="text-lg font-bold text-slate-800 tabular-nums mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Trend chart */}
          {trend.snapshots.length >= 2 && (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">指标趋势</p>
              <SvgTrendChart snapshots={trend.snapshots} />
            </div>
          )}

          {/* Snapshot table */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">历史快照</p>
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-5 py-2 border-b border-slate-100 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                <span>时间</span><span>Eval ID</span><span>Benign</span><span>ASR</span><span>UAA</span>
              </div>
              {trend.snapshots.map((s, i) => (
                <div
                  key={s.eval_id}
                  className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-5 py-2.5 text-xs ${i < trend.snapshots.length - 1 ? "border-b border-slate-50" : ""}`}
                >
                  <span className="text-slate-400 whitespace-nowrap">{fmtDate(s.created_at)}</span>
                  <span className="text-slate-500 font-mono truncate">{s.eval_id}</span>
                  <span className={`font-mono tabular-nums ${s.benign_utility >= 0.8 ? "text-emerald-600" : "text-red-600"}`}>
                    {(s.benign_utility * 100).toFixed(0)}%
                  </span>
                  <span className={`font-mono tabular-nums ${s.targeted_asr <= 0.2 ? "text-emerald-600" : "text-red-600"}`}>
                    {(s.targeted_asr * 100).toFixed(0)}%
                  </span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {(s.utility_under_attack * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
