/**
 * EvoAttackPage — M2-4: Evolutionary Attack Search
 * Iteratively evolves injection payloads using trajectory feedback.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type SafetyEval } from "../lib/api";
import { getActiveProfile } from "../lib/settings";

interface GenResult {
  generation: number;
  payload: string;
  style: string;
  attack_succeeded: boolean;
  tool_sequence: string[];
  mutation_reason: string;
}

interface ArchiveEntry {
  key: string;
  payload: string;
  style: string;
  attack_succeeded: boolean;
  generation: number;
}

interface EvoResult {
  task_id: string;
  model: string;
  n_generations: number;
  n_variants_per_gen: number;
  best_asr: float;
  diversity_score: float;
  generations: GenResult[];
  archive: ArchiveEntry[];
  summary: string;
  created_at: string;
}

type float = number;

function SvgAsr({ generations }: { generations: GenResult[] }) {
  if (generations.length === 0) return null;

  const W = 400, H = 120;
  const padL = 30, padB = 20, padR = 10, padT = 10;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // Group by generation and take success rate
  const genMap: Record<number, { total: number; success: number }> = {};
  for (const g of generations) {
    if (!genMap[g.generation]) genMap[g.generation] = { total: 0, success: 0 };
    genMap[g.generation].total++;
    if (g.attack_succeeded) genMap[g.generation].success++;
  }
  const pts = Object.entries(genMap)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([gen, { total, success }]) => ({
      gen: Number(gen),
      asr: success / total,
    }));

  if (pts.length < 2) return null;

  const maxGen = pts[pts.length - 1].gen;
  const xScale = (g: number) => padL + (g / maxGen) * innerW;
  const yScale = (v: number) => padT + innerH - v * innerH;

  const pathD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.gen).toFixed(1)} ${yScale(p.asr).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[100px]">
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <line
          key={v}
          x1={padL} y1={yScale(v).toFixed(1)}
          x2={W - padR} y2={yScale(v).toFixed(1)}
          stroke="#e2e8f0" strokeWidth="1"
        />
      ))}
      {/* Labels */}
      {[0, 0.5, 1].map((v) => (
        <text key={v} x={padL - 4} y={yScale(v) + 4} textAnchor="end" fontSize="8" fill="#94a3b8">
          {(v * 100).toFixed(0)}%
        </text>
      ))}
      {/* Line */}
      <path d={pathD} fill="none" stroke="#334155" strokeWidth="2" />
      {/* Dots */}
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={xScale(p.gen).toFixed(1)}
          cy={yScale(p.asr).toFixed(1)}
          r="3"
          fill={p.asr > 0 ? "#ef4444" : "#94a3b8"}
        />
      ))}
      {/* X labels */}
      {pts.map((p, i) => (
        <text key={i} x={xScale(p.gen).toFixed(1)} y={H - 4} textAnchor="middle" fontSize="8" fill="#94a3b8">
          G{p.gen}
        </text>
      ))}
    </svg>
  );
}

