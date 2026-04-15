import { useState } from "react";

const API = "http://localhost:18002/api/v1/agent-eval";

const FRAMEWORKS = ["langchain", "crewai", "autogen", "dify"];

const DIMENSIONS = [
  { id: "ipi_defense", name: "IPI 防御", nameEn: "IPI Defense" },
  { id: "permission_model", name: "权限模型", nameEn: "Permission Model" },
  { id: "prompt_leakage", name: "Prompt 泄露", nameEn: "Prompt Leakage" },
  { id: "memory_isolation", name: "记忆隔离", nameEn: "Memory Isolation" },
  { id: "mcp_trust", name: "MCP 信任链", nameEn: "MCP Trust Chain" },
];

interface RiskItem {
  dimension: string;
  severity: string;
  description: string;
  evidence: string;
  source: string;
}

interface DeltaScore {
  dimension: string;
  baseline_score: number;
  custom_score: number;
  delta: number;
}

interface AuditResult {
  audit_id: string;
  framework: string;
  framework_version: string;
  custom_label: string;
  dimension_deltas: DeltaScore[];
  inherited_risks: RiskItem[];
  new_risks: RiskItem[];
  improvements: RiskItem[];
  overall_baseline: number;
  overall_custom: number;
  overall_delta: number;
  created_at: string;
}

function severityBadge(sev: string) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-red-50 text-red-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-green-50 text-green-700",
  };
  return map[sev] ?? "bg-slate-100 text-slate-600";
}

function scorePill(v: number) {
  if (v < 0.3) return "bg-red-50 text-red-700 border-red-200";
  if (v < 0.6) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-green-50 text-green-700 border-green-200";
}

function deltaPill(d: number) {
  if (d > 0.1) return "text-green-700";
  if (d < -0.1) return "text-red-700";
  return "text-slate-500";
}

function RiskCard({ item, accent }: { item: RiskItem; accent: string }) {
  return (
    <div className={`rounded-lg border p-3 ${accent}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">{DIMENSIONS.find((d) => d.id === item.dimension)?.name ?? item.dimension}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${severityBadge(item.severity)}`}>{item.severity}</span>
      </div>
      <p className="text-xs leading-relaxed">{item.description}</p>
      {item.evidence && <p className="text-[10px] mt-1 opacity-70">{item.evidence}</p>}
    </div>
  );
}

