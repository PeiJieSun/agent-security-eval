/**
 * BatchEvalPage — 批量评测
 * Runs all tasks × injection styles in one shot to produce comprehensive metrics.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { getActiveProfile } from "../lib/settings";

const DOMAINS = [
  { id: "email",    label: "Email 助手",   count: 5 },
  { id: "research", label: "AI 研究助手",   count: 5 },
  { id: "chinese",  label: "中文 LLM 专项", count: 11 },
];

const STYLES = [
  { id: "naive",              label: "Naive",         desc: "直接注入" },
  { id: "camouflaged",        label: "伪装",           desc: "结构混淆" },
  { id: "authority",          label: "权威",           desc: "系统角色" },
  { id: "encoded",            label: "编码",           desc: "Base64/Hex" },
  { id: "chinese_obfuscated", label: "中文混淆",       desc: "全角/谐音" },
];

interface Batch {
  batch_id: string;
  model: string;
  status: string;
  total: number;
  done_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  config: { domains?: string[]; injection_styles?: string[]; task_ids?: string[] };
}

function pct(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-blue-50 text-blue-700 border-blue-200",
    done: "bg-emerald-50 text-emerald-700 border-emerald-200",
    done_with_errors: "bg-amber-50 text-amber-700 border-amber-200",
    failed: "bg-red-50 text-red-700 border-red-200",
    pending: "bg-slate-50 text-slate-500 border-slate-200",
  };
  const label: Record<string, string> = {
    running: "运行中", done: "完成", done_with_errors: "完成(含错误)",
    failed: "失败", pending: "等待",
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded border ${map[status] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
      {label[status] ?? status}
    </span>
  );
}

function ProgressBar({ done, total, failed }: { done: number; total: number; failed: number }) {
  const donePct = pct(done, total);
  const failPct = pct(failed, total);
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
      <div className="bg-emerald-400 h-full transition-all" style={{ width: `${donePct - failPct}%` }} />
      <div className="bg-red-400 h-full transition-all" style={{ width: `${failPct}%` }} />
    </div>
  );
}

export default function BatchEvalPage() {
  const profile = getActiveProfile();

  const [selDomains, setSelDomains] = useState<Set<string>>(new Set(["email", "research", "chinese"]));
  const [selStyles, setSelStyles] = useState<Set<string>>(new Set(["naive", "camouflaged", "authority", "encoded", "chinese_obfuscated"]));
  const [batches, setBatches] = useState<Batch[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadBatches = () => {
    api.listBatches().then(setBatches).catch(() => {});
  };

  useEffect(() => {
    loadBatches();
    pollRef.current = setInterval(loadBatches, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const totalCombos = (() => {
    const taskCount = DOMAINS.filter(d => selDomains.has(d.id)).reduce((s, d) => s + d.count, 0);
    return taskCount * selStyles.size;
  })();

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  const launch = async () => {
    if (!profile?.apiKey) { setError("请先在「LLM 配置」中配置 API Key"); return; }
    if (selDomains.size === 0 || selStyles.size === 0) { setError("请至少选择一个域和一种注入风格"); return; }
    setError(null);
    setLaunching(true);
    try {
      await api.createBatch({
        domains: [...selDomains],
        injection_styles: [...selStyles],
        model: profile.model,
        api_key: profile.apiKey,
        base_url: profile.baseUrl || undefined,
      });
      loadBatches();
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const runningBatch = batches.find(b => b.status === "running");

  return (
    <div className="px-8 py-7 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">批量评测</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          对所有任务 × 注入风格组合批量运行，得到三维指标汇总
        </p>
      </div>

      {/* Config panel */}
      <div className="border border-slate-200 rounded-lg p-5 space-y-5">
        <p className="text-[12px] font-medium text-slate-700">评测范围配置</p>

        {/* Domain select */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">任务域</p>
          <div className="flex gap-2 flex-wrap">
            {DOMAINS.map(d => (
              <button
                key={d.id}
                onClick={() => toggle(selDomains, d.id, setSelDomains)}
                className={`px-3 py-1.5 rounded border text-[12px] transition-colors ${
                  selDomains.has(d.id)
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-200 text-slate-500 hover:border-slate-400"
                }`}
              >
                {d.label}
                <span className="ml-1.5 opacity-60">{d.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Style select */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">注入风格</p>
          <div className="flex gap-2 flex-wrap">
            {STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => toggle(selStyles, s.id, setSelStyles)}
                className={`px-3 py-1.5 rounded border text-[12px] transition-colors ${
                  selStyles.has(s.id)
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-200 text-slate-500 hover:border-slate-400"
                }`}
                title={s.desc}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary + launch */}
        <div className="flex items-center justify-between pt-1">
          <div className="text-[12px] text-slate-500">
            共 <span className="font-semibold text-slate-800">{totalCombos}</span> 个组合
            {profile && (
              <span className="ml-2 text-slate-400">· {profile.model}</span>
            )}
          </div>
          <button
            onClick={launch}
            disabled={launching || !!runningBatch || totalCombos === 0}
            className="px-4 py-1.5 rounded bg-slate-900 text-white text-[12px] font-medium
                       hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {launching ? "提交中…" : runningBatch ? "批跑进行中…" : "开始批跑"}
          </button>
        </div>

        {error && (
          <p className="text-[12px] text-red-600 border border-red-200 rounded px-3 py-2 bg-red-50">{error}</p>
        )}
      </div>

      {/* Active batch progress */}
      {runningBatch && (
        <div className="border border-blue-200 rounded-lg p-5 space-y-3 bg-blue-50/30">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-slate-700">当前批跑进度</p>
            <StatusChip status={runningBatch.status} />
          </div>
          <ProgressBar done={runningBatch.done_count} total={runningBatch.total} failed={runningBatch.failed_count} />
          <div className="flex gap-6 text-[12px] text-slate-500">
            <span>完成 <b className="text-slate-800">{runningBatch.done_count}</b></span>
            <span>失败 <b className="text-red-600">{runningBatch.failed_count}</b></span>
            <span>总计 <b className="text-slate-800">{runningBatch.total}</b></span>
            <span className="ml-auto">{pct(runningBatch.done_count, runningBatch.total)}%</span>
          </div>
        </div>
      )}

      {/* History */}
      {batches.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-slate-700">历史批跑记录</p>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            {batches.map(b => (
              <div key={b.batch_id} className="px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono text-slate-500">{b.batch_id}</span>
                    <StatusChip status={b.status} />
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {b.model} · {(b.config.domains ?? []).join(", ") || "全域"} · {(b.config.injection_styles ?? []).length} 种风格
                  </div>
                  {b.status === "running" && (
                    <div className="mt-1.5">
                      <ProgressBar done={b.done_count} total={b.total} failed={b.failed_count} />
                    </div>
                  )}
                </div>
                <div className="text-right text-[12px] shrink-0">
                  <div className="text-slate-700 font-medium">
                    {b.done_count}/{b.total}
                    {b.failed_count > 0 && <span className="text-red-500 ml-1">({b.failed_count} 失败)</span>}
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    {new Date(b.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {batches.length === 0 && !runningBatch && (
        <p className="text-[12px] text-slate-400 text-center py-8">暂无批跑记录，配置范围后点击「开始批跑」</p>
      )}
    </div>
  );
}
