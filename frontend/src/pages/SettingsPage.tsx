import { useState, useEffect, useRef } from "react";
import {
  loadProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  maskKey,
  type LLMProfile,
} from "../lib/settings";
import { api } from "../lib/api";

// ── API Key field with copy + preview ─────────────────────────────────────

function ApiKeyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-24 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
          autoComplete="off"
        />
        <div className="absolute right-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100"
          >
            {show ? "隐藏" : "显示"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!value}
            className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 disabled:opacity-30"
          >
            {copied ? "✓" : "复制"}
          </button>
        </div>
      </div>
      {/* 首尾预览 */}
      {value && !show && (
        <p className="text-xs text-gray-400 font-mono">
          已填写：
          <span className="bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">
            {maskKey(value)}
          </span>
        </p>
      )}
    </div>
  );
}

// ── Connection test badge ─────────────────────────────────────────────────

type TestState = "idle" | "testing" | "ok" | "fail";

function TestBadge({
  profile,
  onOverrideKey,
}: {
  profile: LLMProfile;
  onOverrideKey?: string;
}) {
  const [state, setState] = useState<TestState>("idle");
  const [detail, setDetail] = useState("");

  const run = async () => {
    setState("testing");
    setDetail("");
    try {
      const res = await api.testConnection({
        api_key: onOverrideKey || profile.apiKey || undefined,
        base_url: profile.baseUrl || undefined,
        model: profile.model || undefined,
      });
      if (res.ok) {
        setState("ok");
        setDetail(`${res.model} · ${res.latency_ms}ms · "${res.reply}"`);
      } else {
        setState("fail");
        setDetail(res.error ?? "未知错误");
      }
    } catch (e: unknown) {
      setState("fail");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={run}
        disabled={state === "testing"}
        className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
      >
        {state === "testing" ? (
          <>
            <span className="animate-spin inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full" />
            测试中…
          </>
        ) : "🔌 连通性测试"}
      </button>

      {state === "ok" && (
        <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg">
          ✓ 连接成功 — {detail}
        </span>
      )}
      {state === "fail" && (
        <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-lg max-w-xs truncate" title={detail}>
          ✗ {detail}
        </span>
      )}
    </div>
  );
}

// ── Single profile editor ─────────────────────────────────────────────────

function ProfileEditor({
  profile,
  onSave,
  onCancel,
}: {
  profile: Partial<LLMProfile>;
  onSave: (p: Omit<LLMProfile, "id" | "isActive">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile.name ?? "");
  const [apiKey, setApiKey] = useState(profile.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl ?? "");
  const [model, setModel] = useState(profile.model ?? "gpt-4o-mini");

  return (
    <div className="space-y-4 pt-2">
      {/* Name */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">配置名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：OpenAI GPT-4o、本地 Qwen"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">API Key</label>
        <ApiKeyField value={apiKey} onChange={setApiKey} />
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">
          Base URL <span className="font-normal text-gray-400">（可选）</span>
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[
            { label: "OpenAI", url: "https://api.openai.com/v1" },
            { label: "vLLM :8000", url: "http://localhost:8000/v1" },
            { label: "Ollama", url: "http://localhost:11434/v1" },
          ].map((p) => (
            <button
              key={p.url}
              type="button"
              onClick={() => setBaseUrl(p.url)}
              className="text-[11px] border border-gray-200 rounded px-2 py-0.5 text-gray-500 hover:bg-gray-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">模型</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o-mini"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {["gpt-4o-mini", "gpt-4o", "gpt-4.1", "qwen2.5-72b-instruct", "deepseek-chat"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModel(m)}
              className="text-[11px] border border-gray-200 rounded px-2 py-0.5 text-gray-500 hover:bg-gray-50 font-mono"
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Test connection (inline, with current form values) */}
      <div className="pt-1">
        <TestBadge
          profile={{ id: "", name, apiKey, baseUrl, model, isActive: false }}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSave({ name: name || model, apiKey, baseUrl, model })}
          className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 rounded-lg text-sm"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ── Profile card (read mode) ──────────────────────────────────────────────

function ProfileCard({
  profile,
  onActivate,
  onEdit,
  onDelete,
}: {
  profile: LLMProfile;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        profile.isActive
          ? "border-slate-400 bg-slate-50 shadow-sm"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onActivate}
            className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${
              profile.isActive ? "border-slate-700 bg-slate-700" : "border-gray-300"
            }`}
            title="设为默认"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{profile.name}</p>
            <p className="text-xs font-mono text-gray-400 truncate">{profile.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {profile.isActive && (
            <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-semibold">
              默认
            </span>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50"
          >
            删除
          </button>
        </div>
      </div>

      {/* Key + URL info */}
      <div className="mt-2 grid grid-cols-2 gap-x-3 text-xs text-gray-500">
        <div>
          <span className="text-gray-400">Key：</span>
          <span className="font-mono">{profile.apiKey ? maskKey(profile.apiKey) : "—"}</span>
        </div>
        <div className="truncate">
          <span className="text-gray-400">URL：</span>
          <span className="font-mono truncate">
            {profile.baseUrl ? profile.baseUrl.replace("https://", "").replace("http://", "") : "api.openai.com/v1"}
          </span>
        </div>
      </div>

      {/* Inline test */}
      <div className="mt-3">
        <TestBadge profile={profile} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

type EditingState =
  | { mode: "none" }
  | { mode: "add" }
  | { mode: "edit"; profile: LLMProfile };

async function syncActiveProfileToBackend(profiles: LLMProfile[]) {
  const active = profiles.find((p) => p.isActive) ?? profiles[0];
  if (!active) return;
  await api.updateSettings({
    api_key: active.apiKey,
    base_url: active.baseUrl,
    model: active.model,
  });
}

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<LLMProfile[]>([]);
  const [editing, setEditing] = useState<EditingState>({ mode: "none" });
  const [backendStatus, setBackendStatus] = useState<"idle" | "syncing" | "ok" | "err">("idle");
  const [backendInfo, setBackendInfo] = useState<{ api_key_masked: string; api_key_set: boolean; base_url: string; model: string } | null>(null);

  useEffect(() => {
    setProfiles(loadProfiles());
    api.getSettings().then(setBackendInfo).catch(() => {});
  }, []);

  const refresh = () => setProfiles(loadProfiles());

  const pushToBackend = async (updated: LLMProfile[]) => {
    setBackendStatus("syncing");
    try {
      const res = await syncActiveProfileToBackend(updated);
      void res;
      const info = await api.getSettings();
      setBackendInfo(info);
      setBackendStatus("ok");
    } catch {
      setBackendStatus("err");
    }
    setTimeout(() => setBackendStatus("idle"), 3000);
  };

  const handleActivate = (id: string) => {
    setActiveProfile(id);
    const next = loadProfiles().map((p) => ({ ...p, isActive: p.id === id }));
    setProfiles(next);
    pushToBackend(next);
  };

  const handleDelete = (id: string) => {
    deleteProfile(id);
    refresh();
  };

  const handleSaveNew = (p: Omit<LLMProfile, "id" | "isActive">) => {
    const isFirst = profiles.length === 0;
    addProfile({ ...p, isActive: isFirst });
    const next = loadProfiles();
    setProfiles(next);
    setEditing({ mode: "none" });
    if (isFirst) pushToBackend(next);
  };

  const handleSaveEdit = (orig: LLMProfile, p: Omit<LLMProfile, "id" | "isActive">) => {
    updateProfile({ ...orig, ...p });
    const next = loadProfiles();
    setProfiles(next);
    setEditing({ mode: "none" });
    if (orig.isActive) pushToBackend(next);
  };

  return (
    <div className="px-8 py-7 max-w-2xl mx-auto">
        <h1 className="text-[15px] font-semibold text-slate-900 mb-0.5">LLM 配置</h1>
        <p className="text-[12px] text-slate-400 mb-6">
          支持配置多个 LLM 接入点，单选"默认"后评测自动使用该配置。设为默认时自动同步至后端，评测运行无需再填写 API Key。
        </p>

        {/* Backend sync status */}
        <div className="mb-4 flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-600">
          <span className="text-slate-400">后端状态：</span>
          {backendStatus === "syncing" && <span className="text-blue-500">同步中…</span>}
          {backendStatus === "ok" && <span className="text-green-600">✓ 已同步</span>}
          {backendStatus === "err" && <span className="text-red-500">同步失败</span>}
          {backendStatus === "idle" && backendInfo && (
            backendInfo.api_key_set
              ? <span className="text-green-600">✓ 已配置 · <span className="font-mono">{backendInfo.api_key_masked}</span> · {backendInfo.model}</span>
              : <span className="text-amber-500">⚠ 后端未配置 API Key</span>
          )}
          {backendStatus === "idle" && !backendInfo && <span className="text-slate-400">—</span>}
        </div>

        {/* Profile list */}
        <div className="space-y-3 mb-4">
          {profiles.length === 0 && editing.mode === "none" && (
            <div className="text-center text-gray-400 text-sm py-8 bg-white border border-dashed border-gray-300 rounded-xl">
              还没有配置，点击"新增配置"开始。
            </div>
          )}

          {profiles.map((p) =>
            editing.mode === "edit" && editing.profile.id === p.id ? (
              <div key={p.id} className="bg-white border border-rose-300 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-600 mb-1">编辑：{p.name}</p>
                <ProfileEditor
                  profile={p}
                  onSave={(updated) => handleSaveEdit(p, updated)}
                  onCancel={() => setEditing({ mode: "none" })}
                />
              </div>
            ) : (
              <ProfileCard
                key={p.id}
                profile={p}
                onActivate={() => handleActivate(p.id)}
                onEdit={() => setEditing({ mode: "edit", profile: p })}
                onDelete={() => handleDelete(p.id)}
              />
            )
          )}

          {/* Add form */}
          {editing.mode === "add" && (
            <div className="bg-white border border-rose-300 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-600 mb-1">新增配置</p>
              <ProfileEditor
                profile={{}}
                onSave={handleSaveNew}
                onCancel={() => setEditing({ mode: "none" })}
              />
            </div>
          )}
        </div>

        {editing.mode === "none" && (
          <button
            onClick={() => setEditing({ mode: "add" })}
            className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-rose-400 hover:text-rose-600 transition-colors"
          >
            + 新增配置
          </button>
        )}

        {/* Priority note */}
        <div className="mt-6 border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-1.5">
          <p className="font-semibold">配置优先级</p>
          <p>① 后端配置文件（通过本页面同步）→ ② 环境变量 → ③ 评测表单手填</p>
          <pre className="font-mono leading-5 bg-slate-50 p-2 rounded mt-1">
{`# 备用：手动设置环境变量
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1
export DEFAULT_MODEL=gpt-4o-mini`}
          </pre>
        </div>
    </div>
  );
}
