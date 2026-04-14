/**
 * SafetyEvalList — unified hub for all second-type threat detection evaluations.
 * Shows a nav for the 4 eval types and a shared recent-evals list.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SafetyEval, type SafetyStandard } from "../lib/api";
import { getActiveProfile } from "../lib/settings";
import SafetySourceCard from "../components/SafetySourceCard";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

const EVAL_TYPE_META: Record<string, { label: string; desc: string; icon: string; color: string; route: string }> = {
  consistency:    { label: "一致性探测",    desc: "M1-6 · 行为稳定性",   icon: "🔄", color: "bg-blue-50 border-blue-200 text-blue-700",     route: "/safety/consistency" },
  eval_awareness: { label: "评测感知检测",  desc: "M2-5 · 表演性对齐",   icon: "🎭", color: "bg-amber-50 border-amber-200 text-amber-700",   route: "/safety/eval-awareness" },
  cot_audit:      { label: "CoT 推理审计",  desc: "M2-6 · 推理诚实性",   icon: "🔍", color: "bg-purple-50 border-purple-200 text-purple-700", route: "/safety/cot-audit" },
  backdoor_scan:  { label: "后门触发扫描",  desc: "M2-7 · 隐藏触发词",   icon: "🚨", color: "bg-rose-50 border-rose-200 text-rose-700",     route: "/safety/backdoor-scan" },
  memory_poison:  { label: "记忆投毒检测",  desc: "M2-1 · RAG 记忆污染", icon: "🧠", color: "bg-orange-50 border-orange-200 text-orange-700", route: "/safety/memory-poison" },
};

const STATUS_LABEL: Record<string, string> = { pending: "等待中", running: "运行中", done: "已完成", error: "出错" };
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  running: "bg-blue-100 text-blue-700 animate-pulse",
  done: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
};

export default function SafetyEvalList() {
  const navigate = useNavigate();
  const [evals, setEvals] = useState<SafetyEval[]>([]);
  const [standards, setStandards] = useState<SafetyStandard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.listSafetyEvals().then(setEvals).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    api.getSafetyStandards().then(setStandards).catch(() => {});
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const profile = getActiveProfile();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate("/")} className="text-sm text-slate-400 hover:text-slate-600">← 返回主页</button>
        <span className="text-slate-300">|</span>
        <span className="text-base font-bold text-slate-900">二类威胁检测</span>
        <span className="text-xs text-slate-400 ml-1">Agent 自身隐藏恶意行为</span>
        <div className="ml-auto flex items-center gap-2">
          {profile && <span className="text-xs text-gray-400">{profile.name} · {profile.model}</span>}
          <button onClick={load} className="text-slate-400 hover:text-slate-600">↻</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* 4-type nav */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          {Object.entries(EVAL_TYPE_META).map(([type, meta]) => (
            <button
              key={type}
              onClick={() => navigate(meta.route)}
              className={`rounded-2xl border p-4 text-left hover:shadow-md transition-shadow ${meta.color}`}
            >
              <div className="text-2xl mb-2">{meta.icon}</div>
              <div className="font-semibold text-sm">{meta.label}</div>
              <div className="text-xs opacity-70 mt-0.5">{meta.desc}</div>
            </button>
          ))}
        </div>

        {/* Standards citation section */}
        {standards.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-bold text-gray-700 mb-3">各测评方法学术出处</h2>
            <div className="space-y-2">
              {standards.map(s => (
                <SafetySourceCard key={s.id} standard={s} defaultOpen={false} />
              ))}
            </div>
          </div>
        )}

        {/* Recent safety evals */}
        <h2 className="text-sm font-bold text-gray-700 mb-3">最近的安全检测</h2>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span>检测类型</span><span>任务</span><span>模型</span><span>状态</span><span>时间</span><span />
          </div>
          {loading && <div className="px-5 py-10 text-center text-sm text-slate-400">加载中…</div>}
          {!loading && evals.length === 0 && (
            <div className="px-5 py-12 text-center text-slate-400 text-sm">暂无安全检测记录，点击上方卡片开始检测。</div>
          )}
          {evals.map((ev, i) => {
            const meta = EVAL_TYPE_META[ev.eval_type];
            return (
              <div
                key={ev.safety_id}
                className={`grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-slate-50 ${i < evals.length - 1 ? "border-b border-slate-100" : ""}`}
                onClick={() => navigate(`${meta?.route ?? "/safety/consistency"}/${ev.safety_id}`)}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <span>{meta?.icon}</span><span>{meta?.label ?? ev.eval_type}</span>
                </span>
                <span className="text-xs text-slate-500 truncate">{ev.task_id}</span>
                <span className="text-xs font-mono text-slate-400 truncate">{ev.model}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_STYLE[ev.status]}`}>
                  {STATUS_LABEL[ev.status] ?? ev.status}
                </span>
                <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(ev.created_at)}</span>
                <button
                  className="text-slate-300 hover:text-rose-500 text-sm w-6 text-center"
                  onClick={async (e) => { e.stopPropagation(); await api.deleteSafetyEval(ev.safety_id); setEvals(p => p.filter(x => x.safety_id !== ev.safety_id)); }}
                  title="删除"
                >✕</button>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
