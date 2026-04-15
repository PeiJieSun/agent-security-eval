import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = "/api/v1/agent-eval/mcp-proxy";

interface SessionStatus {
  session_id: string;
  status: string;
  tool_calls: number;
  injections: number;
  trajectory_steps: number;
  tools_discovered: number;
}

interface InjectionRule {
  tool_name: string;
  payload: string;
  inject_on_call: number;
  prepend: boolean;
}

interface ConfigSnippet {
  title: string;
  description: string;
  config: Record<string, any>;
  instructions: string[];
}

export default function MCPProxyPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<SessionStatus | null>(null);

  // create form
  const [injRules, setInjRules] = useState<InjectionRule[]>([]);
  const [newRule, setNewRule] = useState({ tool_name: "", payload: "", inject_on_call: 1 });

  // simulate
  const [simTool, setSimTool] = useState("");
  const [simArgs, setSimArgs] = useState("{}");
  const [simResponse, setSimResponse] = useState<any>(null);

  // config snippet
  const [snippet, setSnippet] = useState<ConfigSnippet | null>(null);
  const [snippetAgent, setSnippetAgent] = useState("claude_code");

  const refreshSessions = useCallback(async () => {
    const res = await fetch(`${API}/sessions`);
    setSessions(await res.json());
  }, []);

  const refreshActive = useCallback(async () => {
    if (!activeSession) return;
    const res = await fetch(`${API}/sessions/${activeSession}`);
    if (res.ok) setActiveStatus(await res.json());
  }, [activeSession]);

  useEffect(() => { refreshSessions(); }, [refreshSessions]);
  useEffect(() => { if (activeSession) refreshActive(); }, [activeSession, refreshActive]);

  const createSession = async () => {
    const res = await fetch(`${API}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transport: "simulated", injection_rules: injRules }),
    });
    const data = await res.json();
    setActiveSession(data.session_id);
    setActiveStatus(data);
    refreshSessions();
  };

  const stopSession = async () => {
    if (!activeSession) return;
    const res = await fetch(`${API}/sessions/${activeSession}/stop`, { method: "POST" });
    const data = await res.json();
    setActiveStatus(data);
    refreshSessions();
  };

  const simulateCall = async () => {
    if (!activeSession || !simTool) return;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(simArgs); } catch { /* keep empty */ }
    const res = await fetch(`${API}/sessions/${activeSession}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_name: simTool, arguments: args }),
    });
    setSimResponse(await res.json());
    refreshActive();
  };

  const loadSnippet = async () => {
    const res = await fetch(`${API}/agent-config-snippet?agent_type=${snippetAgent}`);
    setSnippet(await res.json());
  };

  const addRule = () => {
    if (!newRule.tool_name || !newRule.payload) return;
    setInjRules([...injRules, { ...newRule, prepend: false }]);
    setNewRule({ tool_name: "", payload: "", inject_on_call: 1 });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">MCP 安全代理</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          透明插入 Agent 与 MCP Server 之间，实时记录工具调用、注入攻击载荷、构建分析轨迹
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Session Management */}
        <div className="space-y-4">
          {/* Create Session */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">创建代理会话</h2>

            {/* Injection rules */}
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500 font-medium">注入规则（可选）</p>
              {injRules.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] bg-red-50 border border-red-100 rounded px-2 py-1">
                  <span className="font-mono text-red-700">{r.tool_name}</span>
                  <span className="text-red-400">第{r.inject_on_call}次</span>
                  <span className="text-red-500 truncate flex-1">{r.payload.slice(0, 40)}...</span>
                  <button onClick={() => setInjRules(injRules.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">x</button>
                </div>
              ))}
              <div className="grid grid-cols-3 gap-2">
                <input value={newRule.tool_name} onChange={e => setNewRule({ ...newRule, tool_name: e.target.value })}
                  placeholder="工具名 (*=全部)" className="border rounded px-2 py-1 text-[11px] text-slate-700" />
                <input value={newRule.payload} onChange={e => setNewRule({ ...newRule, payload: e.target.value })}
                  placeholder="注入载荷文本" className="border rounded px-2 py-1 text-[11px] text-slate-700" />
                <div className="flex gap-1">
                  <input type="number" value={newRule.inject_on_call} min={0}
                    onChange={e => setNewRule({ ...newRule, inject_on_call: Number(e.target.value) })}
                    className="border rounded px-2 py-1 text-[11px] text-slate-700 w-14" title="第N次注入(0=每次)" />
                  <button onClick={addRule} className="text-[11px] px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">+</button>
                </div>
              </div>
            </div>

            <button onClick={createSession}
              className="text-xs px-4 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700 w-full">
              创建模拟会话
            </button>
          </div>

          {/* Session list */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <h2 className="text-sm font-semibold text-slate-800">会话列表</h2>
            {sessions.length === 0 && <p className="text-xs text-slate-400 py-3 text-center">暂无会话</p>}
            {sessions.map((s) => (
              <button key={s.session_id}
                onClick={() => { setActiveSession(s.session_id); setActiveStatus(s); }}
                className={[
                  "w-full text-left rounded-lg border p-3 transition-all text-xs",
                  activeSession === s.session_id ? "border-blue-300 bg-blue-50/50" : "border-slate-100 hover:border-slate-200",
                ].join(" ")}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-slate-700">{s.session_id}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    s.status === "running" ? "bg-emerald-100 text-emerald-700" :
                    s.status === "stopped" ? "bg-slate-100 text-slate-500" :
                    "bg-red-100 text-red-600"
                  }`}>{s.status}</span>
                </div>
                <div className="flex gap-3 mt-1 text-slate-400">
                  <span>{s.tool_calls} 调用</span>
                  <span>{s.injections} 注入</span>
                  <span>{s.trajectory_steps} 步</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Active session */}
        <div className="space-y-4">
          {activeStatus ? (
            <>
              {/* Status */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800">{activeStatus.session_id}</h2>
                  {activeStatus.status === "running" && (
                    <button onClick={stopSession} className="text-xs px-3 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">停止</button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "工具调用", value: activeStatus.tool_calls, color: "text-blue-600" },
                    { label: "注入次数", value: activeStatus.injections, color: "text-red-600" },
                    { label: "轨迹步数", value: activeStatus.trajectory_steps, color: "text-slate-700" },
                    { label: "已发现工具", value: activeStatus.tools_discovered, color: "text-emerald-600" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="text-center">
                      <div className={`text-lg font-bold ${color}`}>{value}</div>
                      <div className="text-[10px] text-slate-400">{label}</div>
                    </div>
                  ))}
                </div>

                {activeStatus.status === "stopped" && activeStatus.trajectory_steps > 0 && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => navigate("/analysis/tool-graph")}
                      className="text-[11px] px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">调用图</button>
                    <button onClick={() => navigate("/taint-analysis")}
                      className="text-[11px] px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">污点追踪</button>
                    <button onClick={() => navigate("/deep-analysis")}
                      className="text-[11px] px-3 py-1 rounded bg-slate-800 text-white hover:bg-slate-700">三层分析</button>
                  </div>
                )}
              </div>

              {/* Simulate tool call */}
              {activeStatus.status === "running" && (
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-slate-800">模拟工具调用</h2>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={simTool} onChange={e => setSimTool(e.target.value)}
                      placeholder="tool_name (如 read_file)" className="border rounded px-2 py-1.5 text-xs text-slate-700" />
                    <input value={simArgs} onChange={e => setSimArgs(e.target.value)}
                      placeholder='{"path":"foo.py"}' className="border rounded px-2 py-1.5 text-xs text-slate-700 font-mono" />
                  </div>
                  <button onClick={simulateCall} disabled={!simTool}
                    className="text-xs px-4 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                    发送
                  </button>
                  {simResponse && (
                    <pre className="mt-2 rounded border p-3 text-[11px] text-slate-600 font-mono bg-slate-50 overflow-auto max-h-40">
                      {JSON.stringify(simResponse, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-400">
              创建或选择一个会话开始
            </div>
          )}

          {/* Config snippet generator */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Agent 接入配置</h2>
            <div className="flex gap-2">
              {["claude_code", "codex", "generic"].map((t) => (
                <button key={t} onClick={() => { setSnippetAgent(t); setSnippet(null); }}
                  className={`text-[11px] px-3 py-1 rounded border ${snippetAgent === t ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                  {t === "claude_code" ? "Claude Code" : t === "codex" ? "Codex" : "通用 MCP"}
                </button>
              ))}
              <button onClick={loadSnippet} className="text-[11px] px-3 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 ml-auto">
                生成
              </button>
            </div>
            {snippet && (
              <div className="space-y-2">
                <p className="text-xs text-slate-600 font-medium">{snippet.title}</p>
                <p className="text-[11px] text-slate-400">{snippet.description}</p>
                <pre className="rounded border bg-slate-50 p-3 text-[11px] font-mono text-slate-700 overflow-auto">
                  {JSON.stringify(snippet.config, null, 2)}
                </pre>
                <ol className="text-[11px] text-slate-500 space-y-0.5 list-decimal list-inside">
                  {snippet.instructions.map((inst, i) => <li key={i}>{inst}</li>)}
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
