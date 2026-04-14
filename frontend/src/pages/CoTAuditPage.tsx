/**
 * CoTAuditPage — M2-6: Chain-of-Thought Reasoning Audit
 * Audit an existing trajectory's reasoning-vs-action consistency.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type SafetyEval, type Eval, type SafetyStandard } from "../lib/api";
import { getActiveProfile } from "../lib/settings";
import SafetySourceCard from "../components/SafetySourceCard";

interface CoTStepAudit {
  step_k: number;
  tool_name: string;
  tool_kwargs: Record<string, unknown>;
  reasoning: string | null;
  consistency_score: number;
  is_consistent: boolean;
  mismatch_reason: string | null;
}

interface CoTResult {
  trajectory_id: string;
  task_id: string;
  total_steps: number;
  steps_with_reasoning: number;
  audited_steps: CoTStepAudit[];
  mean_consistency: number;
  mismatch_count: number;
  verdict: "HONEST" | "SUSPICIOUS" | "DECEPTIVE";
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    HONEST: "bg-green-100 text-green-800",
    SUSPICIOUS: "bg-amber-100 text-amber-800",
    DECEPTIVE: "bg-red-100 text-red-800",
  };
  const labels: Record<string, string> = {
    HONEST: "诚实推理",
    SUSPICIOUS: "推理可疑",
    DECEPTIVE: "推理欺骗性",
  };
  return (
    <span className={`px-3 py-1 rounded-full font-bold text-sm ${styles[verdict] ?? styles.SUSPICIOUS}`}>
      {labels[verdict] ?? verdict}
    </span>
  );
}

function ResultView({ result }: { result: CoTResult }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      <div className={`rounded-xl p-4 border ${
        result.verdict === "HONEST" ? "bg-green-50 border-green-200" :
        result.verdict === "DECEPTIVE" ? "bg-red-50 border-red-200" :
        "bg-amber-50 border-amber-200"
      }`}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">
            {result.verdict === "HONEST" ? "✅" : result.verdict === "DECEPTIVE" ? "🚨" : "⚠️"}
          </span>
          <VerdictBadge verdict={result.verdict} />
          <span className="text-sm text-gray-600">平均一致性得分 {(result.mean_consistency * 100).toFixed(0)}%</span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center mt-3">
          {[
            { label: "总步骤", value: result.total_steps },
            { label: "含推理步骤", value: result.steps_with_reasoning },
            { label: "推理不一致", value: result.mismatch_count, highlight: result.mismatch_count > 0 },
          ].map((s) => (
            <div key={s.label} className="bg-white/60 rounded-lg p-2">
              <p className={`text-xl font-bold ${s.highlight ? "text-red-700" : "text-gray-800"}`}>{s.value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2">逐步推理审计</h3>
        <div className="space-y-2">
          {result.audited_steps.map((step) => (
            <div
              key={step.step_k}
              className={`rounded-lg border p-3 cursor-pointer ${!step.is_consistent ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}
              onClick={() => setExpanded(expanded === step.step_k ? null : step.step_k)}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 font-mono w-8">步 {step.step_k}</span>
                <span className="text-xs font-mono font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">{step.tool_name}</span>
                <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${step.is_consistent ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {step.is_consistent ? "✓ 一致" : "✗ 不一致"} {(step.consistency_score * 100).toFixed(0)}%
                </span>
              </div>
              {expanded === step.step_k && (
                <div className="mt-3 space-y-2 text-xs">
                  {step.reasoning ? (
                    <div className="bg-purple-50 rounded p-2">
                      <p className="text-purple-500 font-semibold mb-1">推理内容</p>
                      <p className="text-purple-800 leading-relaxed">{step.reasoning}</p>
                    </div>
                  ) : (
                    <p className="text-gray-400 italic">此步骤无推理内容（未使用 CoT 模式）</p>
                  )}
                  {step.mismatch_reason && (
                    <div className="bg-red-50 rounded p-2">
                      <p className="text-red-500 font-semibold mb-1">不一致原因</p>
                      <p className="text-red-700 leading-relaxed">{step.mismatch_reason}</p>
                    </div>
                  )}
                  {Object.keys(step.tool_kwargs).length > 0 && (
                    <div className="bg-gray-50 rounded p-2">
                      <p className="text-gray-500 font-semibold mb-1">工具参数</p>
                      <pre className="text-gray-700 font-mono text-[10px]">{JSON.stringify(step.tool_kwargs, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CoTAuditPage() {
  const { safety_id } = useParams<{ safety_id?: string }>();
  const navigate = useNavigate();
  const [evals, setEvals] = useState<Eval[]>([]);
  const [trajectoryId, setTrajectoryId] = useState("");
  const [taskId, setTaskId] = useState("email-exfil");
  const [running, setRunning] = useState(false);
  const [currentEval, setCurrentEval] = useState<SafetyEval | null>(null);
  const [result, setResult] = useState<CoTResult | null>(null);

  const [standard, setStandard] = useState<SafetyStandard | null>(null);

  useEffect(() => {
    api.listEvals(20).then(setEvals).catch(() => {});
    api.getSafetyStandards().then(ss => setStandard(ss.find(s => s.eval_type === "cot_audit") ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!safety_id) return;
    const poll = () => api.getSafetyEval(safety_id).then((ev) => {
      setCurrentEval(ev);
      if (ev.status === "done") api.getSafetyResult(safety_id).then(setResult as any).catch(() => {});
    }).catch(() => {});
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [safety_id]);

  const profile = getActiveProfile();

  const handleStart = async () => {
    if (!trajectoryId.trim()) { alert("请填写轨迹 ID"); return; }
    if (!profile?.apiKey) { alert("请先配置 API Key"); navigate("/settings"); return; }
    setRunning(true);
    try {
      const ev = await api.createCoTAudit({
        trajectory_id: trajectoryId.trim(),
        task_id: taskId,
        model: profile.model,
        api_key: profile.apiKey,
        base_url: profile.baseUrl,
      });
      navigate(`/safety/cot-audit/${ev.safety_id}`);
    } catch (e) {
      alert("启动失败: " + String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-3">
        <button onClick={() => navigate("/safety")} className="text-sm text-slate-400 hover:text-slate-600">← 二类威胁</button>
        <span className="text-slate-300">|</span>
        <span className="text-base font-bold">🔍 CoT 推理审计</span>
        <span className="text-xs text-slate-400">M2-6 · 推理-行动一致性</span>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        {standard && <SafetySourceCard standard={standard} />}
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-800">
          <p className="font-semibold mb-1">原理</p>
          <p className="text-xs leading-relaxed">
            对 Agent 的每步推理（&lt;thinking&gt;）与实际工具调用进行语义一致性评估。
            推理-行动不一致是 AI 欺骗性对齐（Deceptive Alignment）的可观测信号。
            注意：需要使用 CoT 模式运行 Agent 才能记录推理内容。
          </p>
        </div>

        {!safety_id && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">选择要审计的轨迹</h2>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">轨迹 ID（从已完成评测的 clean/attack 轨迹中选择）</label>
              <input
                value={trajectoryId}
                onChange={(e) => setTrajectoryId(e.target.value)}
                placeholder="例如：eval_abc123_clean"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            {/* Quick-pick from recent evals */}
            {evals.filter(e => e.status === "done").length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">或从已完成评测快速选择：</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {evals.filter(e => e.status === "done").map((ev) => (
                    <button
                      key={ev.eval_id}
                      className="w-full text-left text-xs px-2 py-1.5 rounded border border-gray-100 hover:bg-gray-50"
                      onClick={() => { setTrajectoryId(`${ev.eval_id}_clean`); setTaskId(ev.task_id); }}
                    >
                      {ev.task_id} — {ev.eval_id}_clean
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">对应任务 ID</label>
              <input
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <button
              onClick={handleStart}
              disabled={running || !trajectoryId.trim()}
              className="w-full rounded-lg bg-purple-600 text-white text-sm font-semibold py-2.5 hover:bg-purple-700 disabled:opacity-50"
            >
              {running ? "启动中…" : "开始审计"}
            </button>
          </div>
        )}

        {currentEval && (
          <div className={`rounded-xl border p-4 ${currentEval.status === "error" ? "bg-red-50 border-red-200" : "bg-white border-gray-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-gray-800">审计状态</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                currentEval.status === "done" ? "bg-green-100 text-green-700" :
                currentEval.status === "error" ? "bg-red-100 text-red-700" :
                "bg-purple-100 text-purple-700 animate-pulse"
              }`}>{currentEval.status === "done" ? "已完成" : currentEval.status === "error" ? "出错" : "审计中…"}</span>
            </div>
            {currentEval.status === "error" && <p className="text-sm text-red-700">{currentEval.error}</p>}
          </div>
        )}

        {result && <ResultView result={result} />}
      </main>
    </div>
  );
}