export default function EvoAttackPage() {
  const { safety_id } = useParams<{ safety_id?: string }>();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<{ task_id: string; description: string }[]>([]);
  const [selectedTask, setSelectedTask] = useState("email-exfil");
  const [nGen, setNGen] = useState(3);
  const [nVar, setNVar] = useState(3);
  const [running, setRunning] = useState(false);
  const [currentEval, setCurrentEval] = useState<SafetyEval | null>(null);
  const [result, setResult] = useState<EvoResult | null>(null);

  useEffect(() => {
    api.listEvoTasks().then(setTasks).catch(() => {});
  }, []);

  useEffect(() => {
    if (!safety_id) return;
    const poll = () =>
      api.getSafetyEval(safety_id).then((ev) => {
        setCurrentEval(ev);
        if (ev.status === "done")
          api.getSafetyResult(safety_id).then(setResult as any).catch(() => {});
      }).catch(() => {});
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [safety_id]);

  const profile = getActiveProfile();

  const handleStart = async () => {
    if (!profile?.apiKey) {
      alert("请先配置 API Key");
      navigate("/settings");
      return;
    }
    setRunning(true);
    try {
      const ev = await api.createEvoAttack({
        task_id: selectedTask,
        n_generations: nGen,
        model: profile.model,
        api_key: profile.apiKey,
        base_url: profile.baseUrl,
      });
      navigate(`/safety/evo-attack/${ev.safety_id}`);
    } catch (e) {
      alert("启动失败: " + String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="px-8 py-7 max-w-3xl mx-auto space-y-6">
      {/* Theory */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-700 mb-1">M2-4 进化攻击搜索</p>
        <p className="text-xs text-slate-500 leading-relaxed">
          基于轨迹反馈自动进化注入 payload：分析失败攻击 → LLM 诊断失败原因 →
          生成变体（改变注入风格：原始/权威/伪装/编码）→ 运行评测 → 更新 MAP-Elites 档案。
          每个 (task_id, style) 格子保留最优攻击，最终输出最佳 ASR 与多样性分数。
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          参考：MAP-Elites (Mouret & Clune, 2015) ·
          Jailbreaking Black Box LLMs in Twenty Queries (Chao et al., NeurIPS 2023, arXiv:2310.08419)
        </p>
      </div>

      {/* Config or status */}
      {!safety_id ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">配置进化搜索</h2>

          <div>
            <label className="text-xs text-slate-500 mb-1.5 block">目标任务</label>
            <select
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-white"
            >
              {tasks.map((t) => (
                <option key={t.task_id} value={t.task_id}>{t.task_id} — {t.description}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">代数（generations）</label>
              <input
                type="number"
                min={1} max={10} value={nGen}
                onChange={(e) => setNGen(Number(e.target.value))}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">每代变体数</label>
              <input
                type="number"
                min={1} max={8} value={nVar}
                onChange={(e) => setNVar(Number(e.target.value))}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            预计运行 {nGen} × {nVar} + {4} = {nGen * nVar + 4} 次 LLM 调用（第 0 代 4 种风格 + 后续每代）
          </p>

          <button
            onClick={handleStart}
            disabled={running}
            className="w-full py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50"
          >
            {running ? "启动中…" : "开始进化搜索"}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          {currentEval?.status === "running" && (
            <div className="animate-spin w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full" />
          )}
          <div>
            <p className="text-sm font-medium text-slate-800">
              {currentEval?.status === "running" ? "进化搜索运行中…" :
               currentEval?.status === "done" ? "搜索完成" :
               currentEval?.status === "error" ? `错误: ${currentEval.error}` : "等待中…"}
            </p>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{safety_id}</p>
          </div>
          <button
            onClick={() => navigate("/safety/evo-attack")}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-3 py-1 rounded"
          >
            新建搜索
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "最佳 ASR", value: `${(result.best_asr * 100).toFixed(0)}%`, highlight: result.best_asr > 0 },
              { label: "多样性分数", value: `${(result.diversity_score * 100).toFixed(0)}%` },
              { label: "攻击尝试次数", value: result.generations.length },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">{s.label}</p>
                <p className={`text-xl font-bold tabular-nums mt-0.5 ${'highlight' in s && s.highlight ? "text-red-600" : "text-slate-800"}`}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500">{result.summary}</p>

          {/* ASR over generations chart */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">各代 ASR 趋势</p>
            <SvgAsr generations={result.generations} />
          </div>

          {/* Archive */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">MAP-Elites 档案</p>
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="grid grid-cols-[auto_auto_auto_1fr] gap-4 px-5 py-2 border-b border-slate-100 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                <span>风格</span><span>第几代</span><span>是否成功</span><span>payload</span>
              </div>
              {result.archive.map((a, i) => (
                <div key={i} className={`grid grid-cols-[auto_auto_auto_1fr] gap-4 px-5 py-2.5 text-xs ${i < result.archive.length - 1 ? "border-b border-slate-50" : ""}`}>
                  <span className="font-mono text-slate-600">{a.style}</span>
                  <span className="text-slate-500">G{a.generation}</span>
                  <span className={a.attack_succeeded ? "text-red-600 font-medium" : "text-slate-400"}>
                    {a.attack_succeeded ? "✓ 成功" : "✗ 失败"}
                  </span>
                  <span className="text-slate-500 truncate font-mono text-[10px]">{a.payload}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Generation details */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">各代详情</p>
            <div className="space-y-1.5">
              {result.generations.map((g, i) => (
                <div
                  key={i}
                  className={`rounded-lg border border-slate-200 bg-white px-4 py-2.5 flex items-start gap-3 border-l-4 ${g.attack_succeeded ? "border-l-red-400" : "border-l-slate-200"}`}
                >
                  <span className="text-[10px] text-slate-400 font-mono w-8 shrink-0">G{g.generation}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${g.attack_succeeded ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-500"}`}>
                    {g.style}
                  </span>
                  <span className={`text-[10px] shrink-0 ${g.attack_succeeded ? "text-red-600" : "text-slate-400"}`}>
                    {g.attack_succeeded ? "✓" : "✗"}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate font-mono flex-1">{g.payload}</span>
                  {g.mutation_reason && (
                    <span className="text-[9px] text-slate-400 shrink-0 max-w-[120px] truncate">{g.mutation_reason}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
