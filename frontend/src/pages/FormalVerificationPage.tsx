import { useState } from "react";
import { PageHeader } from "../components/AppShell";
import { api } from "../lib/api";

type PropertyResult = {
  property_id: string;
  property_name: string;
  verified: boolean;
  counterexample: string[];
  counterexample_tools: string[];
  reachable_sinks: number;
  total_sinks: number;
  attack_paths_found: number;
  analysis_summary: string;
};

type VerifyResponse = {
  state_count: number;
  transition_count: number;
  property_count: number;
  results: PropertyResult[];
  all_verified: boolean;
};

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${accent ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <div className={`text-[20px] font-bold tabular-nums ${accent ? "text-red-700" : "text-slate-800"}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function PropertyCard({ r }: { r: PropertyResult }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`border rounded-xl p-4 transition-colors ${
        r.verified
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-red-200 bg-red-50/40"
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
              r.verified ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            }`}
          >
            {r.verified ? "✓" : "✗"}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate">{r.property_name}</div>
            <div className="text-[11px] text-slate-500 font-mono">{r.property_id}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!r.verified && (
            <span className="text-[11px] font-mono text-red-600">
              {r.attack_paths_found} 条攻击路径 · {r.reachable_sinks}/{r.total_sinks} 可达
            </span>
          )}
          {r.verified && (
            <span className="text-[11px] font-mono text-emerald-600">
              0/{r.total_sinks} 可达
            </span>
          )}
          {r.counterexample.length > 0 && (
            <button
              onClick={() => setOpen(!open)}
              className="text-[11px] px-2 py-1 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {open ? "收起" : "反例"}
            </button>
          )}
        </div>
      </div>

      <p className="text-[12px] text-slate-600 mt-2">{r.analysis_summary}</p>

      {open && r.counterexample.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-semibold text-slate-700">最短反例路径</div>
          <div className="flex flex-wrap items-center gap-1">
            {r.counterexample.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                  {s}
                </span>
                {i < r.counterexample.length - 1 && (
                  <span className="text-slate-400 text-[10px]">→</span>
                )}
              </span>
            ))}
          </div>
          {r.counterexample_tools.length > 0 && (
            <div className="text-[11px] text-slate-500">
              工具链: {r.counterexample_tools.join(" → ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FormalVerificationPage() {
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setLoading(true);
    setError(null);
    api
      .verifyFormal()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <PageHeader
        title="形式化验证"
        subtitle="Agent 行为状态机安全属性验证 — 从历史轨迹构建 LTS，BFS 可达性分析不可信源→敏感操作路径"
        actions={
          <button
            onClick={run}
            disabled={loading}
            className="text-[12px] px-4 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {loading ? "验证中…" : "运行形式化验证"}
          </button>
        }
      />

      {error && (
        <div className="border border-red-200 rounded-lg bg-red-50 p-3 text-[12px] text-red-700">{error}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="状态数" value={data.state_count} />
            <StatCard label="转移数" value={data.transition_count} />
            <StatCard label="安全属性" value={data.property_count} />
            <StatCard
              label="总体结论"
              value={data.all_verified ? "SAFE" : "VIOLATED"}
              accent={!data.all_verified}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold text-slate-800">属性验证结果</h3>
            {data.results.length === 0 && (
              <div className="text-[12px] text-slate-400 py-4 text-center">无安全属性需要验证</div>
            )}
            {data.results.map((r) => (
              <PropertyCard key={r.property_id} r={r} />
            ))}
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="border border-slate-200 rounded-xl bg-white p-12 text-center text-slate-400 text-[13px]">
          点击「运行形式化验证」从历史轨迹构建状态机并检查安全属性
        </div>
      )}
    </div>
  );
}
