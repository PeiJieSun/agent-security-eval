import { useState } from "react";
import { PageHeader } from "../components/AppShell";

const API = "http://localhost:18002/api/v1/agent-eval";

const QUICK_SCANS = [
  { label: "LangChain", target: "langchain" },
  { label: "CrewAI", target: "crewai" },
  { label: "AutoGen", target: "autogen" },
];

const SEV_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  critical: { bg: "bg-red-100", text: "text-red-800", bar: "bg-red-500" },
  high:     { bg: "bg-orange-100", text: "text-orange-800", bar: "bg-orange-400" },
  medium:   { bg: "bg-amber-100", text: "text-amber-800", bar: "bg-amber-400" },
  low:      { bg: "bg-green-100", text: "text-green-800", bar: "bg-green-400" },
};

interface VulnLocation {
  file_path: string;
  line_start: number;
  line_end: number;
  code_snippet: string;
  function_name: string;
  class_name: string;
}

interface Vuln {
  vuln_id: string;
  cwe_id: string;
  cwe_name: string;
  severity: string;
  title: string;
  description: string;
  location: VulnLocation;
  recommendation: string;
  confidence: string;
}

interface CallGraphNode {
  name: string;
  file_path: string;
  line: number;
  calls: string[];
}

interface Report {
  report_id: string;
  target: string;
  framework: string;
  files_scanned: number;
  lines_scanned: number;
  vulnerabilities: Vuln[];
  call_graph: CallGraphNode[];
  vuln_by_severity: Record<string, number>;
  vuln_by_cwe: Record<string, number>;
  created_at: string;
  scan_duration_ms: number;
}

interface HistoryItem {
  report_id: string;
  target: string;
  framework: string;
  files_scanned: number;
  lines_scanned: number;
  vuln_count: number;
  vuln_by_severity: Record<string, number>;
  created_at: string;
  scan_duration_ms: number;
}

