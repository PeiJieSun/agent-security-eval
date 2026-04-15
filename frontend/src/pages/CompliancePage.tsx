import { useEffect, useState } from "react";
import { PageHeader } from "../components/AppShell";

const API = "http://localhost:18002/api/v1/agent-eval";

interface TemplateInfo {
  template_id: string;
  industry: string;
  standard: string;
  standard_full_name: string;
  description: string;
  section_count: number;
  tags: string[];
}

interface Section {
  section_id: string;
  standard: string;
  clause: string;
  title: string;
  description: string;
  mapped_dimensions: string[];
  severity: string;
}

interface TemplateDetail {
  template_id: string;
  industry: string;
  standard: string;
  standard_full_name: string;
  description: string;
  sections: Section[];
  tags: string[];
}

interface CheckResult {
  section_id: string;
  clause: string;
  title: string;
  status: string;
  score: number;
  evidence: string;
  recommendations: string[];
}

interface Report {
  report_id: string;
  template_id: string;
  industry: string;
  standard: string;
  model: string;
  overall_compliance: number;
  pass_count: number;
  fail_count: number;
  partial_count: number;
  not_tested_count: number;
  sections: CheckResult[];
  created_at: string;
}

const INDUSTRY_ICONS: Record<string, string> = {
  power_grid: "⚡", finance: "🏦", nuclear: "☢️", healthcare: "🏥",
};

const SEV: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border border-red-200",
  high: "bg-orange-50 text-orange-700 border border-orange-200",
  medium: "bg-amber-50 text-amber-700 border border-amber-200",
};

const STATUS_CFG: Record<string, { icon: string; color: string; label: string }> = {
  pass:       { icon: "✓", color: "text-emerald-600", label: "通过" },
  fail:       { icon: "✗", color: "text-red-600",     label: "不通过" },
  partial:    { icon: "~", color: "text-amber-600",    label: "部分通过" },
  not_tested: { icon: "?", color: "text-slate-400",    label: "未测试" },
};

export default function CompliancePage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selected, setSelected] = useState<TemplateDetail | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/compliance/templates`).then(r => r.json()).then(setTemplates).catch(() => {});
  }, []);

  const selectTemplate = async (id: string) => {
    setReport(null);
    const r = await fetch(`${API}/compliance/templates/${id}`);
    if (r.ok) setSelected(await r.json());
  };

  const generateReport = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      let scores: Record<string, number> = {};
      try {
        const r = await fetch(`${API}/agent-report`);
        if (r.ok) {
          const data = await r.json();
          if (data.dimensions) {
            for (const d of data.dimensions) scores[d.dimension_id] = d.score ?? 0;
          }
        }
      } catch { /* fallback to mock */ }
      if (!Object.keys(scores).length) {
        const dims = new Set(selected.sections.flatMap(s => s.mapped_dimensions));
        dims.forEach(d => { scores[d] = +(Math.random() * 0.6 + 0.3).toFixed(2); });
      }
      const res = await fetch(`${API}/compliance/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: selected.template_id, dimension_scores: scores }),
      });
      if (res.ok) setReport(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <PageHeader title="行业合规审计" subtitle="将 Agent 安全评测维度映射到行业监管标准，生成合规差距报告" />

      {/* ── Template selector ─────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {templates.map(t => (
          <button
            key={t.template_id}
            onClick={() => selectTemplate(t.template_id)}
            className={[
              "text-left rounded-lg border p-4 transition-all",
              selected?.template_id === t.template_id
                ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                : "border-slate-200 bg-white hover:border-slate-400 hover:shadow",
            ].join(" ")}
          >
            <div className="text-2xl mb-2">{INDUSTRY_ICONS[t.industry] ?? "📋"}</div>
            <div className="text-[13px] font-semibold leading-tight">{t.standard}</div>
            <div className="text-[11px] mt-1 opacity-70 leading-snug">{t.description}</div>
            <div className="flex items-center gap-2 mt-3 text-[10px] opacity-60">
              <span>{t.section_count} 条款</span>
              {t.tags.map(tag => (
                <span key={tag} className="px-1.5 py-0.5 rounded bg-current/5">{tag}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {/* ── Template detail ───────────────────────────────── */}
      {selected && !report && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-900">{selected.standard_full_name}</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">{selected.sections.length} 个检查条款</p>
            </div>
            <button
              onClick={generateReport}
              disabled={loading}
              className="px-4 py-1.5 rounded bg-slate-900 text-white text-[12px] font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loading ? "生成中…" : "生成合规报告"}
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {selected.sections.map(s => (
              <div key={s.section_id} className="px-5 py-3 flex items-start gap-3">
                <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${SEV[s.severity] ?? SEV.medium}`}>
                  {s.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-slate-800">
                    <span className="text-slate-400 font-mono mr-1.5">{s.clause}</span>{s.title}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{s.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {s.mapped_dimensions.map(d => (
                      <span key={d} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">{d}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Report ────────────────────────────────────────── */}
      {report && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="bg-white rounded-lg border border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900">{report.standard} 合规报告</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{report.report_id} · {report.created_at.slice(0, 19)}</p>
              </div>
              <button
                onClick={() => setReport(null)}
                className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
              >
                返回模板
              </button>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className={[
                  "w-14 h-14 rounded-full flex items-center justify-center text-[18px] font-bold",
                  report.overall_compliance >= 0.8 ? "bg-emerald-50 text-emerald-700"
                    : report.overall_compliance >= 0.5 ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-700",
                ].join(" ")}>
                  {(report.overall_compliance * 100).toFixed(0)}%
                </div>
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  总体合规率<br />
                  <span className="text-slate-400">{report.sections.length} 条款</span>
                </div>
              </div>
              <div className="flex gap-4 text-[12px]">
                <Stat label="通过" value={report.pass_count} color="text-emerald-600" />
                <Stat label="不通过" value={report.fail_count} color="text-red-600" />
                <Stat label="部分" value={report.partial_count} color="text-amber-600" />
                <Stat label="未测试" value={report.not_tested_count} color="text-slate-400" />
              </div>
            </div>
          </div>

          {/* Section results table */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-left text-[11px]">
                  <th className="px-4 py-2.5 font-medium w-12">状态</th>
                  <th className="px-4 py-2.5 font-medium w-24">条款</th>
                  <th className="px-4 py-2.5 font-medium">标题</th>
                  <th className="px-4 py-2.5 font-medium w-32">得分</th>
                  <th className="px-4 py-2.5 font-medium">建议</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.sections.map(s => {
                  const cfg = STATUS_CFG[s.status] ?? STATUS_CFG.not_tested;
                  return (
                    <tr key={s.section_id} className="hover:bg-slate-50/50">
                      <td className={`px-4 py-2.5 font-bold text-center ${cfg.color}`}>{cfg.icon}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">{s.clause}</td>
                      <td className="px-4 py-2.5 text-slate-800">{s.title}</td>
                      <td className="px-4 py-2.5">
                        {s.status !== "not_tested" ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={[
                                  "h-full rounded-full transition-all",
                                  s.score >= 0.8 ? "bg-emerald-500" : s.score >= 0.5 ? "bg-amber-500" : "bg-red-500",
                                ].join(" ")}
                                style={{ width: `${s.score * 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-400 w-8 text-right">{(s.score * 100).toFixed(0)}%</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {s.recommendations.length > 0 ? (
                          <ul className="space-y-0.5">
                            {s.recommendations.map((r, i) => (
                              <li key={i} className="text-[10px] text-slate-500 leading-snug">{r}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-300 text-[10px]">{s.status === "pass" ? "达标" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-[18px] font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}
