import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TaskInfo } from "../lib/api";

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
      <div className="max-w-xl mx-auto px-4 py-8">
        <a href="/" className="text-sm text-gray-400 hover:text-gray-600">← Back to Dashboard</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">New Evaluation</h1>
        <p className="text-sm text-gray-500 mb-6">
          Runs a real LLM agent against an evaluation task — clean run + attacked run.
          Computes 4-dimensional security metrics as defined in{" "}
          <a href="/standards" className="text-blue-600 hover:underline">Evaluation Standards</a>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Task selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Evaluation Task
            </label>
            <select
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {tasks.map((t) => (
                <option key={t.task_id} value={t.task_id}>
                  {t.task_id} — {t.description.slice(0, 60)}…
                </option>
              ))}
            </select>
            {task && (
              <div className="mt-2 p-3 bg-white border border-gray-200 rounded-lg text-xs text-gray-600">
                <p className="mb-1">{task.description}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                    {task.attack_type}
                  </span>
                  {task.tags.map((tag) => (
                    <span key={tag} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Model
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="text-xs text-gray-400 mt-1">
              Any OpenAI-compatible model identifier (gpt-4o, gpt-4o-mini, etc.)
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              API Key <span className="font-normal text-gray-400">(or set OPENAI_API_KEY env var)</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Base URL <span className="font-normal text-gray-400">(optional, for vLLM/local)</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
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
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {submitting ? "Starting evaluation…" : "Run Evaluation"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>

        <p className="text-xs text-gray-400 mt-4 text-center">
          Evaluation runs asynchronously. You'll be redirected to the results page.
        </p>
      </div>
    </div>
  );
}
