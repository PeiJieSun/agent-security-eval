import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VerticalSummary {
  pack_id: string;
  name: string;
  industry: string;
  description: string;
  icon: string;
  tool_count: number;
  scenario_count: number;
  compliance_count: number;
  tags: string[];
}

interface AttackScenario {
  scenario_id: string;
  name: string;
  description: string;
  severity: string;
  source_ref: string;
  success_condition: string;
  attack_type?: string;
}

interface ToolHook {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

interface ComplianceRule {
  rule_id: string;
  standard: string;
  section: string;
  description: string;
  severity: string;
  dimension_mapping: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const API = "http://localhost:18002/api/v1/agent-eval/verticals";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-500 border-slate-200",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
};

type Tab = "scenarios" | "tools" | "compliance";

const TABS: { key: Tab; label: string }[] = [
  { key: "scenarios", label: "攻击场景" },
  { key: "tools", label: "工具清单" },
  { key: "compliance", label: "合规映射" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function VerticalsPage() {
  const [packs, setPacks] = useState<VerticalSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("scenarios");

  const [scenarios, setScenarios] = useState<AttackScenario[]>([]);
  const [tools, setTools] = useState<ToolHook[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRule[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(API).then((r) => r.json()).then(setPacks).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    Promise.all([
      fetch(`${API}/${selected}/scenarios`).then((r) => r.json()),
      fetch(`${API}/${selected}/tools`).then((r) => r.json()),
      fetch(`${API}/${selected}/compliance`).then((r) => r.json()),
    ])
      .then(([s, t, c]) => {
        setScenarios(s);
        setTools(t);
        setCompliance(c);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selected]);

  const activePack = packs.find((p) => p.pack_id === selected);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">行业垂直评测包</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          按行业选择预置攻击场景、工具钩子与合规映射
        </p>
      </div>

      {/* Pack selector grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {packs.map((p) => (
          <button
            key={p.pack_id}
            onClick={() => { setSelected(p.pack_id); setTab("scenarios"); }}
            className={[
              "rounded-xl border p-4 text-left transition-all",
              selected === p.pack_id
                ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-200"
                : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm",
            ].join(" ")}
          >
            <div className="text-2xl mb-2">{p.icon}</div>
            <div className="text-[13px] font-semibold text-slate-900">{p.name}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{p.industry}</div>
            <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
              <span>{p.scenario_count} 场景</span>
              <span>{p.tool_count} 工具</span>
              <span>{p.compliance_count} 规则</span>
            </div>
            {p.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {p.tags.map((t) => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {activePack && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {/* Pack header + tabs */}
          <div className="border-b border-slate-100 px-5 pt-4 pb-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{activePack.icon}</span>
              <h2 className="text-[14px] font-semibold text-slate-900">{activePack.name}</h2>
            </div>
            <p className="text-[12px] text-slate-400 mb-3">{activePack.description}</p>
            <div className="flex gap-0">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={[
                    "px-4 py-2 text-[12px] font-medium border-b-2 transition-colors -mb-px",
                    tab === t.key
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-slate-400 hover:text-slate-600",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="p-5">
            {loading ? (
              <p className="text-[12px] text-slate-400">加载中…</p>
            ) : (
              <>
                {tab === "scenarios" && <ScenariosTab scenarios={scenarios} />}
                {tab === "tools" && <ToolsTab tools={tools} />}
                {tab === "compliance" && <ComplianceTab rules={compliance} />}
              </>
            )}
          </div>
        </div>
      )}

      {!selected && packs.length > 0 && (
        <div className="text-center text-[12px] text-slate-400 py-12">
          选择一个行业包以查看详情
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  return (
    <span
      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${
        SEVERITY_STYLES[s] ?? "bg-slate-50 text-slate-500 border-slate-200"
      }`}
    >
      {SEVERITY_LABELS[s] ?? severity}
    </span>
  );
}

function ScenariosTab({ scenarios }: { scenarios: AttackScenario[] }) {
  if (!scenarios.length) return <Empty label="暂无攻击场景" />;
  return (
    <div className="space-y-3">
      {scenarios.map((s) => (
        <div
          key={s.scenario_id}
          className="rounded-lg border border-slate-100 p-4 hover:border-slate-200 transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-medium text-slate-900">{s.name}</span>
            <SeverityBadge severity={s.severity} />
          </div>
          <p className="text-[12px] text-slate-500 mb-2">{s.description}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
            {s.source_ref && (
              <a
                href={s.source_ref}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-500"
              >
                来源引用
              </a>
            )}
            {s.success_condition && (
              <span className="truncate max-w-sm" title={s.success_condition}>
                成功条件: {s.success_condition}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolsTab({ tools }: { tools: ToolHook[] }) {
  if (!tools.length) return <Empty label="暂无工具定义" />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {tools.map((t) => (
        <div
          key={t.name}
          className="rounded-lg border border-slate-100 p-4"
        >
          <div className="text-[13px] font-medium text-slate-900 mb-1 font-mono">
            {t.name}
          </div>
          <p className="text-[12px] text-slate-500 mb-2">{t.description}</p>
          {Object.keys(t.parameters ?? {}).length > 0 && (
            <div className="space-y-1">
              {Object.entries(t.parameters).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[11px]">
                  <code className="text-blue-600 bg-blue-50 px-1 rounded">{k}</code>
                  <span className="text-slate-400">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ComplianceTab({ rules }: { rules: ComplianceRule[] }) {
  if (!rules.length) return <Empty label="暂无合规规则" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-slate-100 text-left text-slate-400">
            <th className="py-2 pr-3 font-medium">标准</th>
            <th className="py-2 pr-3 font-medium">章节</th>
            <th className="py-2 pr-3 font-medium">描述</th>
            <th className="py-2 pr-3 font-medium">严重度</th>
            <th className="py-2 font-medium">维度</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.rule_id} className="border-b border-slate-50 hover:bg-slate-50/50">
              <td className="py-2 pr-3 font-medium text-slate-700 whitespace-nowrap">
                {r.standard}
              </td>
              <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{r.section}</td>
              <td className="py-2 pr-3 text-slate-500">{r.description}</td>
              <td className="py-2 pr-3">
                <SeverityBadge severity={r.severity} />
              </td>
              <td className="py-2 text-slate-500">
                <div className="flex flex-wrap gap-1">
                  {(r.dimension_mapping ?? []).map((d) => (
                    <span key={d} className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded">
                      {d}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-[12px] text-slate-400 text-center py-8">{label}</p>;
}
