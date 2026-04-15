/**
 * EvalFrameworksPage — 评测维度方案
 * Presents 4 evaluation frameworks side-by-side:
 *   1. AgentDojo / InjecAgent (学界三维)
 *   2. OWASP LLM Top 10 2025
 *   3. MITRE ATLAS
 *   4. 内部自有方案 v1
 * Each framework shows its dimensions, our platform coverage, and severity badges.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// ── Types ──────────────────────────────────────────────────────────────────

interface Dimension {
  id: string;
  name: string;
  name_en: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  source_ref: string;
  coverage: string[];
  threshold?: string;
  tier?: string;
}

interface Framework {
  id: string;
  name: string;
  name_en: string;
  version: string;
  description: string;
  source: string;
  source_url: string | null;
  badge_color: string;
  dimensions: Dimension[];
}

interface Capability {
  label: string;
  path: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high:     "bg-orange-50 text-orange-700 border-orange-200",
  medium:   "bg-amber-50 text-amber-700 border-amber-200",
  low:      "bg-slate-50 text-slate-500 border-slate-200",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "严重",
  high:     "高",
  medium:   "中",
  low:      "低",
};

const BADGE_STYLES: Record<string, string> = {
  blue:  "border-blue-300 text-blue-700 bg-blue-50",
  red:   "border-red-300 text-red-700 bg-red-50",
  orange:"border-orange-300 text-orange-700 bg-orange-50",
  slate: "border-slate-300 text-slate-700 bg-slate-50",
};

function coverageRate(fw: Framework): number {
  if (!fw.dimensions.length) return 0;
  const covered = fw.dimensions.filter(d => d.coverage.length > 0).length;
  return covered / fw.dimensions.length;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SeverityBadge({ level }: { level: string }) {
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${SEVERITY_STYLES[level] ?? SEVERITY_STYLES.low}`}>
      {SEVERITY_LABELS[level] ?? level}
    </span>
  );
}

function CoverageBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function DimensionRow({
  dim,
  capMap,
}: {
  dim: Dimension;
  capMap: Record<string, Capability>;
}) {
  const [open, setOpen] = useState(false);
  const covered = dim.coverage.length > 0;

  return (
    <div className={`border rounded-lg overflow-hidden ${covered ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
      >
        <span className={`mt-0.5 text-[11px] flex-shrink-0 ${covered ? "text-emerald-500" : "text-slate-300"}`}>
          {covered ? "✓" : "○"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold text-slate-800">{dim.name}</span>
            {dim.tier && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                {dim.tier}
              </span>
            )}
            <SeverityBadge level={dim.severity} />
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{dim.name_en}</p>
        </div>
        <span className="text-[10px] text-slate-300 flex-shrink-0">{open ? "▼" : "▶"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-100 bg-slate-50 text-[11px]">
          <p className="text-slate-600 leading-relaxed pt-2">{dim.description}</p>
          {dim.threshold && (
            <p className="font-mono text-slate-500 bg-white rounded border border-slate-200 px-2 py-1">
              阈值：{dim.threshold}
            </p>
          )}
          <p className="text-slate-400">来源：{dim.source_ref}</p>
          {dim.coverage.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {dim.coverage.map(c => {
                const cap = capMap[c];
                return cap ? (
                  <a
                    key={c}
                    href={cap.path}
                    className="text-[10px] px-2 py-0.5 rounded border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                  >
                    {cap.label} →
                  </a>
                ) : null;
              })}
            </div>
          ) : (
            <p className="text-slate-400 italic">当前平台暂未覆盖此维度</p>
          )}
        </div>
      )}
    </div>
  );
}

function FrameworkCard({
  fw,
  active,
  onClick,
}: {
  fw: Framework;
  active: boolean;
  onClick: () => void;
}) {
  const rate = coverageRate(fw);
  const badgeStyle = BADGE_STYLES[fw.badge_color] ?? BADGE_STYLES.slate;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        active
          ? "border-slate-700 bg-white shadow-sm"
          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${badgeStyle}`}>
          {fw.id.toUpperCase()}
        </span>
        <span className="text-[10px] text-slate-400">{fw.version}</span>
      </div>
      <p className="text-[12px] font-semibold text-slate-800">{fw.name}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{fw.dimensions.length} 个维度</p>
      <div className="mt-2">
        <CoverageBar value={rate} />
      </div>
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function EvalFrameworksPage() {
  const navigate = useNavigate();
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [capMap, setCapMap] = useState<Record<string, Capability>>({});
  const [active, setActive] = useState<string>("internal_v1");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/agent-eval/eval-frameworks")
      .then(r => r.json())
      .then(fws => setFrameworks(fws as Framework[]))
      .catch(() => {})
      .finally(() => setLoading(false));

    // Fetch capability registry from a dedicated endpoint if available
    // For now, embed it client-side (mirrors the backend registry)
    setCapMap({
      type1_eval:      { label: "一类评测（IPI）",  path: "/evals/new" },
      batch_eval:      { label: "批量评测",          path: "/batch-eval" },
      consistency:     { label: "行为一致性探测",     path: "/safety/consistency" },
      eval_awareness:  { label: "评测感知检测",       path: "/safety/eval-awareness" },
      cot_audit:       { label: "CoT 推理审计",       path: "/safety/cot-audit" },
      backdoor_scan:   { label: "后门触发词扫描",     path: "/safety/backdoor-scan" },
      pot_backdoor:    { label: "PoT 后门检测",       path: "/safety/pot-backdoor" },
      memory_poison:   { label: "记忆投毒评测",       path: "/safety/memory-poison" },
      evo_attack:      { label: "进化攻击搜索",       path: "/safety/evo-attack" },
      tool_call_graph: { label: "工具调用图分析",     path: "/analysis/tool-graph" },
      mcp_security:    { label: "MCP 安全评测",       path: "/mcp-security" },
      docker_sandbox:  { label: "Docker 沙箱",        path: "/sandbox" },
      live_monitor:    { label: "实时流量监控",       path: "/live" },
      release_gate:    { label: "发布门 CI",          path: "/release-gate" },
      behavior_trend:  { label: "长期行为追踪",       path: "/behavior/trend" },
      benchmark:       { label: "多模型横评",         path: "/benchmark" },
    });
  }, []);

  const fw = frameworks.find(f => f.id === active);

  // Coverage overview for active framework
  const covered = fw ? fw.dimensions.filter(d => d.coverage.length > 0).length : 0;
  const uncovered = fw ? fw.dimensions.length - covered : 0;

  // Tier grouping (only for internal_v1)
  const tiers = fw?.id === "internal_v1"
    ? ["一类", "二类", "三类"]
    : null;

  return (
    <div className="px-8 py-7 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[15px] font-semibold text-slate-900">评测维度方案</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          四套主流 Agent 安全评测框架，含平台覆盖率分析与维度映射。可直接跳转对应测评工具。
        </p>
      </div>

      {loading && (
        <div className="text-[12px] text-slate-400 animate-pulse">加载中…</div>
      )}

      {!loading && frameworks.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {frameworks.map(f => (
            <FrameworkCard
              key={f.id}
              fw={f}
              active={active === f.id}
              onClick={() => setActive(f.id)}
            />
          ))}
        </div>
      )}

      {fw && (
        <div className="space-y-4">
          {/* Framework header */}
          <div className="border border-slate-200 rounded-lg p-4 bg-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h2 className="text-[14px] font-semibold text-slate-900">{fw.name}</h2>
                  <span className="text-[10px] text-slate-400 font-mono">{fw.version}</span>
                </div>
                <p className="text-[12px] text-slate-600 leading-relaxed">{fw.description}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  来源：{fw.source_url
                    ? <a href={fw.source_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">{fw.source} ↗</a>
                    : fw.source}
                </p>
              </div>
              <div className="text-right flex-shrink-0 space-y-1">
                <div className="text-[11px] text-slate-500">
                  <span className="font-semibold text-emerald-600">{covered}</span>
                  <span className="text-slate-300 mx-1">/</span>
                  <span>{fw.dimensions.length}</span>
                  <span className="ml-1">维度已覆盖</span>
                </div>
                {uncovered > 0 && (
                  <div className="text-[10px] text-slate-400">{uncovered} 个维度待补充</div>
                )}
              </div>
            </div>

            {/* Mini coverage matrix */}
            <div className="mt-3 flex flex-wrap gap-1">
              {fw.dimensions.map(d => (
                <div
                  key={d.id}
                  title={`${d.name}：${d.coverage.length > 0 ? "已覆盖" : "未覆盖"}`}
                  className={`w-4 h-4 rounded-sm ${
                    d.coverage.length > 0
                      ? d.severity === "critical" ? "bg-emerald-500"
                        : d.severity === "high"   ? "bg-emerald-400"
                        : "bg-emerald-300"
                      : "bg-slate-200"
                  }`}
                />
              ))}
              <span className="text-[9px] text-slate-400 self-center ml-1">
                绿色=覆盖，灰色=未覆盖，深浅=严重程度
              </span>
            </div>
          </div>

          {/* Dimensions list */}
          {tiers ? (
            // Grouped by tier for internal_v1
            tiers.map(tier => {
              const dims = fw.dimensions.filter(d => d.tier === tier);
              return (
                <div key={tier}>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    {tier}威胁层
                  </p>
                  <div className="space-y-2">
                    {dims.map(d => (
                      <DimensionRow key={d.id} dim={d} capMap={capMap} />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="space-y-2">
              {fw.dimensions.map(d => (
                <DimensionRow key={d.id} dim={d} capMap={capMap} />
              ))}
            </div>
          )}

          {/* Quick launch */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium text-slate-700">
                按「{fw.name}」方案配置批量评测
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                自动选中与此方案覆盖维度对应的任务域和注入风格
              </p>
            </div>
            <button
              onClick={() => navigate("/batch-eval")}
              className="px-4 py-2 rounded bg-slate-800 text-white text-[12px] font-medium hover:bg-slate-700"
            >
              前往批量评测 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
