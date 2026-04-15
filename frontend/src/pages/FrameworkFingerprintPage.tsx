import { useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DimensionScore {
  dimension: string;
  score: number;
  detail: string;
  test_count: number;
  pass_count: number;
}

interface Fingerprint {
  fingerprint_id: string;
  framework: string;
  framework_version: string;
  scores: DimensionScore[];
  overall_score: number;
  created_at: string;
  notes: string;
}

interface Dimension {
  id: string;
  name: string;
  name_en: string;
  weight: number;
}

interface CompareResponse {
  frameworks: Fingerprint[];
  dimensions: Dimension[];
}

const API = "http://localhost:18002/api/v1/agent-eval";

const FRAMEWORK_COLORS: Record<string, string> = {
  langchain: "#3b82f6",
  crewai: "#8b5cf6",
  autogen: "#ef4444",
  dify: "#22c55e",
};

function scoreColor(v: number): string {
  if (v < 0.3) return "#ef4444";
  if (v < 0.6) return "#f59e0b";
  return "#22c55e";
}

function scoreBg(v: number): string {
  if (v < 0.3) return "bg-red-50 text-red-700";
  if (v < 0.6) return "bg-amber-50 text-amber-700";
  return "bg-green-50 text-green-700";
}

// ── Radar chart (SVG pentagon) ───────────────────────────────────────────────

function RadarChart({ frameworks, dimensions }: { frameworks: Fingerprint[]; dimensions: Dimension[] }) {
  const cx = 160, cy = 150, R = 110;
  const n = dimensions.length;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  const vertex = (i: number, r: number) => {
    const a = startAngle + i * angleStep;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  const rings = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg viewBox="0 0 320 310" className="w-full" style={{ maxWidth: 400 }}>
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={Array.from({ length: n }, (_, i) => vertex(i, R * ring).join(",")).join(" ")}
          fill="none" stroke="#e2e8f0" strokeWidth={1}
        />
      ))}
      {dimensions.map((_, i) => {
        const [x, y] = vertex(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth={1} />;
      })}
      {dimensions.map((dim, i) => {
        const [x, y] = vertex(i, R + 18);
        return (
          <text key={dim.id} x={x} y={y} textAnchor="middle" dominantBaseline="central"
            className="text-[10px] fill-slate-500 font-medium">{dim.name}</text>
        );
      })}

      {frameworks.map((fp) => {
        const dimMap: Record<string, number> = {};
        fp.scores.forEach((s) => { dimMap[s.dimension] = s.score; });
        const pts = dimensions.map((dim, i) => vertex(i, R * (dimMap[dim.id] ?? 0)).join(",")).join(" ");
        const color = FRAMEWORK_COLORS[fp.framework] ?? "#64748b";
        return (
          <polygon key={fp.framework} points={pts}
            fill={color} fillOpacity={0.12} stroke={color} strokeWidth={2} />
        );
      })}
    </svg>
  );
}

// ── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: scoreColor(score) }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color: scoreColor(score) }}>{pct}%</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function FrameworkFingerprintPage() {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState("");
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/framework-fingerprints/compare`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 text-red-700 rounded-lg p-4">加载失败: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <div className="animate-pulse text-slate-400">加载框架指纹数据…</div>
      </div>
    );
  }

  const { frameworks, dimensions } = data;

  const dimScore = (fp: Fingerprint, dimId: string): DimensionScore | undefined =>
    fp.scores.find((s) => s.dimension === dimId);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">开源框架安全指纹</h1>
        <p className="text-slate-500 mt-1">
          对主流开源 Agent 框架在 5 个安全维度上的基线评估。分数越高，安全性越好。
        </p>
      </div>

      {/* Top cards: per-framework summary + radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Radar chart */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">雷达对比</h2>
          <RadarChart frameworks={frameworks} dimensions={dimensions} />
          <div className="flex flex-wrap gap-3 mt-3 justify-center">
            {frameworks.map((fp) => (
              <div key={fp.framework} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ background: FRAMEWORK_COLORS[fp.framework] ?? "#64748b" }} />
                {fp.framework}
              </div>
            ))}
          </div>
        </div>

        {/* Framework summary cards */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {frameworks.map((fp) => {
            const color = FRAMEWORK_COLORS[fp.framework] ?? "#64748b";
            return (
              <div key={fp.framework} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: color }} />
                  <span className="font-semibold text-slate-900 capitalize">{fp.framework}</span>
                </div>
                <span className="text-xs text-slate-400">v{fp.framework_version}</span>
                <div className="mt-auto">
                  <span className={`inline-block px-2 py-0.5 rounded text-sm font-bold ${scoreBg(fp.overall_score)}`}>
                    {Math.round(fp.overall_score * 100)}%
                  </span>
                  <span className="text-xs text-slate-400 ml-1">综合</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Comparison table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-4 py-3 text-slate-500 font-medium w-44">维度</th>
              {frameworks.map((fp) => (
                <th key={fp.framework} className="text-left px-4 py-3 font-semibold text-slate-700 capitalize">
                  {fp.framework}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dimensions.map((dim) => (
              <tr key={dim.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{dim.name}</div>
                  <div className="text-xs text-slate-400">{dim.name_en} · 权重 {Math.round(dim.weight * 100)}%</div>
                </td>
                {frameworks.map((fp) => {
                  const ds = dimScore(fp, dim.id);
                  const cellKey = `${fp.framework}-${dim.id}`;
                  return (
                    <td key={fp.framework} className="px-4 py-3 relative"
                      onMouseEnter={() => setHoveredCell(cellKey)}
                      onMouseLeave={() => setHoveredCell(null)}>
                      {ds ? (
                        <>
                          <ScoreBar score={ds.score} />
                          {ds.test_count > 0 && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {ds.pass_count}/{ds.test_count} passed
                            </div>
                          )}
                          {hoveredCell === cellKey && (
                            <div className="absolute z-30 left-0 top-full mt-1 w-64 bg-slate-800 text-white text-xs rounded-lg p-3 shadow-xl">
                              {ds.detail}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Overall row */}
            <tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-3 text-slate-700">综合评分</td>
              {frameworks.map((fp) => (
                <td key={fp.framework} className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-sm ${scoreBg(fp.overall_score)}`}>
                    {Math.round(fp.overall_score * 100)}%
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div className="text-xs text-slate-400 space-y-1">
        {frameworks.map((fp) => fp.notes ? (
          <div key={fp.framework}><span className="font-medium capitalize">{fp.framework}:</span> {fp.notes}</div>
        ) : null)}
      </div>
    </div>
  );
}
