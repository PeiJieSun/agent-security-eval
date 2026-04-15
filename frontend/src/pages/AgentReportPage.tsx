import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";

type Dimension = {
  id: string;
  name: string;
  tier: string;
  severity: string;
  threshold: string;
  description: string;
  coverage: string[];
  score: number | null;
  status: "pass" | "fail" | "not_run";
  source_type: string;
  source_id: string | null;
};

type ReportData = {
  model: string;
  overall: "pass" | "fail" | "not_run";
  scored: number;
  passed: number;
  not_run: number;
  source_batch: string | null;
  dimensions: Dimension[];
};

const TIER_ORDER = ["一类", "二类", "三类"];

const TIER_META: Record<string, { label: string; sub: string; jump: string }> = {
  "一类": { label: "T1 · 外部攻击防御", sub: "来自批量评测 · AgentDojo §3.1 + InjecAgent §4", jump: "/batch-eval" },
  "二类": { label: "T2 · Agent 诚实性", sub: "来自安全评测 · 一致性探测 / CoT 审计 / 评测感知 / 后门扫描", jump: "/safety/consistency" },
  "三类": { label: "T3 · 基础设施安全", sub: "来自 MCP 安全 / 记忆投毒 / Docker 沙箱 · 对应 OWASP LLM Top 10", jump: "/mcp-security" },
};

const DIM_JUMP: Record<string, string> = {
  t1_benign_utility:         "/batch-eval",
  t1_attack_robustness:      "/batch-eval",
  t1_attack_resistance:      "/batch-eval",
  t1_style_diversity:        "/batch-eval",
  t2_behavioral_consistency: "/safety/consistency",
  t2_reasoning_faithfulness: "/safety/cot-audit",
  t2_eval_transparency:      "/safety/eval-awareness",
  t2_backdoor_absence:       "/safety/backdoor-scan",
  t3_mcp_tool_integrity:     "/mcp-security",
  t3_memory_integrity:       "/safety/memory-poison",
  t3_execution_isolation:    "/sandbox",
  t3_min_privilege:          "/analysis/tool-graph",
};

const SOURCE_LABEL: Record<string, string> = {
  batch:      "批量评测",
  safety:     "安全评测",
  sandbox:    "Docker 沙箱",
  tool_graph: "工具调用图",
};

