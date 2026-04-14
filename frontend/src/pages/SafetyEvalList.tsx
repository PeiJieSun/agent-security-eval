/**
 * SafetyEvalList — second-type threat detection hub.
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

// True Type-II: agent's own honesty
const TYPE2_META: Record<string, { label: string; desc: string; route: string }> = {
  consistency:    { label: "一致性探测",   desc: "M1-6 · 行为稳定性",  route: "/safety/consistency" },
  eval_awareness: { label: "评测感知检测", desc: "M2-5 · 表演性对齐",  route: "/safety/eval-awareness" },
  cot_audit:      { label: "CoT 推理审计", desc: "M2-6 · 推理诚实性", route: "/safety/cot-audit" },
  backdoor_scan:  { label: "后门触发扫描", desc: "M2-7 · 隐藏触发词", route: "/safety/backdoor-scan" },
};

// Type-I variant: external attack via memory channel
const TYPE1_EXT_META: Record<string, { label: string; desc: string; route: string }> = {
  memory_poison: { label: "记忆投毒检测", desc: "M2-1 · RAG 记忆污染", route: "/safety/memory-poison" },
};

const ALL_META = { ...TYPE2_META, ...TYPE1_EXT_META };

const STATUS_LABEL: Record<string, string> = { pending: "等待", running: "运行中", done: "完成", error: "出错" };

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
    <div className="px-8 py-7 max-w-5xl mx-auto">
      {/* Page title */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[15px] font-semibold text-slate-900">安全检测总览</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">
            二类威胁 · Agent 自身诚实性&nbsp;&nbsp;{profile && <span className="text-slate-300">·&nbsp;{profile.name} / {profile.model}</span>}
          </p>
        </div>
        <button onClick={load} className="text-slate-400 hover:text-slate-600 text-sm w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100" title="刷新">↻</button>
      </div>

        {/* 真正的二类威胁检测方式 */}
        <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">二类威胁检测方式</h2>
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden mb-5">
          {Object.entries(TYPE2_META).map(([type, meta], i, arr) => (
            <button
              key={type}
              onClick={() => navigate(meta.route)}
              className={`w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors ${i < arr.length - 1 ? "border-b border-slate-100" : ""}`}
            >
              <span className="text-sm font-medium text-slate-800 w-28">{meta.label}</span>
              <span className="text-xs text-slate-400">{meta.desc}</span>
              <span className="ml-auto text-slate-300 text-xs">→</span>
            </button>
          ))}
        </div>

        {/* 外部攻击变体（分类说明） */}
        <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">一类威胁扩展攻击面</h2>
        <p className="text-[11px] text-slate-400 mb-2">
          记忆投毒的攻击来源仍是外部攻击者（通过 RAG 记忆注入，而非 IPI 工具返回值），与二类威胁不同。
        </p>
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden mb-6">
          {Object.entries(TYPE1_EXT_META).map(([type, meta]) => (
            <button
              key={type}
              onClick={() => navigate(meta.route)}
              className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
            >
              <span className="text-sm font-medium text-slate-800 w-28">{meta.label}</span>
              <span className="text-xs text-slate-400">{meta.desc}</span>
              <span className="ml-auto text-slate-300 text-xs">→</span>
            </button>
          ))}
        </div>

        {/* 学术出处（折叠） */}
        {standards.length > 0 && (
          <div className="mb-6">
            <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">各方法学术出处</h2>
            <div className="space-y-1.5">
              {standards.map(s => (
                <SafetySourceCard key={s.id} standard={s} defaultOpen={false} />
              ))}
            </div>
          </div>
        )}

        {/* 最近的安全检测 */}
        <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">最近的安全检测</h2>
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] items-center gap-4 border-b border-slate-100 px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            <span>检测类型</span><span>任务</span><span>模型</span><span>状态</span><span>时间</span><span />
          </div>
          {loading && <div className="px-5 py-10 text-center text-sm text-slate-400">加载中…</div>}
          {!loading && evals.length === 0 && (
            <div className="px-5 py-10 text-center text-slate-400 text-sm">暂无安全检测记录，点击上方条目开始检测。</div>
          )}
          {evals.map((ev, i) => {
            const meta = ALL_META[ev.eval_type];
            return (
              <div
                key={ev.safety_id}
                className={`grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] items-center gap-4 px-5 py-3 cursor-pointer hover:bg-slate-50 ${i < evals.length - 1 ? "border-b border-slate-100" : ""}`}
                onClick={() => navigate(`${meta?.route ?? "/safety/consistency"}/${ev.safety_id}`)}
              >
                <span className="text-sm font-medium text-slate-800 truncate">{meta?.label ?? ev.eval_type}</span>
                <span className="text-xs text-slate-500 truncate">{ev.task_id}</span>
                <span className="text-xs font-mono text-slate-400 truncate">{ev.model}</span>
                <StatusDot status={ev.status} />
                <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(ev.created_at)}</span>
                <button
                  className="text-slate-300 hover:text-slate-600 text-sm w-5 text-center"
                  onClick={async (e) => { e.stopPropagation(); await api.deleteSafetyEval(ev.safety_id); setEvals(p => p.filter(x => x.safety_id !== ev.safety_id)); }}
                >✕</button>
              </div>
            );
          })}
        </div>
    </div>
  );
}
