import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TaskInfo } from "../lib/api";
import { loadSettings, hasApiKey, getActiveProfile } from "../lib/settings";
import { getStyleMeta } from "../lib/injectionStyles";

const ATTACK_TYPE_LABEL: Record<string, string> = {
  data_stealing: "数据窃取",
  direct_harm: "直接危害",
};

function TaskPreview({ task }: { task: TaskInfo }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white overflow-hidden text-xs">
      {/* User instruction */}
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-gray-400 font-semibold mb-1 uppercase tracking-wide text-[10px]">用户指令（Agent 收到的任务）</p>
        <p className="text-gray-700 leading-relaxed">{task.user_instruction}</p>
      </div>

      {/* Inbox preview */}
      {task.inbox_preview && task.inbox_preview.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-gray-400 font-semibold mb-2 uppercase tracking-wide text-[10px]">
            初始邮箱（Agent 环境）
          </p>
          {task.inbox_preview.map((email, i) => (
            <div key={i} className="mb-2 last:mb-0 bg-white rounded-lg border border-gray-200 p-2">
              <div className="text-[10px] text-gray-400 mb-0.5">
                发件人：<span className="text-gray-600">{email.sender}</span>
                <span className="mx-1">·</span>
                主题：<span className="text-gray-700 font-medium">{email.subject}</span>
              </div>
              <p className="text-gray-600 leading-relaxed">{email.body?.slice(0, 120)}{(email.body?.length ?? 0) > 120 ? "…" : ""}</p>
            </div>
          ))}
        </div>
      )}

      {/* Injection style badge */}
      {task.injection_style && (() => {
        const meta = getStyleMeta(task.injection_style);
        return (
          <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
            <span className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">注入风格</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${meta.bgColor} ${meta.color}`}>
              {meta.label}
            </span>
            <span className="text-gray-400 text-[10px]">{meta.desc}</span>
          </div>
        );
      })()}

      {/* Attack payload */}
      <div className="px-4 py-3 border-b border-gray-100 bg-red-50">
        <p className="text-red-400 font-semibold mb-1 uppercase tracking-wide text-[10px]">
          ⚠ 攻击注入载荷语义（实际格式由注入风格决定）
        </p>
        <p className="text-red-700 font-mono leading-relaxed bg-red-100 rounded p-2 whitespace-pre-wrap">
          {task.attack_payload}
        </p>
      </div>

      {/* Oracle expressions */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2 text-left text-[10px] text-gray-400 hover:bg-gray-50 flex items-center justify-between"
      >
        <span className="uppercase tracking-wide font-semibold">评测条件（Python 表达式）</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          <div>
            <p className="text-[10px] text-green-600 font-semibold mb-0.5">✅ 正常任务成功条件</p>
            <code className="block bg-green-50 text-green-800 rounded p-1.5 font-mono text-[11px] leading-relaxed">
              {task.benign_success_expr}
            </code>
          </div>
          <div>
            <p className="text-[10px] text-red-500 font-semibold mb-0.5">❌ 攻击目标成功条件</p>
            <code className="block bg-red-50 text-red-700 rounded p-1.5 font-mono text-[11px] leading-relaxed">
              {task.attack_success_expr}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewEval() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [selectedTask, setSelectedTask] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load saved settings
    const s = loadSettings();
    if (s.model) setModel(s.model);
    if (s.apiKey) setApiKey(s.apiKey);
    if (s.baseUrl) setBaseUrl(s.baseUrl);

    api.listTasks().then((ts) => {
      setTasks(ts);
      if (ts.length > 0) setSelectedTask(ts[0].task_id);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: { task_id: string; model?: string; api_key?: string; base_url?: string } = {
        task_id: selectedTask,
        model: model || undefined,
      };
      if (apiKey) body.api_key = apiKey;
      if (baseUrl) body.base_url = baseUrl;
      const evalRecord = await api.createEval(body);
      navigate(`/evals/${evalRecord.eval_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const task = tasks.find((t) => t.task_id === selectedTask);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <button onClick={() => navigate("/")} className="text-sm text-gray-400 hover:text-gray-600">
          ← 返回主页
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">一键测评</h1>
        <p className="text-sm text-gray-500 mb-6">
          对 LLM Agent 发起真实安全评测：正常运行 + 注入攻击各跑一次，输出{" "}
          <a href="/standards" className="text-blue-600 hover:underline">4 维安全指标</a>。
        </p>

        {/* Settings shortcut */}
        {!hasApiKey() && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-center gap-3">
            <span className="flex-1">⚠ 未配置 API Key，请先前往设置页面或在下方填写。</span>
            <button
              onClick={() => navigate("/settings")}
              className="text-xs bg-amber-600 text-white px-3 py-1 rounded-lg hover:bg-amber-700"
            >
              前往设置
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Task selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              评测任务
            </label>
            <div className="grid gap-2">
              {tasks.map((t) => (
                <label
                  key={t.task_id}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    selectedTask === t.task_id
                      ? "border-rose-400 bg-rose-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="task"
                    value={t.task_id}
                    checked={selectedTask === t.task_id}
                    onChange={() => setSelectedTask(t.task_id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{t.task_id}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        t.attack_type === "data_stealing"
                          ? "bg-orange-100 text-orange-700"
                          : "bg-red-100 text-red-700"
                      }`}>
                        {ATTACK_TYPE_LABEL[t.attack_type] ?? t.attack_type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.tags.map((tag) => (
                        <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* Task preview */}
            {task && <TaskPreview task={task} />}
          </div>

          {/* Model + API config */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">LLM 配置</h3>
                {getActiveProfile() && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    使用配置：<span className="font-medium text-gray-600">{getActiveProfile()!.name}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="text-xs text-rose-600 hover:underline"
              >
                管理配置 →
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">模型</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-… （已保存则留空）"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Base URL
                <span className="font-normal text-gray-400 ml-1">（可选，本地 vLLM 等）</span>
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting || !selectedTask}
              className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors shadow-sm"
            >
              {submitting ? "正在启动评测…" : "🚀 开始评测"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </form>

        <p className="text-xs text-gray-400 mt-4 text-center">
          评测在后台异步执行，提交后会自动跳转到结果页，等待完成。
        </p>
      </div>
    </div>
  );
}
