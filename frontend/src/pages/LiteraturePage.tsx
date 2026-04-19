import { useEffect, useState } from "react";

const API = "/api/v1/agent-eval/literature";
const SCAN_API = "/api/v1/agent-eval/skill-scan";

interface Paper {
  id: string; title: string; authors: string; venue: string; year: number; month: number;
  arxiv_id: string; url: string; category: string; relevance: string;
  key_finding: string; our_relation: string; tags: string[];
}
interface Contribution { id: string; title: string; description: string; differentiator: string; layers: string[]; }
interface Positioning { contributions: Contribution[]; total_related_papers: number; attack_papers: number; defense_papers: number; benchmark_papers: number; gap_statement: string; }
interface BatchResult {
  batch_id: string; total_samples: number; malicious_count: number; benign_count: number;
  true_positives: number; false_positives: number; true_negatives: number; false_negatives: number;
  precision: number; recall: number; f1: number;
  per_layer_stats: Record<string, { tp: number; fp: number; tn: number; fn: number }>;
  per_attack_type: Record<string, { total: number; detected: number }>;
  sample_results: any[]; elapsed_ms: number;
}

const CAT_STYLE: Record<string, string> = {
  attack: "bg-red-100 text-red-800", defense: "bg-emerald-100 text-emerald-800",
  benchmark: "bg-blue-100 text-blue-800", survey: "bg-purple-100 text-purple-800",
  empirical: "bg-amber-100 text-amber-800", threat_model: "bg-orange-100 text-orange-800",
};
const CAT_LABEL: Record<string, string> = {
  attack: "攻击", defense: "防御", benchmark: "评测", survey: "综述", empirical: "实证", threat_model: "威胁建模",
};

