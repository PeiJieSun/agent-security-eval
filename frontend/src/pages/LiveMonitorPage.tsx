/**
 * LiveMonitorPage — M3-1: Real-time agent monitoring via SSE.
 *
 * Connects to GET /evals/{eval_id}/stream and renders:
 *   - A live feed of every tool call the agent makes (both clean + attack runs)
 *   - OnlineJudge alerts with severity badges
 *   - Running alert count and step counter
 *   - Auto-scroll to latest event
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const BASE = "/api/v1/agent-eval";

type RunType = "clean" | "attack";

interface StepEvent {
  event_type: "tool_call_step";
  ts: string;
  step_k: number;
  tool_name: string;
  tool_kwargs: Record<string, unknown>;
  observation: Record<string, unknown>;
  reasoning?: string | null;
  run_type: RunType;
}

interface AlertEvent {
  event_type: "policy_alert";
  ts: string;
  rule: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  step_k: number;
  detail: Record<string, unknown>;
}

interface DoneEvent {
  event_type: "eval_done";
  ts: string;
  eval_id: string;
  report_summary?: { benign_utility?: number; targeted_asr?: number };
}

interface ErrorEvent {
  event_type: "eval_error";
  ts: string;
  error: string;
}

type LiveEvent = StepEvent | AlertEvent | DoneEvent | ErrorEvent;

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 border-red-400 text-red-800",
  high:     "bg-orange-100 border-orange-400 text-orange-800",
  medium:   "bg-amber-100 border-amber-400 text-amber-700",
  low:      "bg-slate-100 border-slate-300 text-slate-600",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-400",
  low:      "bg-slate-400",
};

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false }); }
  catch { return iso; }
}

function StepCard({ ev }: { ev: StepEvent }) {
  const [open, setOpen] = useState(false);
  const isAttack = ev.run_type === "attack";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${isAttack ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isAttack ? "bg-rose-200 text-rose-800" : "bg-blue-100 text-blue-700"}`}>
          {isAttack ? "攻击 run" : "正常 run"}
        </span>
        <span className="text-xs text-slate-400 font-mono">#{ev.step_k + 1}</span>
        <span className="font-mono font-semibold text-slate-800">{ev.tool_name}</span>
        <span className="ml-auto text-[10px] text-slate-400">{fmtTime(ev.ts)}</span>
        <button onClick={() => setOpen(o => !o)} className="text-slate-400 text-xs">{open ? "▲" : "▼"}</button>
      </div>
      {ev.reasoning && (
        <div className="mt-2 text-[11px] italic text-purple-700 bg-purple-50 rounded p-2 border border-purple-200">
          🧠 {ev.reasoning.slice(0, 200)}{ev.reasoning.length > 200 ? "…" : ""}
        </div>
      )}
      {open && (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] text-slate-500">
            <span className="font-semibold">参数：</span>
            <code className="font-mono text-slate-700 ml-1">{JSON.stringify(ev.tool_kwargs)}</code>
          </div>
          <div className="text-[11px] text-slate-500">
            <span className="font-semibold">返回：</span>
            <code className="font-mono text-slate-600 ml-1 break-all">{JSON.stringify(ev.observation).slice(0, 300)}</code>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertCard({ ev }: { ev: AlertEvent }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 text-sm ${SEVERITY_STYLE[ev.severity] ?? SEVERITY_STYLE.low}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-block w-2 h-2 rounded-full ${SEVERITY_DOT[ev.severity]}`} />
        <span className="font-bold text-xs uppercase tracking-wide">{ev.severity}</span>
        <span className="font-mono text-xs bg-white/60 rounded px-1.5 py-0.5">{ev.rule}</span>
        <span className="text-[10px] ml-auto opacity-60">步骤 #{ev.step_k + 1} · {fmtTime(ev.ts)}</span>
      </div>
      <p className="font-semibold">{ev.message}</p>
      {Object.keys(ev.detail).length > 0 && (
        <code className="text-[10px] block mt-1 opacity-70">{JSON.stringify(ev.detail)}</code>
      )}
    </div>
  );
}

function DoneCard({ ev }: { ev: DoneEvent }) {
  const s = ev.report_summary;
  return (
    <div className="rounded-xl border-2 border-green-400 bg-green-50 px-4 py-3 text-sm text-green-800">
      <div className="font-bold text-base mb-1">✅ 评测完成</div>
      {s && (
        <div className="flex gap-4 text-xs">
          {s.benign_utility !== null && s.benign_utility !== undefined && (
            <span>Benign Utility: <strong>{(s.benign_utility * 100).toFixed(0)}%</strong></span>
          )}
          {s.targeted_asr !== null && s.targeted_asr !== undefined && (
            <span>Targeted ASR: <strong>{(s.targeted_asr * 100).toFixed(0)}%</strong></span>
          )}
        </div>
      )}
    </div>
  );
}

export default function LiveMonitorPage() {
  const { eval_id } = useParams<{ eval_id: string }>();
  const navigate = useNavigate();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [finished, setFinished] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!eval_id) return;
    const es = new EventSource(`${BASE}/evals/${eval_id}/stream`);
    esRef.current = es;

    es.addEventListener("connected", () => setConnected(true));

    const handleEvent = (raw: MessageEvent) => {
      try {
        const ev: LiveEvent = JSON.parse(raw.data);
        setEvents(prev => [...prev, ev]);
        if (ev.event_type === "policy_alert") setAlertCount(c => c + 1);
        if (ev.event_type === "eval_done" || ev.event_type === "eval_error") {
          setFinished(true);
          es.close();
        }
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener("tool_call_step", handleEvent);
    es.addEventListener("policy_alert", handleEvent);
    es.addEventListener("eval_done", handleEvent);
    es.addEventListener("eval_error", handleEvent);
    es.onerror = () => { setConnected(false); };

    return () => { es.close(); };
  }, [eval_id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const stepCount = events.filter(e => e.event_type === "tool_call_step").length;
  const cleanSteps = events.filter(e => e.event_type === "tool_call_step" && (e as StepEvent).run_type === "clean").length;
  const attackSteps = events.filter(e => e.event_type === "tool_call_step" && (e as StepEvent).run_type === "attack").length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800 px-6 py-3 flex items-center gap-4">
        <button onClick={() => navigate(`/evals/${eval_id}`)} className="text-sm text-slate-400 hover:text-slate-200">
          ← 返回详情
        </button>
        <span className="text-slate-600">|</span>
        <span className="font-bold text-base">🔴 实时监控</span>
        <span className="text-xs text-slate-400 font-mono truncate">{eval_id}</span>

        {/* Status pills */}
        <div className="ml-auto flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${connected ? "bg-green-900/60 text-green-400" : "bg-slate-700 text-slate-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-slate-500"}`} />
            {connected ? (finished ? "已结束" : "实时推流") : "连接中…"}
          </div>
          <div className="text-xs bg-slate-700 rounded-full px-2.5 py-1">
            工具调用 <span className="font-bold text-white">{stepCount}</span>
            <span className="mx-1 text-slate-500">·</span>
            <span className="text-blue-400">{cleanSteps} 正常</span>
            <span className="mx-1 text-slate-500">/</span>
            <span className="text-rose-400">{attackSteps} 攻击</span>
          </div>
          {alertCount > 0 && (
            <div className="text-xs bg-red-900/60 text-red-400 rounded-full px-2.5 py-1 font-bold animate-pulse">
              ⚠ {alertCount} 告警
            </div>
          )}
        </div>
      </header>

      {/* Policy rules legend */}
      <div className="border-b border-slate-700 bg-slate-800/50 px-6 py-2 flex gap-4 text-[10px] text-slate-500">
        <span>OnlineJudge 规则：</span>
        {["EXFIL_ATTEMPT → 数据外泄", "DANGEROUS_TOOL → 高危工具", "EXCESSIVE_SCOPE → 过度权限", "INJECTION_RELAY → 注入中继"].map(r => (
          <span key={r} className="text-slate-400">{r}</span>
        ))}
      </div>

      {/* Event feed */}
      <main className="mx-auto max-w-3xl px-4 py-6 space-y-3">
        {events.length === 0 && !finished && (
          <div className="text-center py-20 text-slate-500">
            <div className="text-4xl mb-3">⏳</div>
            <p>等待 Agent 开始运行…</p>
            <p className="text-xs mt-1 text-slate-600">确保评测已启动（在评测详情页点击"开始评测"）</p>
          </div>
        )}

        {events.map((ev, i) => {
          if (ev.event_type === "tool_call_step") return <StepCard key={i} ev={ev as StepEvent} />;
          if (ev.event_type === "policy_alert")   return <AlertCard key={i} ev={ev as AlertEvent} />;
          if (ev.event_type === "eval_done")      return <DoneCard key={i} ev={ev as DoneEvent} />;
          if (ev.event_type === "eval_error") return (
            <div key={i} className="rounded-xl border-2 border-red-400 bg-red-950/40 px-4 py-3 text-red-400 text-sm">
              ❌ 评测出错：{(ev as ErrorEvent).error}
            </div>
          );
          return null;
        })}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}
