/**
 * BatchEvalPage — 批量评测
 * Runs all tasks × injection styles concurrently (4 workers) and streams progress.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  running_tasks?: string[];
}

interface EvalRow {
  eval_id: string; task_id: string; model: string; status: string; created_at: string;
  domain: string; description: string; attack_type: string;
  benign_utility: number | null; utility_under_attack: number | null; targeted_asr: number | null;
  injection_style: string | null;
}

interface BatchResult {
  total: number; with_report: number;
  summary: { benign_utility: number; utility_under_attack: number; targeted_asr: number };
  evals: EvalRow[];
}

function pct(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function MetricBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-[11px] font-mono w-8 text-right">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

const DOMAIN_COLORS: Record<string, string> = {
  email: "bg-blue-50 text-blue-700 border-blue-200",
  research: "bg-violet-50 text-violet-700 border-violet-200",
  chinese: "bg-orange-50 text-orange-700 border-orange-200",
  agentdojo: "bg-teal-50 text-teal-700 border-teal-200",
  injecagent: "bg-rose-50 text-rose-700 border-rose-200",
};

const STYLE_LABELS: Record<string, string> = {
  naive: "直接注入", camouflaged: "伪装", authority: "权威",
  encoded: "编码", chinese_obfuscated: "中文混淆",
};

function DomainBadge({ domain }: { domain: string }) {
  const cls = DOMAIN_COLORS[domain] ?? "bg-slate-50 text-slate-500 border-slate-200";
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls}`}>{domain}</span>;
}

function BatchResultPanel({
  result, batch, showTable, onToggleTable, onRerun,
}: {
  result: BatchResult;
  batch: Batch;
  showTable: boolean;
  onToggleTable: () => void;
  onRerun: () => void;
}) {
  const navigate = useNavigate();
  const s = result.summary;
  const safetyScore = Math.round(((s.benign_utility + s.utility_under_attack + (1 - s.targeted_asr)) / 3) * 100);
  const cfg = batch.config;

  return (
    <div className="space-y-4">
      {/* Batch config + re-run */}
      <div className="flex items-start justify-between gap-4 px-3 py-2.5 bg-slate-50 rounded-lg border border-slate-200">
        <div className="space-y-1 text-[11px] text-slate-600 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-700">模型</span>
            <span className="font-mono">{batch.model}</span>
            <span className="text-slate-300">·</span>
            <span className="font-medium text-slate-700">任务域</span>
            {(cfg.domains ?? []).map(d => <DomainBadge key={d} domain={d} />)}
            <span className="text-slate-300">·</span>
            <span className="font-medium text-slate-700">注入风格</span>
            <span>{(cfg.injection_styles ?? []).map(s => STYLE_LABELS[s] ?? s).join("、")}</span>
          </div>
          <div className="text-slate-400">
            共 {result.total} 个评测 · {result.with_report} 条报告 ·{" "}
            {new Date(batch.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <button
          onClick={onRerun}
          className="shrink-0 text-[11px] px-3 py-1.5 rounded border border-slate-300 text-slate-600
                     hover:border-slate-500 hover:text-slate-800 transition-colors whitespace-nowrap"
        >
          ↻ 重新运行
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {([
          { label: "安全综合分", value: `${safetyScore}`, sub: "三维加权平均", big: true, warn: false },
          { label: "Benign Utility", value: `${(s.benign_utility * 100).toFixed(1)}%`, sub: "正常任务完成率", warn: false },
          { label: "Under Attack", value: `${(s.utility_under_attack * 100).toFixed(1)}%`, sub: "攻击下任务完成率", warn: false },
          { label: "攻击成功率 ASR", value: `${(s.targeted_asr * 100).toFixed(1)}%`, sub: "越低越安全", warn: s.targeted_asr > 0.3 },
        ] as { label: string; value: string; sub: string; big?: boolean; warn: boolean }[]).map(c => (
          <div key={c.label} className={`border rounded-lg p-3 ${c.warn ? "border-red-200 bg-red-50/30" : "border-slate-200"}`}>
            <p className="text-[10px] text-slate-400 mb-0.5">{c.label}</p>
            <p className={`font-bold ${c.big ? "text-2xl text-slate-900" : "text-lg text-slate-800"}`}>{c.value}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Metric bars */}
      <div className="space-y-2 border border-slate-100 rounded-lg p-3">
        {[
          { label: "Benign Utility", v: s.benign_utility, color: "bg-emerald-400" },
          { label: "Utility Under Attack", v: s.utility_under_attack, color: "bg-blue-400" },
          { label: "Attack ASR（越低越好）", v: s.targeted_asr, color: "bg-red-400" },
        ].map(m => (
          <div key={m.label} className="grid grid-cols-[160px_1fr] items-center gap-2">
            <span className="text-[11px] text-slate-500">{m.label}</span>
            <MetricBar value={m.v} color={m.color} />
          </div>
        ))}
      </div>

      {/* Bridge to full report */}
      <div className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 bg-slate-50/60">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-slate-700">
            当前为一类威胁快照（AgentDojo 三维）
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            完整系统评价含二类威胁（诚实性）、三类威胁（基础设施）及 OWASP / 内部方案 v1 十二维对应
          </p>
        </div>
        <button
          onClick={() => navigate(`/report?model=${encodeURIComponent(batch.model)}`)}
          className="ml-4 shrink-0 text-[12px] px-3 py-1.5 rounded border border-slate-400 text-slate-700
                     hover:bg-slate-100 transition-colors whitespace-nowrap font-medium"
        >
          查看系统安全报告 →
        </button>
      </div>

      {/* Per-task detail table */}
      <div>
        <button
          onClick={onToggleTable}
          className="text-[12px] text-slate-600 hover:text-slate-900 flex items-center gap-1"
        >
          <span>{showTable ? "▾" : "▸"}</span>
          <span>每任务明细（{result.with_report} 条报告）</span>
        </button>
        {showTable && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["域", "任务 ID", "任务描述", "攻击类型", "注入风格", "Benign", "Under Attack", "ASR"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.evals.map(e => (
                  <tr key={e.eval_id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5"><DomainBadge domain={e.domain} /></td>
                    <td className="px-3 py-1.5 font-mono text-slate-700 max-w-[120px] truncate" title={e.task_id}>{e.task_id}</td>
                    <td className="px-3 py-1.5 text-slate-500 max-w-[200px] truncate" title={e.description}>{e.description || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{e.attack_type || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{e.injection_style ? (STYLE_LABELS[e.injection_style] ?? e.injection_style) : "—"}</td>
                    <td className="px-3 py-1.5 text-center">{e.benign_utility != null ? `${(e.benign_utility * 100).toFixed(0)}%` : "—"}</td>
                    <td className="px-3 py-1.5 text-center">{e.utility_under_attack != null ? `${(e.utility_under_attack * 100).toFixed(0)}%` : "—"}</td>
                    <td className={`px-3 py-1.5 text-center font-medium ${e.targeted_asr != null && e.targeted_asr > 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {e.targeted_asr != null ? `${(e.targeted_asr * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
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
    cancelled: "text-slate-500 border-slate-200 bg-slate-50",
    interrupted: "text-amber-700 border-amber-200 bg-amber-50",
    pending: "text-slate-500 border-slate-200 bg-slate-50",
  };
  const label: Record<string, string> = {
    running: "运行中", done: "完成", done_with_errors: "完成(含错误)",
    failed: "失败", cancelled: "已停止", interrupted: "中断（重启）", pending: "等待",
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

function RunningTaskList({ tasks, updatedAt }: { tasks: string[]; updatedAt?: string }) {
  // Detect stale: last update > 60s ago with no running tasks = backend restarted mid-run
  const isStale = (() => {
    if (!updatedAt || tasks.length > 0) return false;
    const age = (Date.now() - new Date(updatedAt).getTime()) / 1000;
    return age > 60;
  })();

  if (isStale) return (
    <p className="text-[11px] text-amber-600 italic">
      ⚠ 检测到后端已重启，该批次线程已中断。请点击「■ 停止」标记为结束，然后重新发起。
    </p>
  );
  if (tasks.length === 0) return (
    <p className="text-[11px] text-slate-400 italic animate-pulse">正在启动并发 worker…</p>
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
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [systemPromptOverride, setSystemPromptOverride] = useState("");
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

  // Auto-attach to running batch on load; load results for done batches
  useEffect(() => {
    const running = batches.find(b => b.status === "running");
    if (running && (!activeBatch || activeBatch.batch_id !== running.batch_id)) {
      setActiveBatch(running);
      setBatchResult(null);
      pollActive(running.batch_id);
    } else if (!running && !activeBatch && batches.length > 0) {
      // Auto-select the most recent batch and load its results
      const latest = batches[0];
      setActiveBatch(latest);
      loadBatchResult(latest.batch_id);
    }
  }, [batches]);

  // When active batch transitions from running → done, load results
  useEffect(() => {
    if (activeBatch && activeBatch.status !== "running" && !batchResult) {
      loadBatchResult(activeBatch.batch_id);
    }
  }, [activeBatch?.status]);

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
      const body: Record<string, unknown> = {
        domains: [...selDomains],
        injection_styles: [...selStyles],
        model: profile?.model,
        api_key: customApiKey || profile?.apiKey,
        base_url: customEndpoint || profile?.baseUrl || undefined,
      };
      if (systemPromptOverride.trim()) body.system_prompt_override = systemPromptOverride.trim();
      const b = await api.createBatch(body) as Batch;
      setActiveBatch(b);
      loadBatches();
      pollActive(b.batch_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const loadBatchResult = (batch_id: string) => {
    api.getBatchEvals(batch_id).then(r => {
      setBatchResult(r as BatchResult);
    }).catch(() => {});
  };

  const stopBatch = async (batch_id: string) => {
    setCancelling(batch_id);
    try {
      await api.cancelBatch(batch_id);
      setBatches(prev => prev.map(b => b.batch_id === batch_id ? { ...b, status: "cancelled" } : b));
      if (activeBatch?.batch_id === batch_id) setActiveBatch(b => b ? { ...b, status: "cancelled" } : b);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      loadBatches();
    } catch (e) {
      setError(String(e));
    } finally {
      setCancelling(null);
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
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-slate-700">评测范围配置</p>
          {/* Quick-select presets from standard_v1.yaml */}
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setSelDomains(new Set(["email"]));
                setSelStyles(new Set(["naive"]));
              }}
              className="px-2 py-1 text-[10px] border border-slate-200 rounded hover:bg-slate-50 text-slate-500"
              title="P0 Smoke — email × naive，最快验证"
            >
              P0 Smoke
            </button>
            <button
              onClick={() => {
                setSelDomains(new Set(["email", "research", "chinese"]));
                setSelStyles(new Set(["naive", "camouflaged"]));
              }}
              className="px-2 py-1 text-[10px] border border-slate-200 rounded hover:bg-slate-50 text-slate-500"
              title="三域 × 2风格 快速版"
            >
              快速版
            </button>
            <button
              onClick={() => {
                setSelDomains(new Set(["email", "research", "chinese"]));
                setSelStyles(new Set(["naive", "camouflaged", "authority", "encoded", "chinese_obfuscated"]));
              }}
              className="px-2 py-1 text-[10px] border border-slate-800 rounded bg-slate-800 text-white"
              title="standard_v1 全量：21 任务 × 5 风格"
            >
              标准套件 v1
            </button>
          </div>
        </div>

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

        {/* Advanced / Custom Agent */}
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <span>{showAdvanced ? "▼" : "▶"}</span>
            <span>高级 / 接入内部 Agent</span>
          </button>
          {showAdvanced && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">自定义 Base URL</label>
                  <input
                    type="text"
                    value={customEndpoint}
                    onChange={e => setCustomEndpoint(e.target.value)}
                    placeholder={profile?.baseUrl || "https://api.openai.com/v1"}
                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="text-[9px] text-slate-400 mt-0.5">留空则使用当前激活配置</p>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">自定义 API Key</label>
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={e => setCustomApiKey(e.target.value)}
                    placeholder="留空则使用当前激活配置"
                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">系统提示词覆盖（可选）</label>
                <textarea
                  value={systemPromptOverride}
                  onChange={e => setSystemPromptOverride(e.target.value)}
                  rows={2}
                  placeholder="留空则使用框架默认环境提示词"
                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
          <div className="text-[12px] text-slate-500">
            共 <span className="font-semibold text-slate-800">{totalCombos}</span> 个组合
            {profile && <span className="ml-2 text-slate-400">· {profile.model}</span>}
            {customEndpoint && <span className="ml-2 text-blue-500 text-[10px]">→ {customEndpoint}</span>}
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
            <div className="flex items-center gap-2">
              <StatusChip status={activeBatch.status} />
              {isRunning && (
                <button
                  onClick={() => stopBatch(activeBatch.batch_id)}
                  disabled={cancelling === activeBatch.batch_id}
                  className="text-[11px] px-2.5 py-0.5 rounded border border-red-200 text-red-600
                             hover:bg-red-50 disabled:opacity-40 transition-colors"
                >
                  {cancelling === activeBatch.batch_id ? "停止中…" : "■ 停止"}
                </button>
              )}
            </div>
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
              <RunningTaskList
                tasks={activeBatch.running_tasks ?? []}
                updatedAt={activeBatch.updated_at}
              />
            </div>
          )}

          {!isRunning && (activeBatch.status === "done" || activeBatch.status === "done_with_errors") && batchResult && (
            <BatchResultPanel
              result={batchResult}
              batch={activeBatch}
              showTable={showTable}
              onToggleTable={() => setShowTable(t => !t)}
              onRerun={() => {
                // Pre-fill selectors from batch config
                const cfg = activeBatch.config;
                if (cfg.domains) setSelDomains(new Set(cfg.domains));
                if (cfg.injection_styles) setSelStyles(new Set(cfg.injection_styles));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
          {!isRunning && activeBatch.status === "cancelled" && (
            <p className="text-[12px] text-slate-500">已手动停止，共完成 {activeBatch.done_count}/{activeBatch.total} 个评测</p>
          )}
          {!isRunning && activeBatch.status === "interrupted" && (
            <p className="text-[12px] text-amber-600">⚠ 后端重启导致中断，已完成 {activeBatch.done_count}/{activeBatch.total} 个评测</p>
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
                  setBatchResult(null);
                  setShowTable(false);
                  if (b.status === "running") pollActive(b.batch_id);
                  else loadBatchResult(b.batch_id);
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
                <div className="text-right text-[12px] shrink-0 space-y-1">
                  <div className="text-slate-700 font-medium">
                    {b.done_count}/{b.total}
                    {b.failed_count > 0 && <span className="text-red-500 ml-1">({b.failed_count} 失败)</span>}
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    {new Date(b.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {b.status === "running" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); stopBatch(b.batch_id); }}
                      disabled={cancelling === b.batch_id}
                      className="text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-500
                                 hover:bg-red-50 disabled:opacity-40 transition-colors"
                    >
                      {cancelling === b.batch_id ? "停止中" : "■ 停止"}
                    </button>
                  )}
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
