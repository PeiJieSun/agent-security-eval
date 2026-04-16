import { useEffect, useState, useRef, useCallback } from "react";

const API = "/api/v1/agent-eval/skill-scan";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Finding {
  finding_id: string; severity: string; category: string; title: string;
  description: string; file_path: string; line_number: number;
  matched_text: string; recommendation: string; layer: string;
}
interface ScannedFile { path: string; file_type: string; size_bytes: number; findings: Finding[]; }
interface ScanReport {
  scan_id: string; target_path: string; files_scanned: number; total_findings: number;
  critical_count: number; high_count: number; medium_count: number; low_count: number;
  files: ScannedFile[]; summary: string;
}
interface LayerStatus {
  layer: string; layer_name: string; status: string;
  score: number | null; findings_count: number; elapsed_ms: number;
}
interface DeepResult {
  scan_id: string; overall_score: number | null; overall_verdict: string;
  layers: LayerStatus[]; detail: any | null;
}
interface PathInfo { path: string; label: string; exists: boolean; }

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const SEV: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
  info: "bg-blue-50 text-blue-600 border-blue-200",
};
const CAT: Record<string, string> = {
  injection: "注入指令", invisible_char: "不可见字符", mcp_config: "MCP 配置",
  encoding: "编码混淆", semantic: "语义偏差", capability: "能力风险",
  behavior: "行为偏差", supply_chain: "供应链", composition: "组合冲突",
};
const VERDICT_STYLE: Record<string, string> = {
  safe: "text-emerald-700 bg-emerald-50 border-emerald-200",
  suspicious: "text-amber-700 bg-amber-50 border-amber-200",
  dangerous: "text-red-700 bg-red-50 border-red-200",
  unknown: "text-slate-500 bg-slate-50 border-slate-200",
};
const VERDICT_LABEL: Record<string, string> = {
  safe: "安全", suspicious: "可疑", dangerous: "危险", unknown: "未知",
};