// Severity: filled chip with background
function SeverityChip({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: "bg-red-950 text-red-300 border border-red-800",
    high:     "bg-amber-950 text-amber-300 border border-amber-800",
    medium:   "bg-yellow-950 text-yellow-300 border border-yellow-800",
    low:      "bg-slate-800 text-slate-400 border border-slate-700",
  };
  return (
    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded ${styles[severity] ?? styles.low}`}>
      {severity}
    </span>
  );
}

// Status badge: filled for pass/fail, ghost for not_run
function StatusBadge({ status }: { status: Dimension["status"] }) {
  if (status === "pass")
    return <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded bg-emerald-900 text-emerald-300 border border-emerald-700">PASS</span>;
  if (status === "fail")
    return <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-700">FAIL</span>;
  return <span className="inline-block text-[11px] px-2.5 py-0.5 rounded border border-white/10 text-slate-600">未运行</span>;
}

function DimRow({ dim, onJump }: { dim: Dimension; onJump: (path: string) => void }) {
  const hasScore = dim.score !== null;
  const scoreStr = hasScore ? `${(dim.score! * 100).toFixed(1)}%` : "—";
  const jumpPath = DIM_JUMP[dim.id];
  const sourceLabel = SOURCE_LABEL[dim.source_type] ?? dim.source_type;
  const sourceId = dim.source_id ? dim.source_id.slice(0, 8) + "…" : null;
  const dimmed = dim.status === "not_run";

  return (
    <tr className={`border-b border-white/[0.06] transition-colors ${dimmed ? "opacity-50" : "hover:bg-white/[0.03]"}`}>
      {/* Dimension name + description */}
      <td className="py-3.5 px-4" style={{ width: "38%" }}>
        <div className="text-[13px] font-medium text-slate-100 leading-snug">{dim.name}</div>
        <div className="text-[12px] text-slate-400 mt-1 leading-relaxed">{dim.description}</div>
      </td>

      {/* Severity */}
      <td className="py-3.5 px-3 whitespace-nowrap">
        <SeverityChip severity={dim.severity} />
      </td>

      {/* Threshold */}
      <td className="py-3.5 px-3">
        <span className="text-[12px] font-mono text-slate-400">{dim.threshold}</span>
      </td>

      {/* Score — visual anchor, largest and brightest */}
      <td className="py-3.5 px-3 text-right whitespace-nowrap">
        <span className={`text-[18px] font-bold tabular-nums leading-none ${
          !hasScore ? "text-slate-700" :
          dim.status === "pass" ? "text-emerald-400" :
          dim.status === "fail" ? "text-red-400" : "text-slate-300"
        }`}>{scoreStr}</span>
      </td>

      {/* Status */}
      <td className="py-3.5 px-3 whitespace-nowrap">
        <StatusBadge status={dim.status} />
      </td>

      {/* Source / action */}
      <td className="py-3.5 px-4">
        {dim.status !== "not_run" && sourceId ? (
          <div className="text-[11px] text-slate-500 leading-relaxed">
            <span className="text-slate-400">{sourceLabel}</span>
            <br />
            <span className="font-mono text-slate-600">{sourceId}</span>
          </div>
        ) : jumpPath ? (
          <button
            onClick={() => onJump(jumpPath)}
            className="text-[12px] text-sky-400 hover:text-sky-200 font-medium whitespace-nowrap transition-colors"
          >
            去运行 →
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function TierSection({ tier, dims, onJump, onRunAll }: {
  tier: string;
  dims: Dimension[];
  onJump: (path: string) => void;
  onRunAll: (path: string) => void;
}) {
  const meta = TIER_META[tier];
  const passCount = dims.filter(d => d.status === "pass").length;
  const failCount = dims.filter(d => d.status === "fail").length;
  const notRunCount = dims.filter(d => d.status === "not_run").length;

  return (
    <div className="mb-8">
      {/* Tier header */}
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-200 tracking-wide">{meta.label}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{meta.sub}</p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          {passCount > 0 && <span className="text-emerald-400">{passCount} 通过</span>}
          {failCount > 0 && <span className="text-red-400">{failCount} 失败</span>}
          {notRunCount > 0 && (
            <button
              onClick={() => onRunAll(meta.jump)}
              className="text-sky-400 hover:text-sky-200 transition-colors"
            >
              {notRunCount} 未运行 →
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-white/[0.03] border-b border-white/[0.08]">
              <th className="py-2.5 px-4 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">维度</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">严重性</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">通过阈值</th>
              <th className="py-2.5 px-3 text-right text-[11px] font-medium text-slate-500 uppercase tracking-wider">得分</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">结论</th>
              <th className="py-2.5 px-4 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">数据来源</th>
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => <DimRow key={d.id} dim={d} onJump={onJump} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AgentReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(searchParams.get("model") ?? "");
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getReportModels().then((ms) => {
      setModels(ms);
      const urlModel = searchParams.get("model");
      if (urlModel && ms.includes(urlModel)) {
        setSelectedModel(urlModel);
      } else if (!selectedModel && ms.length > 0) {
        setSelectedModel(ms[0]);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedModel) { setReport(null); return; }
    setLoading(true);
    setError(null);
    api.getAgentReport(selectedModel)
      .then(setReport)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedModel]);

  const grouped: Record<string, Dimension[]> = {};
  if (report) {
    for (const dim of report.dimensions) {
      (grouped[dim.tier || "其他"] ||= []).push(dim);
    }
  }

  const overallColor = !report ? "" :
    report.overall === "pass" ? "border-emerald-700 bg-emerald-950/40" :
    report.overall === "fail" ? "border-red-800 bg-red-950/30" :
    "border-white/10";
  const overallTextColor = !report ? "" :
    report.overall === "pass" ? "text-emerald-300" :
    report.overall === "fail" ? "text-red-300" :
    "text-slate-400";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="安全报告"
        subtitle="内部方案 v1 — 一/二/三类威胁十二维综合评分卡"
      />

      {/* Top bar: model selector + export */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-[12px] text-slate-500 shrink-0">模型</label>
        {models.length > 0 ? (
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded px-3 py-1.5 text-[13px] text-slate-200 focus:outline-none focus:border-white/20"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-[#111]">{m}</option>
            ))}
          </select>
        ) : (
          <span className="text-[13px] text-slate-500">暂无已完成的评测记录</span>
        )}
        {selectedModel && (
          <a
            href={`/agent-report/export?model=${encodeURIComponent(selectedModel)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[12px] border border-white/10 rounded px-3 py-1.5 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-colors"
          >
            导出 HTML ↗
          </a>
        )}
      </div>

      {loading && (
        <div className="text-[14px] text-slate-400 mt-12 text-center">加载中…</div>
      )}
      {error && (
        <div className="text-[13px] text-red-400 mt-4 border border-red-900 rounded px-4 py-3">{error}</div>
      )}
      {!loading && !error && !selectedModel && (
        <div className="mt-16 text-center space-y-3">
          <p className="text-[14px] text-slate-500">还没有评测数据</p>
          <button onClick={() => navigate("/batch-eval")}
            className="text-[13px] text-sky-400 hover:text-sky-200 transition-colors">
            前往批量评测 →
          </button>
        </div>
      )}

      {!loading && report && (
        <>
          {/* Summary strip */}
          <div className={`flex items-center gap-6 border rounded-lg px-5 py-4 mb-8 ${overallColor}`}>
            {/* Overall verdict */}
            <div className="shrink-0">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">综合结论</div>
              <div className={`text-[28px] font-black leading-none ${overallTextColor}`}>
                {report.overall === "pass" ? "PASS" : report.overall === "fail" ? "FAIL" : "—"}
              </div>
            </div>
            <div className="w-px h-10 bg-white/[0.08] shrink-0" />
            {/* Stats */}
            <div className="flex gap-5 text-center">
              <div>
                <div className="text-[22px] font-bold text-emerald-400 leading-none">{report.passed}</div>
                <div className="text-[11px] text-slate-500 mt-1">通过</div>
              </div>
              <div>
                <div className="text-[22px] font-bold text-red-400 leading-none">
                  {report.scored - report.passed}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">失败</div>
              </div>
              <div>
                <div className="text-[22px] font-bold text-slate-600 leading-none">{report.not_run}</div>
                <div className="text-[11px] text-slate-500 mt-1">未运行</div>
              </div>
            </div>
            <div className="w-px h-10 bg-white/[0.08] shrink-0" />
            {/* Batch ref */}
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">T1 数据批次</div>
              <div className="text-[13px] font-mono text-slate-400 truncate">
                {report.source_batch ?? "—"}
              </div>
            </div>
            {/* Not-run CTA buttons */}
            {TIER_ORDER.some(t => (grouped[t] || []).some(d => d.status === "not_run")) && (
              <div className="ml-auto flex flex-col gap-1.5 shrink-0">
                {TIER_ORDER.map(tier => {
                  const nr = (grouped[tier] || []).filter(d => d.status === "not_run").length;
                  if (nr === 0) return null;
                  return (
                    <button key={tier}
                      onClick={() => navigate(TIER_META[tier].jump)}
                      className="text-[11px] text-sky-400 hover:text-sky-200 border border-sky-900/60 rounded px-3 py-1 text-left transition-colors"
                    >
                      运行 {tier}类威胁 · {nr} 项未完成
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tier sections */}
          {TIER_ORDER.map((tier) => {
            const dims = grouped[tier];
            if (!dims?.length) return null;
            return (
              <TierSection
                key={tier}
                tier={tier}
                dims={dims}
                onJump={navigate}
                onRunAll={navigate}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
