import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { loadSettings, saveSettings, type LLMSettings } from "../lib/settings";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<LLMSettings>({ apiKey: "", baseUrl: "", model: "gpt-4o-mini" });
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setForm(loadSettings());
  }, []);

  const handleSave = () => {
    saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    const empty: LLMSettings = { apiKey: "", baseUrl: "", model: "gpt-4o-mini" };
    setForm(empty);
    saveSettings(empty);
  };

  const masked = form.apiKey
    ? form.apiKey.slice(0, 7) + "…" + form.apiKey.slice(-4)
    : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-8">
        <button onClick={() => navigate("/")} className="text-sm text-gray-400 hover:text-gray-600">
          ← 返回主页
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">LLM 配置</h1>
        <p className="text-sm text-gray-500 mb-6">
          配置将保存在浏览器本地（localStorage），不会上传至服务器。
          支持任意 OpenAI 兼容接口（OpenAI、vLLM、本地 Ollama 等）。
        </p>

        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
          {/* API Key */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-16 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
            {masked && (
              <p className="text-xs text-gray-400 mt-1">当前：{masked}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              也可通过服务端环境变量 <code className="bg-gray-100 px-1 rounded">OPENAI_API_KEY</code> 配置，
              表单留空时使用服务端配置。
            </p>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Base URL
              <span className="font-normal text-gray-400 ml-1">（可选，默认 OpenAI）</span>
            </label>
            <input
              type="text"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { label: "OpenAI 官方", url: "https://api.openai.com/v1" },
                { label: "本地 vLLM :8000", url: "http://localhost:8000/v1" },
                { label: "本地 Ollama", url: "http://localhost:11434/v1" },
              ].map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => setForm({ ...form, baseUrl: preset.url })}
                  className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-500 hover:bg-gray-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              默认模型
            </label>
            <input
              type="text"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="gpt-4o-mini"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {["gpt-4o-mini", "gpt-4o", "gpt-4.1", "qwen2.5-72b-instruct"].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, model: m })}
                  className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-500 hover:bg-gray-50 font-mono"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {saved ? "✓ 已保存" : "保存配置"}
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50"
            >
              清除
            </button>
          </div>
        </div>

        {/* Env var note */}
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700">
          <p className="font-semibold mb-1">服务端环境变量配置（永久生效）</p>
          <pre className="font-mono leading-5">
{`export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1
export DEFAULT_MODEL=gpt-4o-mini`}
          </pre>
          <p className="mt-1 text-blue-600">
            服务端配置优先级低于表单传入的 api_key。
          </p>
        </div>
      </div>
    </div>
  );
}
