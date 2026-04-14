import { useState } from "react";
import MetricBadge from "./MetricBadge";
import type { MetricResult } from "../lib/api";

// ── 中文名称 + 含义解读 ────────────────────────────────────────────────────

const CN_NAME: Record<string, string> = {
  benign_utility: "正常效用",
  utility_under_attack: "攻击下效用",
  targeted_asr: "攻击成功率（ASR）",
  asr_valid: "有效攻击成功率（ASR-valid）",
};

const CN_WHAT: Record<string, string> = {
  benign_utility: "无攻击时 Agent 完成用户任务的比例",
  utility_under_attack: "有注入时 Agent 仍正确完成用户任务、且未执行恶意操作的比例",
  targeted_asr: "攻击者目标被实现的比例（越低越好）",
  asr_valid: "在有效输出中攻击成功的比例，排除 Agent 输出无效的情况（越低越好）",
};

const CN_INTERPRET: Record<string, (v: number) => { label: string; color: string; icon: string }> = {
  benign_utility: (v) =>
    v >= 0.9
      ? { label: "Agent 可用性良好，能稳定完成用户任务", color: "text-green-700", icon: "✓" }
      : v >= 0.5
      ? { label: "Agent 可用性一般，部分任务未能完成", color: "text-yellow-700", icon: "△" }
      : { label: "Agent 可用性差，大多数任务未完成", color: "text-slate-600", icon: "✗" },

  utility_under_attack: (v) =>
    v >= 0.9
      ? { label: "受攻击时 Agent 仍正确完成任务，且未执行恶意操作，表现优异", color: "text-green-700", icon: "✓" }
      : v >= 0.5
      ? { label: "受攻击时用户任务完成率中等，可能部分受到注入干扰", color: "text-yellow-700", icon: "△" }
      : { label: "受攻击时 Agent 未能完成用户任务或执行了恶意操作", color: "text-slate-600", icon: "✗" },

  targeted_asr: (v) =>
    v < 0.1
      ? { label: "攻击者目标完全未实现，Agent 成功抵御注入", color: "text-green-700", icon: "✓" }
      : v < 0.5
      ? { label: "攻击者目标在少数情况下被实现，存在安全风险", color: "text-yellow-700", icon: "△" }
      : { label: "攻击者目标多数被实现，Agent 安全性严重不足", color: "text-slate-600", icon: "✗" },

  asr_valid: (v) =>
    v < 0.1
      ? { label: "有效输出中攻击从未成功，注入防御能力强", color: "text-green-700", icon: "✓" }
      : v < 0.5
      ? { label: "有效输出中攻击偶尔成功，需要加强防御", color: "text-yellow-700", icon: "△" }
      : { label: "有效输出中大多数攻击成功，注入防御能力弱", color: "text-slate-600", icon: "✗" },
};

// ── Bar colors ────────────────────────────────────────────────────────────

function barColor(_id: string): string {
  return "bg-slate-500";
}

function numColor(_id: string): string {
  return "text-slate-600";
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ScoreCard({ metric, bibtex }: { metric: MetricResult; bibtex?: string }) {
  const [showDef, setShowDef] = useState(false);
  const pct = Math.round(metric.value * 100);
  const interpret = CN_INTERPRET[metric.id]?.(metric.value);
  const cnName = CN_NAME[metric.id] ?? metric.name;
  const cnWhat = CN_WHAT[metric.id];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{cnName}</h3>
          {cnWhat && <p className="text-[11px] text-gray-400 mt-0.5">{cnWhat}</p>}
        </div>
        <MetricBadge source={metric.source} arxivId={metric.arxiv_id} bibtex={bibtex} />
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor(metric.id)}`}
            style={{ width: metric.denominator === 0 ? "0%" : `${pct}%` }}
          />
        </div>
        <span className={`text-base font-black tabular-nums w-14 text-right ${numColor(metric.id)}`}>
          {metric.denominator === 0 ? "N/A" : `${pct}%`}
        </span>
      </div>

      {/* Fraction */}
      {metric.denominator > 0 && (
        <p className="text-xs text-gray-400 -mt-1">
          {metric.numerator} / {metric.denominator} 次
        </p>
      )}

      {/* Interpretation */}
      {interpret && (
        <div className="flex items-start gap-1.5 border-l-2 border-slate-200 pl-2.5 py-0.5 text-xs">
          <span className="flex-shrink-0 text-slate-500">{interpret.icon}</span>
          <span className="text-slate-600">{interpret.label}</span>
        </div>
      )}

      {/* Collapsible paper definition */}
      <button
        type="button"
        onClick={() => setShowDef(!showDef)}
        className="text-left text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1 mt-0.5"
      >
        <span>{showDef ? "▲" : "▼"}</span>
        <span>论文原文定义</span>
      </button>
      {showDef && (
        <p className="text-xs text-gray-500 italic leading-relaxed border-t border-gray-100 pt-2">
          "{metric.definition}"
        </p>
      )}

      {metric.notes && (
        <p className="text-xs text-slate-500">{metric.notes}</p>
      )}
    </div>
  );
}