function SevBadge({ sev }: { sev: string }) {
  const c = SEV_COLORS[sev] ?? { bg: "bg-slate-100", text: "text-slate-600" };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${c.bg} ${c.text}`}>
      {sev}
    </span>
  );
}

function SeverityBar({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="h-3 rounded bg-green-100 text-[10px] text-green-700 px-2 leading-3">无漏洞</div>;
  const order = ["critical", "high", "medium", "low"];
  return (
    <div className="flex h-5 rounded overflow-hidden border border-slate-200">
      {order.map((sev) => {
        const n = counts[sev] ?? 0;
        if (n === 0) return null;
        const pct = (n / total) * 100;
        const c = SEV_COLORS[sev];
        return (
          <div key={sev} className={`${c.bar} flex items-center justify-center text-white text-[10px] font-bold`} style={{ width: `${pct}%`, minWidth: 24 }} title={`${sev}: ${n}`}>
            {n}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}

export default function SourceAuditPage() {
  const [mode, setMode] = useState<"package" | "directory">("package");
  const [target, setTarget] = useState("");
  const [framework, setFramework] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");

  async function runScan(t?: string) {
    const scanTarget = t ?? target;
    if (!scanTarget.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/source-audit/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: scanTarget, mode, framework }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: Report = await res.json();
      setReport(data);
      setExpanded(new Set());
      refreshHistory();
    } catch (e: any) {
      setError(e.message ?? "扫描失败");
    } finally {
      setLoading(false);
    }
  }

  async function refreshHistory() {
    try {
      const res = await fetch(`${API}/source-audit/reports`);
      if (res.ok) setHistory(await res.json());
    } catch { /* ignore */ }
  }

  async function loadReport(id: string) {
    try {
      const res = await fetch(`${API}/source-audit/reports/${id}`);
      if (res.ok) {
        setReport(await res.json());
        setExpanded(new Set());
      }
    } catch { /* ignore */ }
  }

  function toggle(vid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(vid) ? next.delete(vid) : next.add(vid);
      return next;
    });
  }

  const vulnCount = report?.vulnerabilities.length ?? 0;

  return (
    <div className="p-6 max-w-[1100px]">
      <PageHeader
        title="源码安全审计"
        subtitle="基于 AST 静态分析识别 Agent 框架中的 5 类特有漏洞（AGENT-CWE-001~005）"
        actions={
          <button onClick={() => { refreshHistory(); setShowHistory((v) => !v); }} className="text-[12px] text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-3 py-1.5 transition-colors">
            {showHistory ? "隐藏历史" : "扫描历史"}
          </button>
        }
      />

      {/* ── Scan form ── */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-5">
        <div className="flex items-center gap-4 mb-4">
          <span className="text-[12px] text-slate-500 font-medium">模式</span>
          {(["package", "directory"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="accent-slate-800" />
              <span className="text-[13px] text-slate-700">{m === "package" ? "Python 包" : "本地目录"}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-3">
          <input
            className="flex-1 border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400"
            placeholder={mode === "package" ? "输入包名，如 langchain" : "输入目录路径"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runScan()}
          />
          {mode === "directory" && (
            <input
              className="w-40 border border-slate-200 rounded px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400"
              placeholder="框架名（可选）"
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
            />
          )}
          <button
            onClick={() => runScan()}
            disabled={loading || !target.trim()}
            className="px-5 py-2 rounded bg-slate-900 text-white text-[13px] font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {loading ? "扫描中…" : "开始扫描"}
          </button>
        </div>
        {/* quick scan */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-[11px] text-slate-400">快速扫描：</span>
          {QUICK_SCANS.map((q) => (
            <button
              key={q.target}
              onClick={() => { setTarget(q.target); setMode("package"); runScan(q.target); }}
              disabled={loading}
              className="px-2.5 py-1 rounded border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 transition-colors"
            >
              {q.label}
            </button>
          ))}
        </div>
        {error && <div className="mt-3 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      </div>

      <div className="flex gap-5">
        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">
          {report && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                <StatCard label="扫描文件" value={report.files_scanned} />
                <StatCard label="代码行数" value={report.lines_scanned.toLocaleString()} />
                <StatCard label="漏洞数" value={vulnCount} />
                <StatCard label="耗时" value={`${report.scan_duration_ms} ms`} />
              </div>

              {/* Severity bar */}
              <div className="mb-4">
                <div className="text-[11px] text-slate-400 mb-1 font-medium">严重程度分布</div>
                <SeverityBar counts={report.vuln_by_severity} />
              </div>

              {/* CWE breakdown */}
              {Object.keys(report.vuln_by_cwe).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-5">
                  {Object.entries(report.vuln_by_cwe).map(([cwe, n]) => (
                    <span key={cwe} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-[11px] text-slate-700 font-mono">
                      {cwe} <span className="font-bold">{n}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Vulnerability list */}
              {report.vulnerabilities.length > 0 && (
                <div className="space-y-2 mb-6">
                  <div className="text-[11px] text-slate-400 font-medium mb-1">漏洞详情</div>
                  {report.vulnerabilities.map((v) => {
                    const isOpen = expanded.has(v.vuln_id);
                    return (
                      <div key={v.vuln_id} className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                        <button onClick={() => toggle(v.vuln_id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                          <span className="text-[11px] font-mono text-slate-400 shrink-0">{v.vuln_id}</span>
                          <SevBadge sev={v.severity} />
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">{v.cwe_id}</span>
                          <span className="text-[13px] text-slate-900 truncate flex-1">{v.title}</span>
                          <svg className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
                            <p className="text-[12px] text-slate-600 leading-relaxed whitespace-pre-wrap">{v.description}</p>
                            {v.location.code_snippet && (
                              <pre className="bg-slate-900 text-slate-100 text-[11px] font-mono rounded-lg p-4 overflow-x-auto leading-relaxed">
                                {v.location.code_snippet.split("\n").map((line, i) => (
                                  <div key={i}><span className="text-slate-500 select-none mr-3">{(v.location.line_start + i).toString().padStart(4)}</span>{line}</div>
                                ))}
                              </pre>
                            )}
                            <div className="flex items-center gap-4 text-[11px]">
                              <span className="text-slate-400">文件：<span className="font-mono text-slate-600">{v.location.file_path}:{v.location.line_start}</span></span>
                              {v.location.function_name && <span className="text-slate-400">函数：<span className="font-mono text-slate-600">{v.location.function_name}</span></span>}
                              {v.location.class_name && <span className="text-slate-400">类：<span className="font-mono text-slate-600">{v.location.class_name}</span></span>}
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2">
                              <div className="text-[10px] text-blue-500 font-semibold uppercase mb-0.5">修复建议</div>
                              <p className="text-[12px] text-blue-900 leading-relaxed">{v.recommendation}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Call graph */}
              {report.call_graph.length > 0 && (
                <div className="mb-6">
                  <div className="text-[11px] text-slate-400 font-medium mb-2">调用图</div>
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-left">
                          <th className="px-4 py-2 font-medium">函数</th>
                          <th className="px-4 py-2 font-medium">位置</th>
                          <th className="px-4 py-2 font-medium">调用</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.call_graph.map((n, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-4 py-2 font-mono text-slate-900">{n.name}</td>
                            <td className="px-4 py-2 font-mono text-slate-500">{n.file_path}:{n.line}</td>
                            <td className="px-4 py-2 text-slate-600">{n.calls.length > 0 ? n.calls.join(", ") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {!report && !loading && (
            <div className="text-center py-16 text-slate-400 text-[13px]">
              选择一个包或目录开始源码安全扫描
            </div>
          )}
        </div>

        {/* ── History sidebar ── */}
        {showHistory && (
          <div className="w-64 shrink-0">
            <div className="text-[11px] text-slate-400 font-medium mb-2">扫描历史</div>
            {history.length === 0 ? (
              <div className="text-[12px] text-slate-300">暂无记录</div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <button
                    key={h.report_id}
                    onClick={() => loadReport(h.report_id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      report?.report_id === h.report_id ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="text-[12px] font-medium text-slate-900 truncate">{h.target}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400">{h.vuln_count} 漏洞</span>
                      <span className="text-[10px] text-slate-400">{h.files_scanned} 文件</span>
                      <span className="text-[10px] text-slate-400">{h.scan_duration_ms}ms</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
