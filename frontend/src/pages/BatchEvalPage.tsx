/**
 * BatchEvalPage — 批量评测
 * Runs all tasks × injection styles concurrently (4 workers) and streams progress.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { getActiveProfile } from "../lib/settings";

const DOMAINS = [
  { id: "email",    label: "Email 助手",    count: 5 },
  { id: "research", label: "AI 研究助手",   count: 5 },
  { id: "chinese",  label: "中文 LLM 专项", count: 11 },
];

const STYLES = [
  { id: "naive",              label: "Naive" },
  { id: "camouflaged",        label: "伪装" },
  { id: "authority",          label: "权威" },
  { id: "encoded",            label: "编码" },
  { id: "chinese_obfuscated", label: "中文混淆" },
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
  running_tasks?: string[];  // populated by GET /batch-evals/{id}
}

function pct(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "text-blue-700 border-blue-200 bg-blue-50",
    done: "text-emerald-700 border-emerald-200 bg-emerald-50",
    done_with_errors: "text-amber-700 border-amber-200 bg-amber-50",
    failed: "text-red-700 border-red-200 bg-red-50",
    pending: "text-slate-500 border-slate-200 bg-slate-50",
  };
  const label: Record<string, string> = {
    running: "运行中", done: "完成", done_with_errors: "完成(含错误)",
    failed: "失败", pending: "等待",
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded border flex items-center gap-1.5 ${map[status] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
      {status === "running" && <PulsingDot />}
      {label[status] ?? status}
    </span>
  );
}

function AnimatedProgressBar({ done, total, failed }: { done: number; total: number; failed: number }) {
  const donePct = pct(done - failed, total);
  const failPct = pct(failed, total);
  const remainPct = 100 - donePct - failPct;

  return (
    <div className="space-y-1">
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
        <div
          className="bg-emerald-400 h-full transition-all duration-700 ease-out"
          style={{ width: `${donePct}%` }}
        />
        <div
          className="bg-red-400 h-full transition-all duration-700"
          style={{ width: `${failPct}%` }}
        />
        {remainPct > 0 && done < total && (
          <div
            className="h-full bg-blue-200 animate-pulse"
            style={{ width: `${Math.min(remainPct, 100)}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>
          <span className="text-emerald-600 font-medium">{done - failed}</span> 完成
          {failed > 0 && <span className="text-red-500 ml-2 font-medium">{failed} 失败</span>}
          <span className="ml-2">/ {total}</span>
        </span>
        <span className="font-semibold text-slate-600">{pct(done, total)}%</span>
      </div>
    </div>
  );
}

function RunningTaskList({ tasks }: { tasks: string[] }) {
  if (tasks.length === 0) return (
    <p className="text-[11px] text-slate-400 italic">等待启动并发 worker…</p>
  );
  return (
    <div className="space-y-1">
      {tasks.slice(0, 8).map(t => {
        const [taskId, style] = t.split(":");
        return (
          <div key={t} className="flex items-center gap-2 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
            <span className="font-mono text-slate-600 truncate max-w-[260px]">{taskId}</span>
            <span className="text-slate-400">·</span>
            <span className="text-blue-600">{style}</span>
          </div>
        );
      })}
      {tasks.length > 8 && (
        <p className="text-[11px] text-slate-400">…还有 {tasks.length - 8} 个</p>
      )}
    </div>
  );
}

export default function BatchEvalPage() {
  const profile = getActiveProfile();

  const [selDomains, setSelDomains] = useState<Set<string>>(new Set(["email", "research", "chinese"]));
  const [selStyles, setSelStyles] = useState<Set<string>>(new Set(["naive", "camouflaged", "authority", "encoded", "chinese_obfuscated"]));
  const [batches, setBatches] = useState<Batch[]>([]);
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll list every 5s
  const loadBatches = () => {
    api.listBatches().then(list => {
      setBatches(list as Batch[]);
    }).catch(() => {});
  };

  // Poll active batch every 2s for running_tasks
  const pollActive = (batch_id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const b = await api.getBatch(batch_id) as Batch;
        setActiveBatch(b);
        setBatches(prev => prev.map(x => x.batch_id === batch_id ? b : x));
        if (b.status !== "running") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          loadBatches();
        }
      } catch {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 2000);
  };

  useEffect(() => {
    loadBatches();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Auto-attach to running batch on load
  useEffect(() => {
    const running = batches.find(b => b.status === "running");
    if (running && (!activeBatch || activeBatch.batch_id !== running.batch_id)) {
      setActiveBatch(running);
      pollActive(running.batch_id);
    }
  }, [batches]);

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
    if (selDomains.size === 0 || selStyles.size === 0) { setError("请至少选择一个域和一种注入风格"); return; }
    setError(null);
    setLaunching(true);
    try {
      const b = await api.createBatch({
        domains: [...selDomains],
        injection_styles: [...selStyles],
        model: profile?.model,
        api_key: profile?.apiKey,
        base_url: profile?.baseUrl || undefined,
      }) as Batch;
      setActiveBatch(b);
      loadBatches();
      pollActive(b.batch_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const isRunning = activeBatch?.status === "running";

  return (
    <div className="px-8 py-7 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">批量评测</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          任务 × 注入风格组合批量运行，4 个 worker 并发，实时更新进度
        </p>
      </div>

      {/* Config panel */}
      <div className="border border-slate-200 rounded-lg p-5 space-y-4">
        <p className="text-[12px] font-medium text-slate-700">评测范围配置</p>

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
                {d.label} <span className="opacity-60">{d.count}</span>
              </button>
            ))}
          </div>
        </div>

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
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
          <div className="text-[12px] text-slate-500">
            共 <span className="font-semibold text-slate-800">{totalCombos}</span> 个组合
            {profile && <span className="ml-2 text-slate-400">· {profile.model}</span>}
          </div>
          <button
            onClick={launch}
            disabled={launching || isRunning || totalCombos === 0}
            className="px-4 py-1.5 rounded bg-slate-900 text-white text-[12px] font-medium
                       hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {launching ? "提交中…" : isRunning ? "批跑进行中…" : "开始批跑"}
          </button>
        </div>

        {error && (
          <p className="text-[12px] text-red-600 border border-red-200 rounded px-3 py-2 bg-red-50">{error}</p>
        )}
      </div>

      {/* Active batch live panel */}
      {activeBatch && (
        <div className={`border rounded-lg p-5 space-y-4 ${
          isRunning ? "border-blue-200 bg-blue-50/20" : "border-slate-200"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-[12px] font-medium text-slate-700">
                {isRunning ? "实时进度" : "批跑结果"}
              </p>
              <span className="font-mono text-[11px] text-slate-400">{activeBatch.batch_id}</span>
            </div>
            <StatusChip status={activeBatch.status} />
          </div>

          <AnimatedProgressBar
            done={activeBatch.done_count}
            total={activeBatch.total}
            failed={activeBatch.failed_count}
          />

          {isRunning && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-slate-400 uppercase tracking-wide">
                当前并发任务（{activeBatch.running_tasks?.length ?? 0}/4 worker）
              </p>
              <RunningTaskList tasks={activeBatch.running_tasks ?? []} />
            </div>
          )}

          {!isRunning && activeBatch.status === "done" && (
            <div className="flex items-center gap-2 text-[12px] text-emerald-700">
              <span>✓</span>
              <span>批跑完成，共 {activeBatch.done_count} 个评测，{activeBatch.failed_count} 失败</span>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {batches.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-slate-700">历史批跑记录</p>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            {batches.map(b => (
              <div
                key={b.batch_id}
                className="px-4 py-3 flex items-center gap-4 hover:bg-slate-50 cursor-pointer transition-colors"
                onClick={() => {
                  setActiveBatch(b);
                  if (b.status === "running") pollActive(b.batch_id);
                }}
              >
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
                      <AnimatedProgressBar done={b.done_count} total={b.total} failed={b.failed_count} />
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

      {batches.length === 0 && !activeBatch && (
        <p className="text-[12px] text-slate-400 text-center py-8">暂无批跑记录，配置范围后点击「开始批跑」</p>
      )}
    </div>
  );
}
