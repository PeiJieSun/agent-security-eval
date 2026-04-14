import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type Eval, type EvalReport, type TrajectoryDetail } from "../lib/api";
import ScoreCard from "../components/ScoreCard";
import TrajectoryDiff from "../components/TrajectoryDiff";

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  done: "已完成",
  error: "出错",
};

export default function EvalDetail() {
  const { eval_id } = useParams<{ eval_id: string }>();
  const navigate = useNavigate();

  const [evalRecord, setEvalRecord] = useState<Eval | null>(null);
  const [report, setReport] = useState<EvalReport | null>(null);
  const [cleanTraj, setCleanTraj] = useState<TrajectoryDetail | null>(null);
  const [attackTraj, setAttackTraj] = useState<TrajectoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bibtexMap, setBibtexMap] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadReport = async (ev: Eval) => {
    if (ev.status !== "done") return;
    try {
      const rep = await api.getReport(ev.eval_id);
      setReport(rep);
      try { setCleanTraj(await api.getTrajectory(rep.benign_trajectory_id)); } catch {}
      try { setAttackTraj(await api.getTrajectory(rep.attack_trajectory_id)); } catch {}
    } catch {}
  };

  useEffect(() => {
    if (!eval_id) return;
    const poll = async () => {
      try {
        const ev = await api.getEval(eval_id);
        setEvalRecord(ev);
        setLoading(false);
        if (ev.status === "done" && !report) {
          await loadReport(ev);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (ev.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [eval_id]);

  useEffect(() => {
    api.getMetricStandards().then((standards) => {
      const map: Record<string, string> = {};
      for (const s of standards) map[s.id] = s.bibtex;
      setBibtexMap(map);
    });
  }, []);

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-gray-100 text-gray-600",
      running: "bg-blue-100 text-blue-700 animate-pulse",
      done: "bg-green-100 text-green-700",
      error: "bg-red-100 text-red-700",
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${styles[status] ?? styles.pending}`}>
        {STATUS_LABEL[status] ?? status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-rose-500 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* 头部 */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <button onClick={() => navigate("/")} className="text-sm text-gray-400 hover:text-gray-600">
              ← 返回主页
            </button>
            <h1 className="text-xl font-bold text-gray-900 mt-1">
              评测：{evalRecord?.task_id}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {evalRecord && statusBadge(evalRecord.status)}
              <span className="text-xs text-gray-400 font-mono">{eval_id}</span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">{evalRecord?.model}</span>
            </div>
          </div>
          <a
            href="/standards"
            className="text-xs text-blue-600 hover:underline border border-blue-200 px-2 py-1 rounded"
          >
            评测标准 ↗
          </a>
        </div>

        {/* 运行中提示 */}
        {(evalRecord?.status === "running" || evalRecord?.status === "pending") && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-700 flex items-center gap-2">
            <div className="animate-spin w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full" />
            评测运行中，每 3 秒自动刷新结果…
          </div>
        )}

        {/* 出错提示 */}
        {evalRecord?.status === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
            <strong>评测失败：</strong> {evalRecord.error}
          </div>
        )}

        {/* 评分卡 */}
        {report && (
          <>
            {/* Robustness Δ 说明条 */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm flex items-center gap-6">
              <div className="text-center min-w-[80px]">
                <p className="text-xs text-gray-400 uppercase tracking-wide">鲁棒性 Δ</p>
                <p className={`text-2xl font-bold ${
                  report.robustness_delta > 0.5 ? "text-red-600"
                  : report.robustness_delta > 0 ? "text-yellow-600"
                  : "text-green-600"
                }`}>
                  {report.robustness_delta >= 0 ? "+" : ""}{(report.robustness_delta * 100).toFixed(0)}%
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">BU − UuA（推导值）</p>
              </div>
              <p className="text-xs text-gray-500 flex-1">
                鲁棒性 Δ 衡量 Agent 在受攻击时效用下降幅度。
                理想值为 0%（攻击无影响）；正值越大说明 Agent 受注入影响越严重。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <ScoreCard metric={report.benign_utility} bibtex={bibtexMap["benign_utility"]} />
              <ScoreCard metric={report.utility_under_attack} bibtex={bibtexMap["utility_under_attack"]} />
              <ScoreCard metric={report.targeted_asr} bibtex={bibtexMap["targeted_asr"]} />
              <ScoreCard metric={report.asr_valid} bibtex={bibtexMap["asr_valid"]} />
            </div>

            {/* 轨迹对比 */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <TrajectoryDiff cleanTraj={cleanTraj} attackTraj={attackTraj} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