function BarChart({ deltas }: { deltas: DeltaScore[] }) {
  const max = 1.0;
  return (
    <div className="space-y-3">
      {deltas.map((d) => {
        const dimName = DIMENSIONS.find((dim) => dim.id === d.dimension)?.name ?? d.dimension;
        return (
          <div key={d.dimension}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-700 font-medium">{dimName}</span>
              <span className={`font-mono text-xs ${deltaPill(d.delta)}`}>
                Δ {d.delta > 0 ? "+" : ""}{(d.delta * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex gap-1 items-center">
              <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden relative">
                <div
                  className="absolute inset-y-0 left-0 bg-slate-300 rounded-l"
                  style={{ width: `${(d.baseline_score / max) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-l"
                  style={{
                    width: `${(d.custom_score / max) * 100}%`,
                    background: d.delta >= 0 ? "#22c55e" : "#ef4444",
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className="text-[10px] text-slate-400 font-mono w-16 text-right shrink-0">
                {(d.baseline_score * 100).toFixed(0)} → {(d.custom_score * 100).toFixed(0)}
              </span>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-4 text-[10px] text-slate-400 pt-1">
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-slate-300 rounded inline-block" /> 基线</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-400/60 rounded inline-block" /> 二开（提升）</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-400/60 rounded inline-block" /> 二开（退化）</span>
      </div>
    </div>
  );
}

export default function DeltaAuditPage() {
  const [framework, setFramework] = useState(FRAMEWORKS[0]);
  const [customLabel, setCustomLabel] = useState("");
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(DIMENSIONS.map((d) => [d.id, 50]))
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const body = {
        framework,
        custom_label: customLabel,
        custom_scores: Object.fromEntries(
          Object.entries(scores).map(([k, v]) => [k, v / 100])
        ),
      };
      const res = await fetch(`${API}/delta-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">二开安全审计</h1>
        <p className="text-slate-500 mt-1">
          对比开源框架安全基线与二次开发产物，识别继承性风险、新增风险及改善项
        </p>
      </div>

      {/* Input panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">基线框架</label>
            <select
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {FRAMEWORKS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">自定义标签</label>
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="例：内部 v2.1 加固版"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">二开产物安全评分（0–100）</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {DIMENSIONS.map((dim) => (
              <div key={dim.id} className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-xs text-slate-700">{dim.name}</span>
                  <span className="text-xs font-mono text-slate-500">{scores[dim.id]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={scores[dim.id]}
                  onChange={(e) => setScores({ ...scores, [dim.id]: Number(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-slate-200 accent-blue-600"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={loading}
          className="rounded-lg bg-slate-900 text-white px-5 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {loading ? "审计中…" : "开始审计"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      )}

      {result && (
        <>
          {/* Overall badges */}
          <div className="flex flex-wrap gap-4">
            <div className={`rounded-lg border px-4 py-3 ${scorePill(result.overall_baseline)}`}>
              <div className="text-[10px] font-medium uppercase tracking-wide opacity-70">基线综合</div>
              <div className="text-xl font-bold">{(result.overall_baseline * 100).toFixed(0)}%</div>
              <div className="text-xs opacity-70">{result.framework} {result.framework_version}</div>
            </div>
            <div className={`rounded-lg border px-4 py-3 ${scorePill(result.overall_custom)}`}>
              <div className="text-[10px] font-medium uppercase tracking-wide opacity-70">二开综合</div>
              <div className="text-xl font-bold">{(result.overall_custom * 100).toFixed(0)}%</div>
              <div className="text-xs opacity-70">{result.custom_label || "自定义"}</div>
            </div>
            <div className={`rounded-lg border border-slate-200 px-4 py-3 bg-white`}>
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Delta</div>
              <div className={`text-xl font-bold ${deltaPill(result.overall_delta)}`}>
                {result.overall_delta > 0 ? "+" : ""}{(result.overall_delta * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-slate-400">
                {result.overall_delta > 0.05 ? "安全性提升" : result.overall_delta < -0.05 ? "安全性退化" : "基本持平"}
              </div>
            </div>
          </div>

          {/* Three-column risk panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div>
              <h2 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                继承性风险
                <span className="text-xs font-normal text-slate-400">({result.inherited_risks.length})</span>
              </h2>
              <div className="space-y-2">
                {result.inherited_risks.length === 0 && (
                  <p className="text-xs text-slate-400 italic">无继承性风险</p>
                )}
                {result.inherited_risks.map((r, i) => (
                  <RiskCard key={i} item={r} accent="border-red-200 bg-red-50/50" />
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                新增风险
                <span className="text-xs font-normal text-slate-400">({result.new_risks.length})</span>
              </h2>
              <div className="space-y-2">
                {result.new_risks.length === 0 && (
                  <p className="text-xs text-slate-400 italic">无新增风险</p>
                )}
                {result.new_risks.map((r, i) => (
                  <RiskCard key={i} item={r} accent="border-amber-200 bg-amber-50/50" />
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-green-700 mb-3 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                改善项
                <span className="text-xs font-normal text-slate-400">({result.improvements.length})</span>
              </h2>
              <div className="space-y-2">
                {result.improvements.length === 0 && (
                  <p className="text-xs text-slate-400 italic">无改善项</p>
                )}
                {result.improvements.map((r, i) => (
                  <RiskCard key={i} item={r} accent="border-green-200 bg-green-50/50" />
                ))}
              </div>
            </div>
          </div>

          {/* Delta bar chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">维度对比（基线 vs 二开）</h2>
            <BarChart deltas={result.dimension_deltas} />
          </div>
        </>
      )}
    </div>
  );
}
