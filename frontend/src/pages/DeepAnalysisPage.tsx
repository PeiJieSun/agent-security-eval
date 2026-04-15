import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader } from "../components/AppShell";

type DeepResult = Awaited<ReturnType<typeof api.getDeepAnalysis>>;
type Framework = { id: string; name: string; pattern_count: number };

const SEV_STYLE: Record<string, string> = {
  critical: "bg-red-50 text-red-800 border-red-200",
  high: "bg-orange-50 text-orange-800 border-orange-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-slate-50 text-slate-600 border-slate-200",
};

const LINK_TYPE_LABEL: Record<string, string> = {
  l1_l2: "L1 → L2",
  l2_l3: "L2 → L3",
  l1_l3: "L1 → L3",
  l1_l2_l3: "L1 → L2 → L3",
  l2_defense: "L2 → 防御建议",
};

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`} />
  );
}

export default function DeepAnalysisPage() {
  const [models, setModels] = useState<string[]>([]);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [model, setModel] = useState("");
  const [framework, setFramework] = useState("");
  const [result, setResult] = useState<DeepResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getReportModels().then(setModels).catch(() => {});
    api.listAuditableFrameworks().then(setFrameworks).catch(() => {});
  }, []);

  const run = async () => {
    if (!model) return;
    setLoading(true);
    setError("");
    try {
      const r = await api.getDeepAnalysis(model, framework);
      setResult(r);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const l1 = result?.layer1_behavioral as Record<string, any> | undefined;
  const l2 = result?.layer2_source_audit as Record<string, any> | undefined;
  const l3 = result?.layer3_taint_analysis as Record<string, any> | undefined;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="三层深度分析"
        subtitle="L1 行为测试 × L2 源码审计 × L3 污点追踪 — 从行为异常到源码根因到攻击路径证明"
      />

      {/* Controls */}
      <div className="flex items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-slate-500 mb-1">模型</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm min-w-[200px]"
          >
            <option value="">选择模型…</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">框架（L2 源码审计）</label>
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm min-w-[180px]"
          >
            <option value="">不指定</option>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>{f.name} ({f.pattern_count} 已知模式)</option>
            ))}
          </select>
        </div>
        <button
          onClick={run}
          disabled={!model || loading}
          className="px-4 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-40"
        >
          {loading ? "分析中…" : "运行三层分析"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4">{error}</div>
      )}

      {result && (
        <div className="space-y-5">
          {/* Layer status summary */}
          <div className="flex gap-4">
            <div className="flex-1 rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot active={l1?.batch?.status === "done"} />
                <span className="text-sm font-semibold text-slate-900">Layer 1: 行为测试</span>
              </div>
              {l1?.batch?.status === "done" ? (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500">正常完成率</div>
                    <div className="text-base font-mono font-semibold text-slate-900">
                      {l1.batch.benign_utility != null ? `${(l1.batch.benign_utility * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">攻击下完成率</div>
                    <div className="text-base font-mono font-semibold text-slate-900">
                      {l1.batch.utility_under_attack != null ? `${(l1.batch.utility_under_attack * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">攻击成功率</div>
                    <div className={`text-base font-mono font-semibold ${l1.batch.targeted_asr > 0.15 ? "text-red-700" : "text-emerald-700"}`}>
                      {l1.batch.targeted_asr != null ? `${(l1.batch.targeted_asr * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">未运行批量评测</p>
              )}
            </div>

            <div className="flex-1 rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot active={l2?.status === "done"} />
                <span className="text-sm font-semibold text-slate-900">Layer 2: 源码审计</span>
              </div>
              {l2?.status === "done" ? (
                <div className="text-xs space-y-1">
                  <div className="flex gap-4">
                    <span className="text-slate-500">扫描: {l2.files_scanned} 文件 / {l2.lines_scanned} 行</span>
                    <span className="text-slate-500">{l2.scan_duration_ms}ms</span>
                  </div>
                  <div className="flex gap-2">
                    {Object.entries(l2.vuln_by_severity || {}).map(([sev, cnt]) => (
                      <span key={sev} className={`px-2 py-0.5 rounded border text-xs font-medium ${SEV_STYLE[sev] || SEV_STYLE.low}`}>
                        {sev}: {cnt as number}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">{l2?.message || "未运行"}</p>
              )}
            </div>

            <div className="flex-1 rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot active={l3?.status === "done"} />
                <span className="text-sm font-semibold text-slate-900">Layer 3: 污点追踪</span>
              </div>
              {l3?.status === "done" ? (
                <div className="text-xs space-y-1">
                  <div className="flex gap-4">
                    <span className="text-slate-500">{l3.total_traces} 条轨迹分析</span>
                    <span className={`font-medium ${(l3.total_attack_chains as number) > 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {l3.total_attack_chains} 条攻击链
                    </span>
                  </div>
                  <div className="text-slate-500">
                    平均污点覆盖率: {((l3.avg_taint_coverage as number) * 100).toFixed(1)}%
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">{l3?.message || "未运行"}</p>
              )}
            </div>
          </div>

          {/* Cross-layer evidence links */}
          {result.cross_layer_links.length > 0 && (
            <div className="rounded-xl border p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">跨层证据链</h2>
              {result.has_full_chain && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-3 text-sm text-red-900">
                  <span className="font-semibold">完整三层证据链闭环</span> — 从行为异常到源码漏洞到运行时利用的完整因果链已确认。
                </div>
              )}
              <div className="space-y-2">
                {result.cross_layer_links.map((link, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${SEV_STYLE[link.severity] || SEV_STYLE.medium}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-white/60">
                        {LINK_TYPE_LABEL[link.type] || link.type}
                      </span>
                      <span className="text-sm font-medium">{link.title}</span>
                    </div>
                    <p className="text-xs leading-relaxed">{link.evidence}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* L2 Top Vulnerabilities */}
          {l2?.status === "done" && (l2.top_vulns as any[])?.length > 0 && (
            <div className="rounded-xl border p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                L2 源码漏洞 Top {(l2.top_vulns as any[]).length}
              </h2>
              <div className="space-y-2">
                {(l2.top_vulns as any[]).map((v: any) => (
                  <div key={v.vuln_id} className="flex gap-3 items-start text-xs border rounded-lg p-2.5">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded border font-medium ${SEV_STYLE[v.severity] || SEV_STYLE.low}`}>
                      {v.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900">{v.title}</div>
                      <div className="text-slate-500 mt-0.5">
                        <span className="font-mono">{v.file}:{v.line}</span>
                        <span className="mx-1.5">·</span>
                        <span>{v.cwe_id}</span>
                      </div>
                      {v.snippet && (
                        <pre className="mt-1.5 p-2 bg-slate-50 rounded text-[10px] font-mono text-slate-700 overflow-x-auto max-h-24">
                          {v.snippet}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* L3 Top Attack Chains */}
          {l3?.status === "done" && (l3.top_attack_chains as any[])?.length > 0 && (
            <div className="rounded-xl border p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">
                L3 已确认攻击链
              </h2>
              <div className="space-y-2">
                {(l3.top_attack_chains as any[]).map((chain: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-800 font-medium">
                        攻击链 #{i + 1}
                      </span>
                      <span className="text-slate-500">置信度 {(chain.confidence * 100).toFixed(0)}%</span>
                      <span className="text-slate-400">task: {chain.task_id}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-800">
                      <span className="font-mono bg-blue-50 px-1.5 py-0.5 rounded">
                        {chain.source_tool}() [Step {chain.source_step}]
                      </span>
                      <span className="text-slate-400">→</span>
                      {chain.propagation_mechanisms?.map((m: string, j: number) => (
                        <span key={j} className="font-mono bg-amber-50 px-1.5 py-0.5 rounded text-amber-800">
                          {m}
                        </span>
                      ))}
                      <span className="text-slate-400">→</span>
                      <span className="font-mono bg-red-50 px-1.5 py-0.5 rounded text-red-800">
                        {chain.sink_tool}({chain.sink_arg}) [Step {chain.sink_step}]
                      </span>
                    </div>
                    <p className="text-slate-500 mt-1">{chain.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Propagation mechanism breakdown */}
          {l3?.status === "done" && Object.keys(l3.propagation_mechanisms || {}).length > 0 && (
            <div className="rounded-xl border p-4">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">污点传播机制分布</h2>
              <div className="flex gap-3">
                {Object.entries(l3.propagation_mechanisms as Record<string, number>).map(([mech, count]) => (
                  <div key={mech} className="text-center px-4 py-2 rounded-lg bg-slate-50 border">
                    <div className="text-lg font-mono font-semibold text-slate-900">{count}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{mech}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
