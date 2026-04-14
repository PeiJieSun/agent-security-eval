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

const TIER_JUMP: Record<string, string> = {
  "一类": "/batch-eval",
  "二类": "/safety/consistency",
  "三类": "/mcp-security",
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

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-400",
  high:     "text-amber-400",
  medium:   "text-yellow-400",
  low:      "text-slate-400",
};

function StatusBadge({ status }: { status: Dimension["status"] }) {
  if (status === "pass")
    return <span className="text-[11px] px-2 py-0.5 rounded border border-emerald-700 text-emerald-400 font-mono">PASS</span>;
  if (status === "fail")
    return <span className="text-[11px] px-2 py-0.5 rounded border border-red-700 text-red-400 font-mono">FAIL</span>;
  return <span className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-slate-500 font-mono">—</span>;
}

function OverallBadge({ status, scored, passed, not_run }: Pick<ReportData, "overall" | "scored" | "passed" | "not_run">) {
  const color = status === "pass" ? "border-emerald-600 text-emerald-300"
    : status === "fail"           ? "border-red-600 text-red-300"
    : "border-slate-600 text-slate-400";
  return (
    <div className={`border rounded px-4 py-3 ${color}`}>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">综合结论</div>
      <div className="text-2xl font-bold font-mono">
        {status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "未完成"}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">
        {passed}/{scored} 通过 &middot; {not_run} 未运行
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  batch:      "批量评测",
  safety:     "安全评测",
  sandbox:    "Docker 沙箱",
  tool_graph: "工具调用图",
};

function DimRow({ dim, onJump }: { dim: Dimension; onJump: (path: string) => void }) {
  const scoreStr = dim.score !== null ? `${(dim.score * 100).toFixed(1)}%` : "—";
  const jumpPath = DIM_JUMP[dim.id];
  const sourceLabel = SOURCE_LABEL[dim.source_type] ?? dim.source_type;
  const sourceId = dim.source_id ? dim.source_id.slice(0, 10) + "…" : null;

  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="py-2 px-3">
        <div className="text-[13px] text-slate-200">{dim.name}</div>
        <div className="text-[10px] text-slate-600 mt-0.5">{dim.description}</div>
      </td>
      <td className="py-2 px-3 text-[11px] text-slate-500 whitespace-nowrap">{dim.tier}</td>
      <td className={`py-2 px-3 text-[11px] ${SEVERITY_COLOR[dim.severity] || "text-slate-400"}`}>{dim.severity}</td>
      <td className="py-2 px-3 text-[11px] text-slate-400 font-mono whitespace-nowrap">{dim.threshold}</td>
      <td className="py-2 px-3 text-[13px] font-mono text-slate-300 tabular-nums">{scoreStr}</td>
      <td className="py-2 px-3"><StatusBadge status={dim.status} /></td>
      <td className="py-2 px-3">
        {dim.status !== "not_run" && sourceId ? (
          <span className="text-[10px] text-slate-600 font-mono" title={dim.source_id ?? ""}>
            {sourceLabel}<br />{sourceId}
          </span>
        ) : jumpPath ? (
          <button
            onClick={() => onJump(jumpPath)}
            className="text-[11px] text-sky-500 hover:text-sky-300 underline underline-offset-2 whitespace-nowrap"
          >
            去运行 →
          </button>
        ) : null}
      </td>
    </tr>
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
      // Pre-select from URL param, fallback to first available
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
      const tier = dim.tier || "其他";
      (grouped[tier] ||= []).push(dim);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="安全报告"
        subtitle="内部方案 v1 — 一/二/三类威胁十二维综合评分卡"
      />

      {/* Framework provenance legend */}
      <div className="mb-5 border border-white/[0.06] rounded-lg p-3 grid grid-cols-3 gap-3 text-[11px]">
        <div>
          <span className="text-slate-500 font-semibold">一类威胁（T1）</span>
          <p className="text-slate-600 mt-0.5 leading-relaxed">
            外部 IPI 攻击防御 — 数据来自<strong className="text-slate-500">批量评测</strong>，
            基于 <span className="font-mono">AgentDojo §3.1</span> + <span className="font-mono">InjecAgent §4</span> 三维框架。
          </p>
        </div>
        <div>
          <span className="text-slate-500 font-semibold">二类威胁（T2）</span>
          <p className="text-slate-600 mt-0.5 leading-relaxed">
            Agent 诚实性检测 — 数据来自<strong className="text-slate-500">安全评测</strong>（一致性探测、CoT 审计、评测感知、后门扫描），
            参考 PromptBench / Lanham et al. / Greenblatt et al.
          </p>
        </div>
        <div>
          <span className="text-slate-500 font-semibold">三类威胁（T3）</span>
          <p className="text-slate-600 mt-0.5 leading-relaxed">
            基础设施安全 — 数据来自 <strong className="text-slate-500">MCP 安全评测 / 记忆投毒 / Docker 沙箱</strong>，
            对应 OWASP LLM Top 10 (2025) 相关条目。
          </p>
        </div>
      </div>

      {/* Model selector + export */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <label className="text-[12px] text-slate-500">模型</label>
        {models.length > 0 ? (
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-transparent border border-white/10 rounded px-2 py-1 text-[13px] text-slate-200 focus:outline-none"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-[#0d0d0d]">{m}</option>
            ))}
          </select>
        ) : (
          <span className="text-[12px] text-slate-600">暂无已完成的评测记录</span>
        )}
        {selectedModel && (
          <a
            href={`/agent-report/export?model=${encodeURIComponent(selectedModel)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[12px] border border-white/10 rounded px-3 py-1 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-colors"
          >
            导出 HTML ↗
          </a>
        )}
      </div>

      {loading && (
        <div className="text-[13px] text-slate-500 mt-8 text-center">加载中…</div>
      )}

      {error && (
        <div className="text-[13px] text-red-400 mt-4">{error}</div>
      )}

      {!loading && !error && !report && !selectedModel && (
        <div className="mt-16 text-center">
          <p className="text-[13px] text-slate-600">还没有评测数据。</p>
          <button
            onClick={() => navigate("/batch-eval")}
            className="mt-3 text-[12px] text-sky-500 hover:text-sky-300 underline"
          >
            前往批量评测
          </button>
        </div>
      )}

      {!loading && report && (
        <>
          {/* Summary row */}
          <div className="flex gap-4 mb-6 flex-wrap">
            <OverallBadge
              status={report.overall}
              scored={report.scored}
              passed={report.passed}
              not_run={report.not_run}
            />
            <div className="border border-white/[0.08] rounded px-4 py-3 flex-1 min-w-[180px]">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">数据来源</div>
              <div className="text-[12px] text-slate-400 font-mono truncate">
                {report.source_batch ? `Batch ${report.source_batch.slice(0, 12)}…` : "未运行批量评测"}
              </div>
              <div className="text-[11px] text-slate-600 mt-1">内部方案 v1.0 — 2026</div>
            </div>
            {/* Quick-run not-run tier buttons */}
            <div className="flex flex-col gap-1 justify-center">
              {TIER_ORDER.map((tier) => {
                const dims = grouped[tier] || [];
                const nr = dims.filter((d) => d.status === "not_run").length;
                if (nr === 0) return null;
                return (
                  <button
                    key={tier}
                    onClick={() => navigate(TIER_JUMP[tier] || "/")}
                    className="text-[11px] text-sky-500 hover:text-sky-300 border border-sky-900/50 rounded px-2 py-0.5"
                  >
                    运行{tier}威胁测评 ({nr} 维度未完成)
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dimension tables by tier */}
          {TIER_ORDER.map((tier) => {
            const dims = grouped[tier];
            if (!dims?.length) return null;
            return (
              <div key={tier} className="mb-6">
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2 px-1">
                  {tier}威胁
                </h2>
                <div className="border border-white/[0.06] rounded overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                        <th className="py-2 px-3 text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider">维度</th>
                        <th className="py-2 px-3 text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider">分类</th>
                        <th className="py-2 px-3 text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider">严重性</th>
                        <th className="py-2 px-3 text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider">阈值</th>
                        <th className="py-2 px-3 text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider">得分</th>
                        <th className="py-2 px-3 text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider">结论</th>
                        <th className="py-2 px-3 text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider">数据来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dims.map((d) => (
                        <DimRow key={d.id} dim={d} onJump={navigate} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