export default function LiteraturePage() {
  const [tab, setTab] = useState<"survey" | "positioning" | "benchmark">("survey");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [positioning, setPositioning] = useState<Positioning | null>(null);
  const [filterCat, setFilterCat] = useState("");
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [expandedPaper, setExpandedPaper] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/papers`).then(r => r.json()).then(setPapers).catch(() => {});
    fetch(`${API}/positioning`).then(r => r.json()).then(setPositioning).catch(() => {});
  }, []);

  const filteredPapers = filterCat ? papers.filter(p => p.category === filterCat) : papers;

  const runBenchmark = async () => {
    setBatchLoading(true); setBatchResult(null);
    try {
      const res = await fetch(`${SCAN_API}/benchmark/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers: ["L1", "L2", "L4", "L5"] }),
      });
      if (res.ok) setBatchResult(await res.json());
    } catch {}
    finally { setBatchLoading(false); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">文献调研与学术定位</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          Agent Skill 配置安全的学术景观、本工作定位、批量评测
        </p>
      </div>

      <div className="flex gap-2">
        {(["survey", "positioning", "benchmark"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded border ${tab === t ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
            {t === "survey" ? `文献综述 (${papers.length})` : t === "positioning" ? "学术定位" : "批量评测"}
          </button>
        ))}
      </div>

      {/* ============ SURVEY TAB ============ */}
      {tab === "survey" && (
        <div className="space-y-4">
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setFilterCat("")}
              className={`text-[10px] px-2 py-0.5 rounded ${!filterCat ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}>全部</button>
            {Object.entries(CAT_LABEL).map(([k, v]) => (
              <button key={k} onClick={() => setFilterCat(k)}
                className={`text-[10px] px-2 py-0.5 rounded ${filterCat === k ? "bg-slate-800 text-white" : CAT_STYLE[k]}`}>{v}</button>
            ))}
          </div>

          {filteredPapers.map(p => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${CAT_STYLE[p.category] || "bg-slate-100"}`}>
                      {CAT_LABEL[p.category] || p.category}
                    </span>
                    <span className="text-[10px] text-slate-400">{p.year}.{String(p.month).padStart(2, "0")}</span>
                    {p.venue && <span className="text-[10px] text-slate-400">{p.venue}</span>}
                  </div>
                  <a href={p.url} target="_blank" rel="noreferrer"
                    className="text-[13px] font-medium text-blue-700 hover:underline leading-snug">{p.title}</a>
                  {p.authors && <p className="text-[10px] text-slate-400 mt-0.5">{p.authors}</p>}
                </div>
                <button onClick={() => setExpandedPaper(expandedPaper === p.id ? null : p.id)}
                  className="text-[10px] text-slate-400 shrink-0 px-2 py-1 rounded hover:bg-slate-50">
                  {expandedPaper === p.id ? "收起" : "展开"}
                </button>
              </div>

              {p.relevance && (
                <div className="flex gap-1">
                  {p.relevance.split(",").map(r => r.trim()).map(r => (
                    <span key={r} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{r}</span>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-slate-600 leading-relaxed">{p.key_finding}</p>

              {expandedPaper === p.id && (
                <div className="border-t border-slate-100 pt-2 space-y-2">
                  <div>
                    <h4 className="text-[10px] font-semibold text-slate-500 uppercase">与本工作的关系</h4>
                    <p className="text-[11px] text-slate-700 mt-0.5">{p.our_relation}</p>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {p.tags.map(t => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t}</span>
                    ))}
                  </div>
                  {p.arxiv_id && (
                    <a href={`https://arxiv.org/abs/${p.arxiv_id}`} target="_blank" rel="noreferrer"
                      className="text-[10px] text-blue-500 hover:underline">arXiv: {p.arxiv_id}</a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ============ POSITIONING TAB ============ */}
      {tab === "positioning" && positioning && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-2">研究空白</h2>
            <p className="text-[12px] text-slate-700 leading-relaxed">{positioning.gap_statement}</p>
            <div className="flex gap-4 mt-3">
              <Stat label="相关论文" value={positioning.total_related_papers} />
              <Stat label="攻击方法" value={positioning.attack_papers} color="text-red-700" />
              <Stat label="防御方法" value={positioning.defense_papers} color="text-emerald-700" />
              <Stat label="评测基准" value={positioning.benchmark_papers} color="text-blue-700" />
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-5">
            <h2 className="text-sm font-semibold text-blue-900 mb-3">本工作的独特贡献</h2>
            <div className="space-y-4">
              {positioning.contributions.map(c => (
                <div key={c.id} className="rounded-lg border border-blue-100 bg-white p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[13px] font-semibold text-slate-900">{c.title}</h3>
                    {c.layers.map(l => (
                      <span key={l} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{l}</span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">{c.description}</p>
                  <p className="text-[10px] text-slate-500 mt-2 italic">{c.differentiator}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============ BENCHMARK TAB ============ */}
      {tab === "benchmark" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">批量评测</h2>
            <p className="text-[11px] text-slate-500">
              在内置对抗样本库（灵感来自 DDIPE, SkillTrojan, BADSKILL）和良性样本上测试五层扫描器的检出率、误报率。
            </p>
            <button onClick={runBenchmark} disabled={batchLoading}
              className="text-xs px-4 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40">
              {batchLoading ? "测试中…" : "运行批量测试"}
            </button>
          </div>

          {batchResult && (
            <>
              {/* Overall metrics */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-xs font-semibold text-slate-700 mb-3">总体指标</h3>
                <div className="grid grid-cols-4 gap-3">
                  <MetricCard label="Precision" value={batchResult.precision} />
                  <MetricCard label="Recall" value={batchResult.recall} />
                  <MetricCard label="F1 Score" value={batchResult.f1} />
                  <MetricCard label="耗时" value={batchResult.elapsed_ms} unit="ms" raw />
                </div>
                <div className="grid grid-cols-4 gap-3 mt-3">
                  <MiniStat label="True Positive" value={batchResult.true_positives} color="text-emerald-700" />
                  <MiniStat label="False Positive" value={batchResult.false_positives} color="text-red-600" />
                  <MiniStat label="True Negative" value={batchResult.true_negatives} color="text-emerald-700" />
                  <MiniStat label="False Negative" value={batchResult.false_negatives} color="text-red-600" />
                </div>
              </div>

              {/* Per attack type */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-xs font-semibold text-slate-700 mb-2">按攻击类型检出率</h3>
                <div className="space-y-1">
                  {Object.entries(batchResult.per_attack_type).map(([at, stats]) => (
                    <div key={at} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 text-slate-600 font-medium">{at || "none"}</span>
                      <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                        <div className="h-full bg-blue-500 rounded" style={{ width: `${(stats.detected / Math.max(stats.total, 1)) * 100}%` }} />
                      </div>
                      <span className="text-slate-500 w-16 text-right">{stats.detected}/{stats.total}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per layer stats */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-xs font-semibold text-slate-700 mb-2">分层检出能力</h3>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(batchResult.per_layer_stats).map(([layer, stats]) => {
                    const layerP = stats.tp / Math.max(stats.tp + stats.fp, 1);
                    const layerR = stats.tp / Math.max(stats.tp + stats.fn, 1);
                    return (
                      <div key={layer} className="rounded-lg border border-slate-100 p-3 text-center">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">{layer}</div>
                        <div className="text-lg font-bold text-slate-800 mt-1">{(layerR * 100).toFixed(0)}%</div>
                        <div className="text-[9px] text-slate-400">Recall</div>
                        <div className="text-[10px] text-slate-500 mt-1">P={layerP.toFixed(2)} TP={stats.tp} FP={stats.fp}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sample details */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-xs font-semibold text-slate-700 mb-2">逐样本结果</h3>
                <div className="space-y-1">
                  {batchResult.sample_results.map((s: any) => (
                    <div key={s.sample_id} className={`flex items-center gap-2 text-[11px] py-1.5 px-2 rounded ${s.correct ? "bg-emerald-50" : "bg-red-50"}`}>
                      <span className={`w-3 h-3 rounded-full ${s.correct ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="w-20 text-slate-400 font-mono">{s.sample_id}</span>
                      <span className="flex-1 text-slate-700 truncate">{s.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${s.ground_truth === "malicious" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {s.ground_truth}
                      </span>
                      <span className="text-slate-400 w-14 text-right">{s.findings_count} 发现</span>
                      <span className="text-slate-400 w-12 text-right">{s.overall_score != null ? `${(s.overall_score * 100).toFixed(0)}%` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = "text-slate-800" }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

function MetricCard({ label, value, unit, raw }: { label: string; value: number; unit?: string; raw?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 p-3 text-center">
      <div className="text-[10px] text-slate-400 uppercase">{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-1">
        {raw ? value : `${(value * 100).toFixed(1)}%`}
      </div>
      {unit && <div className="text-[9px] text-slate-400">{unit}</div>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-slate-400">{label}</div>
    </div>
  );
}
