import type { TrajectoryDetail, TrajectoryStep } from "../lib/api";

interface TrajectoryDiffProps {
  cleanTraj: TrajectoryDetail | null;
  attackTraj: TrajectoryDetail | null;
}

function StepCard({ step, injected }: { step: TrajectoryStep; injected: boolean }) {
  const toolName = step.tool_call?.name ?? "(no tool)";
  const kwargs = step.tool_call?.kwargs ?? {};
  const obs = step.observation ?? {};

  return (
    <div
      className={`rounded-lg border p-3 text-xs mb-2 ${
        injected
          ? "border-red-300 bg-red-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-1 mb-1">
        {injected && (
          <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">
            ⚠ INJECTED
          </span>
        )}
          <span className="font-mono font-semibold text-gray-700">
          步骤 {step.step_k}：{toolName}
        </span>
      </div>

      {step.reasoning && (
        <p className="text-gray-500 italic mb-1 text-[11px]">💭 {step.reasoning}</p>
      )}

      {Object.keys(kwargs).length > 0 && (
        <div className="mb-1">
          <span className="text-gray-400">args: </span>
          <span className="font-mono text-blue-700">
            {JSON.stringify(kwargs, null, 0).slice(0, 120)}
          </span>
        </div>
      )}

      <div>
        <span className="text-gray-400">obs: </span>
        <span className={`font-mono ${injected ? "text-red-700" : "text-green-700"}`}>
          {JSON.stringify(obs, null, 0).slice(0, 180)}
        </span>
      </div>
    </div>
  );
}

function TrajColumn({
  traj,
  label,
  labelColor,
}: {
  traj: TrajectoryDetail | null;
  label: string;
  labelColor: string;
}) {
  if (!traj) {
    return (
      <div className="flex-1">
        <div className={`text-xs font-bold mb-2 ${labelColor}`}>{label}</div>
        <p className="text-gray-400 text-xs">暂无轨迹数据。</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold ${labelColor}`}>{label}</span>
        <span className="text-xs text-gray-400">{traj.steps.length} 步</span>
      </div>

      {traj.steps.map((step) => (
        <StepCard
          key={step.step_k}
          step={step}
          injected={!!step.observation?.__injected__}
        />
      ))}

      {traj.final_output && (
        <div className="mt-2 p-2 rounded bg-gray-50 border border-gray-200">
          <span className="text-xs text-gray-500 font-semibold">最终输出：</span>
          <span className="text-xs text-gray-700">{traj.final_output}</span>
        </div>
      )}

      {traj.steps.length === 0 && (
        <p className="text-gray-400 text-xs">未记录到任何步骤。</p>
      )}
    </div>
  );
}

export default function TrajectoryDiff({ cleanTraj, attackTraj }: TrajectoryDiffProps) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">轨迹对比</h3>
      <div className="flex gap-4 items-start">
        <TrajColumn traj={cleanTraj} label="✅ 正常运行" labelColor="text-green-700" />
        <div className="w-px bg-gray-200 self-stretch" />
        <TrajColumn traj={attackTraj} label="⚠ 攻击运行" labelColor="text-red-700" />
      </div>
    </div>
  );
}
