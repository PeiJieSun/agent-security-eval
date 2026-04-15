import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

interface AdapterInfo {
  adapter_id: string;
  name: string;
  description: string;
  supported_formats: string[];
  example_snippet: string;
}

interface PreviewTrajectory {
  task_id: string;
  step_count: number;
  tools_used: string[];
  first_steps: {
    step_k: number;
    tool: string;
    has_reasoning: boolean;
    observation_preview: string;
  }[];
}

interface PreviewResult {
  trajectories: PreviewTrajectory[];
  warnings: string[];
  stats: Record<string, any>;
}

interface ImportResult {
  imported: number;
  run_ids: string[];
  warnings: string[];
}

export default function TrajectoryImportPage() {
  const navigate = useNavigate();
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [selectedAdapter, setSelectedAdapter] = useState("");
  const [raw, setRaw] = useState("");
  const [taskId, setTaskId] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listAdapters().then((a) => {
      setAdapters(a);
      if (a.length > 0) setSelectedAdapter(a[0].adapter_id);
    });
  }, []);

  const activeAdapter = adapters.find((a) => a.adapter_id === selectedAdapter);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRaw(text);
    setPreview(null);
    setImportResult(null);
    setError(null);
  };

  const doPreview = async () => {
    if (!selectedAdapter || !raw.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.previewImport(selectedAdapter, raw, taskId || undefined);
      setPreview(res);
      setImportResult(null);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const doImport = async () => {
    if (!selectedAdapter || !raw.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.importTrajectory(selectedAdapter, raw, taskId || undefined);
      setImportResult(res);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadExample = () => {
    if (activeAdapter?.example_snippet) {
      setRaw(activeAdapter.example_snippet);
      setPreview(null);
      setImportResult(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">轨迹导入</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          导入 Claude Code / Codex / MCP / 通用格式的 Agent 运行日志，接入污点追踪、调用图、形式化验证等分析引擎
        </p>
      </div>

      {/* Adapter selector */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {adapters.map((a) => (
          <button
            key={a.adapter_id}
            onClick={() => { setSelectedAdapter(a.adapter_id); setPreview(null); setImportResult(null); }}
            className={[
              "rounded-xl border p-4 text-left transition-all",
              selectedAdapter === a.adapter_id
                ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-200"
                : "border-slate-200 bg-white hover:border-slate-300",
            ].join(" ")}
          >
            <div className="text-[13px] font-semibold text-slate-900">{a.name}</div>
            <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{a.description}</p>
            <div className="flex gap-1 mt-2">
              {a.supported_formats.map((f) => (
                <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{f}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">日志输入</h2>
          <div className="flex items-center gap-2">
            <button onClick={handleLoadExample} className="text-[11px] text-blue-600 hover:text-blue-700">
              加载示例
            </button>
            <input ref={fileRef} type="file" accept=".json,.jsonl,.yaml,.yml,.txt" className="hidden" onChange={handleFileUpload} />
            <button
              onClick={() => fileRef.current?.click()}
              className="text-[11px] px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              上传文件
            </button>
          </div>
        </div>

        <textarea
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setPreview(null); setImportResult(null); }}
          rows={12}
          placeholder={activeAdapter ? `粘贴 ${activeAdapter.name} 格式的日志内容...` : "选择适配器后粘贴日志..."}
          className="w-full rounded-lg border border-slate-200 p-3 text-xs font-mono text-slate-700 resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
        />

        <div className="flex items-center gap-3">
          <input
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            placeholder="Task ID（可选，留空自动生成）"
            className="border rounded px-2 py-1.5 text-xs text-slate-700 w-64"
          />
          <div className="flex-1" />
          <button
            onClick={doPreview}
            disabled={!raw.trim() || loading}
            className="text-xs px-4 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            预览
          </button>
          <button
            onClick={doImport}
            disabled={!raw.trim() || loading}
            className="text-xs px-4 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {loading ? "处理中…" : "导入"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      )}

      {/* Preview */}
      {preview && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">预览结果</h2>

          {preview.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 space-y-1">
              {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {preview.trajectories.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">未解析出任何轨迹，请检查格式</p>
          ) : (
            preview.trajectories.map((t, ti) => (
              <div key={ti} className="rounded-lg border border-slate-100 p-4 space-y-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-medium text-slate-800">{t.task_id}</span>
                  <span className="text-slate-400">{t.step_count} 步</span>
                  <span className="text-slate-400">工具: {t.tools_used.join(", ")}</span>
                </div>
                <div className="space-y-1">
                  {t.first_steps.map((s) => (
                    <div key={s.step_k} className="flex items-start gap-2 text-[11px]">
                      <span className="text-slate-300 w-5 shrink-0 text-right">{s.step_k}</span>
                      <span className="font-mono text-blue-600 bg-blue-50 px-1 rounded shrink-0">{s.tool}</span>
                      {s.has_reasoning && <span className="text-purple-400 shrink-0">CoT</span>}
                      <span className="text-slate-400 truncate">{s.observation_preview}</span>
                    </div>
                  ))}
                  {t.step_count > 5 && (
                    <div className="text-[10px] text-slate-300 pl-7">…还有 {t.step_count - 5} 步</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-emerald-800">
            导入成功 — {importResult.imported} 条轨迹
          </h2>

          {importResult.warnings.length > 0 && (
            <div className="text-xs text-amber-700 space-y-0.5">
              {importResult.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {importResult.run_ids.map((rid) => (
              <span key={rid} className="text-xs font-mono bg-white border border-emerald-200 px-2 py-1 rounded text-emerald-700">
                {rid}
              </span>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => navigate("/tool-call-graph")}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-white"
            >
              查看调用图
            </button>
            <button
              onClick={() => navigate("/taint")}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-white"
            >
              污点追踪
            </button>
            <button
              onClick={() => navigate("/formal-verification")}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-white"
            >
              形式化验证
            </button>
            <button
              onClick={() => navigate("/deep-analysis")}
              className="text-xs px-3 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700"
            >
              三层联动分析
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