const ALL_LAYERS = ["L1", "L2", "L3", "L4", "L5"];
const LAYER_NAMES: Record<string, string> = {
  L1: "文本语义", L2: "能力图谱", L3: "行为验证", L4: "供应链", L5: "组合安全",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SkillScanPage() {
  const [scanPath, setScanPath] = useState("");
  const [commonPaths, setCommonPaths] = useState<{ global_paths: PathInfo[]; project_paths: PathInfo[] } | null>(null);
  const [mode, setMode] = useState<"quick" | "deep">("deep");
  const [layers, setLayers] = useState<string[]>(["L1", "L2", "L4", "L5"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick scan state
  const [quickReport, setQuickReport] = useState<ScanReport | null>(null);
  const [quickContent, setQuickContent] = useState("");
  const [quickContentType, setQuickContentType] = useState("skill");
  const [quickMode, setQuickMode] = useState<"path" | "content">("path");

  // Deep scan state
  const [deep, setDeep] = useState<DeepResult | null>(null);
  const [activeLayer, setActiveLayer] = useState("L1");
  const [layerDetail, setLayerDetail] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/common-paths`).then(r => r.json()).then(setCommonPaths).catch(() => {});
  }, []);

  // ---- Quick scan ----
  const doQuickScan = async (path?: string, content?: string) => {
    setLoading(true); setError(null); setQuickReport(null);
    try {
      let res;
      if (content) {
        res = await fetch(`${API}/content`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, file_name: "<paste>", file_type: quickContentType }),
        });
      } else {
        res = await fetch(`${API}/directory`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: path || scanPath }),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (content) {
        setQuickReport({
          scan_id: "content", target_path: "<paste>", files_scanned: 1,
          total_findings: data.findings?.length ?? 0,
          critical_count: data.findings?.filter((f: Finding) => f.severity === "critical").length ?? 0,
          high_count: data.findings?.filter((f: Finding) => f.severity === "high").length ?? 0,
          medium_count: data.findings?.filter((f: Finding) => f.severity === "medium").length ?? 0,
          low_count: data.findings?.filter((f: Finding) => f.severity === "low").length ?? 0,
          files: [data], summary: `Found ${data.findings?.length ?? 0} issues`,
        });
      } else {
        setQuickReport(data);
      }
    } catch (e: any) { setError(String(e)); }
    finally { setLoading(false); }
  };

  // ---- Deep scan (SSE) ----
  const doDeepScan = useCallback(async () => {
    if (!scanPath.trim()) return;
    setLoading(true); setError(null); setDeep(null); setLayerDetail(null);
    const result: DeepResult = { scan_id: "", overall_score: null, overall_verdict: "unknown", layers: [], detail: null };
    setDeep({ ...result });

    try {
      const res = await fetch(`${API}/deep`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: scanPath, layers }),
      });
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "layer_done") {
                result.layers = [...result.layers.filter(l => l.layer !== data.layer), data];
                setDeep({ ...result });
              } else if (eventType === "complete") {
                result.scan_id = data.scan_id;
                result.overall_score = data.overall_score;
                result.overall_verdict = data.overall_verdict;
                setDeep({ ...result });
              }
            } catch {}
          }
        }
      }
    } catch (e: any) { setError(String(e)); }
    finally { setLoading(false); }
  }, [scanPath, layers]);

  // Load layer detail
  const loadLayerDetail = useCallback(async (scanId: string, layer: string) => {
    if (!scanId) return;
    try {
      const res = await fetch(`${API}/deep/reports/${scanId}/layer/${layer}`);
      if (res.ok) setLayerDetail(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (deep?.scan_id && activeLayer) loadLayerDetail(deep.scan_id, activeLayer);
  }, [deep?.scan_id, activeLayer, loadLayerDetail]);

  const toggleLayer = (l: string) => setLayers(prev =>
    prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]
  );

  // ---- Render ----
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">Skill / Rules 安全扫描</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          五层深度分析: 文本语义 → 能力图谱 → 行为验证 → 供应链溯源 → 组合安全
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {(["deep", "quick"] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); }}
            className={`text-xs px-3 py-1.5 rounded border ${mode === m ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
            {m === "deep" ? "深度扫描 (五层)" : "快速扫描 (静态)"}
          </button>
        ))}
      </div>

      {/* ============ DEEP SCAN ============ */}
      {mode === "deep" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">深度扫描</h2>
            {commonPaths && (
              <div className="flex flex-wrap gap-2">
                {[...commonPaths.global_paths, ...commonPaths.project_paths].filter(p => p.exists).map(p => (
                  <button key={p.path} onClick={() => setScanPath(p.path)}
                    className={`text-[11px] px-2.5 py-1 rounded border ${scanPath === p.path ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={scanPath} onChange={e => setScanPath(e.target.value)}
                placeholder="扫描路径..." className="flex-1 border rounded px-3 py-1.5 text-xs text-slate-700" />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-slate-500">分析层:</span>
              {ALL_LAYERS.map(l => (
                <label key={l} className="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={layers.includes(l)} onChange={() => toggleLayer(l)} className="rounded" />
                  {l} {LAYER_NAMES[l]}
                </label>
              ))}
              <button onClick={doDeepScan} disabled={!scanPath.trim() || loading || layers.length === 0}
                className="ml-auto text-xs px-4 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40">
                {loading ? "扫描中…" : "开始深度扫描"}
              </button>
            </div>
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

          {/* Progress */}
          {deep && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-xs font-semibold text-slate-700">扫描进度</h3>
              <div className="grid grid-cols-5 gap-2">
                {ALL_LAYERS.filter(l => layers.includes(l)).map(l => {
                  const lr = deep.layers.find(x => x.layer === l);
                  const done = lr?.status === "done";
                  const skipped = lr?.status === "skipped";
                  return (
                    <div key={l} className={`rounded-lg border p-3 text-center transition-all ${done ? "border-emerald-200 bg-emerald-50" : skipped ? "border-slate-200 bg-slate-50" : loading ? "border-blue-200 bg-blue-50 animate-pulse" : "border-slate-100 bg-slate-50"}`}>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">{l}</div>
                      <div className="text-[11px] text-slate-600 mt-0.5">{LAYER_NAMES[l]}</div>
                      {done && lr && (
                        <>
                          <div className={`text-lg font-bold mt-1 ${(lr.score ?? 1) >= 0.8 ? "text-emerald-700" : (lr.score ?? 1) >= 0.6 ? "text-amber-700" : "text-red-700"}`}>
                            {lr.score != null ? `${(lr.score * 100).toFixed(0)}%` : "—"}
                          </div>
                          <div className="text-[9px] text-slate-400">{lr.findings_count} 发现 · {lr.elapsed_ms}ms</div>
                        </>
                      )}
                      {skipped && <div className="text-[10px] text-slate-400 mt-1">已跳过</div>}
                      {!done && !skipped && !loading && <div className="text-[10px] text-slate-300 mt-1">等待</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Overall verdict */}
          {deep && deep.overall_score != null && (
            <div className={`rounded-xl border p-5 ${VERDICT_STYLE[deep.overall_verdict] || VERDICT_STYLE.unknown}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">综合评分: {(deep.overall_score * 100).toFixed(0)}%</h2>
                  <p className="text-[11px] mt-0.5">判定: {VERDICT_LABEL[deep.overall_verdict] || deep.overall_verdict}</p>
                </div>
                <div className="text-3xl font-bold">{(deep.overall_score * 100).toFixed(0)}</div>
              </div>
            </div>
          )}

          {/* Layer detail tabs */}
          {deep && deep.scan_id && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex gap-1 border-b border-slate-100 pb-2">
                {deep.layers.filter(l => l.status === "done").map(l => (
                  <button key={l.layer} onClick={() => { setActiveLayer(l.layer); loadLayerDetail(deep.scan_id, l.layer); }}
                    className={`text-[11px] px-3 py-1 rounded-t border-b-2 ${activeLayer === l.layer ? "border-blue-500 text-blue-700 font-semibold" : "border-transparent text-slate-500"}`}>
                    {l.layer} {LAYER_NAMES[l.layer]}
                  </button>
                ))}
              </div>

              {layerDetail && (
                <div className="space-y-2">
                  {/* L2 capability graph */}
                  {activeLayer === "L2" && layerDetail.metadata?.capability_graph && (
                    <CapabilityGraphMini graph={layerDetail.metadata.capability_graph} />
                  )}
                  {/* L5 conflict matrix */}
                  {activeLayer === "L5" && layerDetail.metadata?.conflict_matrix && (
                    <ConflictMatrixMini matrix={layerDetail.metadata.conflict_matrix} />
                  )}
                  {/* Findings for all layers */}
                  {(layerDetail.findings || []).length > 0 ? (
                    (layerDetail.findings as Finding[]).map((f: Finding) => (
                      <FindingCard key={f.finding_id} f={f} />
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-400 py-4 text-center">此层未发现风险</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============ QUICK SCAN ============ */}
      {mode === "quick" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex gap-2 mb-2">
              {(["path", "content"] as const).map(m => (
                <button key={m} onClick={() => setQuickMode(m)}
                  className={`text-[11px] px-2.5 py-1 rounded border ${quickMode === m ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                  {m === "path" ? "扫描目录" : "扫描文本"}
                </button>
              ))}
            </div>
            {quickMode === "path" ? (
              <>
                {commonPaths && (
                  <div className="flex flex-wrap gap-2">
                    {[...commonPaths.global_paths, ...commonPaths.project_paths].filter(p => p.exists).map(p => (
                      <button key={p.path} onClick={() => setScanPath(p.path)}
                        className={`text-[11px] px-2.5 py-1 rounded border ${scanPath === p.path ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input value={scanPath} onChange={e => setScanPath(e.target.value)}
                    placeholder="扫描路径..." className="flex-1 border rounded px-3 py-1.5 text-xs text-slate-700" />
                  <button onClick={() => doQuickScan(scanPath)} disabled={!scanPath.trim() || loading}
                    className="text-xs px-4 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40">
                    {loading ? "扫描中…" : "快速扫描"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">粘贴内容</span>
                  <select value={quickContentType} onChange={e => setQuickContentType(e.target.value)}
                    className="text-[11px] border rounded px-2 py-1 text-slate-600">
                    <option value="skill">SKILL.md</option><option value="rule">.mdc Rule</option>
                    <option value="agents_md">AGENTS.md</option><option value="mcp_config">.mcp.json</option>
                  </select>
                </div>
                <textarea value={quickContent} onChange={e => setQuickContent(e.target.value)}
                  rows={8} placeholder="粘贴内容..." className="w-full rounded-lg border p-3 text-xs font-mono text-slate-700 resize-y" />
                <button onClick={() => doQuickScan(undefined, quickContent)} disabled={!quickContent.trim() || loading}
                  className="text-xs px-4 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40">
                  {loading ? "扫描中…" : "扫描"}
                </button>
              </>
            )}
          </div>

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

          {quickReport && (
            <div className="space-y-3">
              <div className={`rounded-xl border p-5 ${quickReport.total_findings === 0 ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                <h2 className="text-sm font-semibold text-slate-900">
                  {quickReport.total_findings === 0 ? "扫描通过 — 未发现风险" : `发现 ${quickReport.total_findings} 个风险`}
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{quickReport.summary}</p>
              </div>
              {quickReport.files.flatMap(f => f.findings).map(f => <FindingCard key={f.finding_id} f={f} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function FindingCard({ f }: { f: Finding }) {
  return (
    <div className={`rounded-lg border p-4 ${SEV[f.severity] || "border-slate-200"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEV[f.severity]}`}>{f.severity}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{CAT[f.category] || f.category}</span>
        {f.layer && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-600">{f.layer}</span>}
      </div>
      <p className="text-[13px] font-medium text-slate-900">{f.title}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{f.description}</p>
      {f.matched_text && (
        <pre className="mt-2 text-[11px] font-mono bg-white/60 border rounded px-2 py-1 text-slate-700 overflow-auto">{f.matched_text}</pre>
      )}
      {f.file_path && f.file_path !== "<input>" && (
        <p className="text-[10px] text-slate-400 mt-1 font-mono truncate">{f.file_path}{f.line_number ? `:${f.line_number}` : ""}</p>
      )}
      {f.recommendation && <p className="text-[11px] text-slate-600 mt-2 border-t pt-2 border-current/10">{f.recommendation}</p>}
    </div>
  );
}

function CapabilityGraphMini({ graph }: { graph: any }) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const riskPaths = graph.risk_paths || [];
  const types = { skill: "bg-blue-100 text-blue-800", tool: "bg-purple-100 text-purple-800", permission: "bg-amber-100 text-amber-800", impact: "bg-red-100 text-red-800" };

  return (
    <div className="rounded-lg border border-slate-200 p-4 space-y-3">
      <h4 className="text-xs font-semibold text-slate-700">能力图谱 · {nodes.length} 节点 · {edges.length} 边 · {riskPaths.length} 风险路径</h4>
      <div className="text-[11px] text-slate-600">
        <span className="font-medium">最大爆炸半径: </span>
        <span className={`px-1.5 py-0.5 rounded ${graph.max_blast_radius === "none" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
          {graph.max_blast_radius}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {nodes.map((n: any) => (
          <span key={n.id} className={`text-[10px] px-2 py-0.5 rounded ${(types as any)[n.type] || "bg-slate-100 text-slate-600"}`}>
            {n.label}
          </span>
        ))}
      </div>
      {riskPaths.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-[10px] font-semibold text-red-700 uppercase">风险路径</h5>
          {riskPaths.slice(0, 8).map((p: string[], i: number) => (
            <div key={i} className="text-[10px] text-slate-600 font-mono">
              {p.map(n => n.split(":").pop()).join(" → ")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictMatrixMini({ matrix }: { matrix: any }) {
  const files = (matrix.files || []).map((f: string) => f.split("/").pop());
  const conflicts = matrix.conflicts || [];

  return (
    <div className="rounded-lg border border-slate-200 p-4 space-y-3">
      <h4 className="text-xs font-semibold text-slate-700">冲突矩阵 · {files.length} 文件 · {conflicts.length} 冲突</h4>
      {conflicts.length === 0 ? (
        <p className="text-[11px] text-emerald-600">未检测到文件间冲突</p>
      ) : (
        <div className="space-y-1">
          {conflicts.map((c: any, i: number) => (
            <div key={i} className={`text-[11px] rounded border px-2 py-1 ${SEV[c.severity] || "border-slate-200"}`}>
              <span className="font-medium">{c.conflict_type}</span>: {c.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
