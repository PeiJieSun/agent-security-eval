/**
 * ToolCallGraphPage — M2-3: Tool Call Graph
 * Visualizes tool transition patterns across all evaluated agent trajectories.
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ToolFlowGraph from "../components/ToolFlowGraph";

interface GraphNode {
  id: string;
  count: number;
  is_high_risk: boolean;
  risk_reason?: string;
}

interface GraphEdge {
  from_tool: string;
  to_tool: string;
  weight: number;
  transition_rate: number;
  taint_count?: number;
  has_taint_propagation?: boolean;
  example_taint_summary?: string;
}

interface HighRiskTool {
  name: string;
  reason: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  top_paths: string[][];
  risk_coverage: number;
  total_trajectories: number;
  unique_tools: number;
  high_risk_tools_found: HighRiskTool[];
  summary: string;
}

export default function ToolCallGraphPage() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"visual" | "edges" | "paths" | "nodes">("visual");
  const [includeTaint, setIncludeTaint] = useState(false);

  const load = () => {
    setLoading(true);
    const url = `/api/v1/agent-eval/tool-call-graph${includeTaint ? "?include_taint=true" : ""}`;
    fetch(url).then(r => r.json())
      .then(setGraph)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [includeTaint]);

  return (
    <div className="px-8 py-7 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold text-slate-900">工具调用图</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">M2-3 · 从轨迹库提取工具转移模式，发现高风险攻击路径</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={includeTaint} onChange={(e) => { setIncludeTaint(e.target.checked); }}
              className="rounded border-slate-300" />
            叠加污点标注
          </label>
          <button
            onClick={load}
            className="text-slate-400 hover:text-slate-600 text-sm w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100"
            title="重新计算"
          >↻</button>
        </div>
      </div>

      {/* Theory */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 border-l-4 border-l-slate-400">
        <p className="text-xs font-semibold text-slate-700 mb-1">原理</p>
        <p className="text-xs text-slate-500 leading-relaxed">
          从所有历史轨迹中提取工具调用序列，构建有向加权图（节点 = 工具，边 = 调用转移，权重 = 频率）。
          高权重路径（如 get_emails → send_email）代表高频攻击面。对比已知高危工具计算覆盖率。
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          参考：AgentDojo §4 工具调用链安全分析 · "Not What You've Signed Up For" Perez & Ribeiro, 2022
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <div className="animate-spin w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full" />
          计算中…
        </div>
      )}

      {error && (
        <div className="border border-slate-200 rounded-lg p-4 text-sm text-slate-600 border-l-4 border-l-red-400">
          {error}
        </div>
      )}

      {graph && !loading && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "轨迹数", value: graph.total_trajectories },
              { label: "工具种类", value: graph.unique_tools },
              { label: "转移边数", value: graph.edges.length },
              { label: "高危覆盖率", value: `${(graph.risk_coverage * 100).toFixed(0)}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">{s.label}</p>
                <p className="text-xl font-bold text-slate-800 tabular-nums mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Summary */}
          <p className="text-xs text-slate-500">{graph.summary}</p>

          {/* High-risk tools found */}
          {graph.high_risk_tools_found.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/30 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400 mb-3">
                已发现高危工具调用
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {graph.high_risk_tools_found.map((t) => (
                  <div key={t.name} className="flex flex-col p-2 bg-white rounded border border-red-100">
                    <span className="text-[11px] text-red-700 font-mono font-bold mb-1">
                      {t.name}
                    </span>
                    <span className="text-[10px] text-slate-500 leading-snug">
                      {t.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div>
            <div className="flex gap-2 border-b border-slate-200 mb-5">
              {(["visual", "edges", "paths", "nodes"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${
                    activeTab === tab
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab === "visual" ? "可视化图" : tab === "edges" ? "转移边" : tab === "paths" ? "TopK 路径" : "节点"}
                </button>
              ))}
            </div>

            {/* Visual tab */}
            {activeTab === "visual" && (
              <ToolFlowGraph nodesData={graph.nodes} edgesData={graph.edges} />
            )}

            {/* Edges tab */}
            {activeTab === "edges" && (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-6 py-3 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  <span>来源工具</span><span>目标工具</span><span className="text-right w-12">频次</span><span className="text-right w-16">转移率</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {graph.edges.slice(0, 30).map((e, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-6 py-3.5 text-[13px] hover:bg-slate-50 transition-colors items-center"
                    >
                      <div className="flex items-center">
                        <span className={`font-mono font-medium px-2.5 py-1 rounded-md border shadow-sm ${
                          graph.high_risk_tools_found.some(t => t.name === e.from_tool) 
                            ? "bg-red-50 text-red-700 border-red-200" 
                            : "bg-white text-slate-900 border-slate-200"
                        }`}>
                          {e.from_tool}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <span className={`font-mono font-medium px-2.5 py-1 rounded-md border shadow-sm ${
                          graph.high_risk_tools_found.some(t => t.name === e.to_tool) 
                            ? "bg-red-50 text-red-700 border-red-200" 
                            : "bg-white text-slate-900 border-slate-200"
                        }`}>
                          {e.to_tool}
                        </span>
                      </div>
                      <span className="text-slate-900 font-semibold tabular-nums text-right w-12">{e.weight}</span>
                      <span className="text-slate-500 font-medium tabular-nums text-right w-16">{(e.transition_rate * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Paths tab */}
            {activeTab === "paths" && (
              <div className="space-y-3">
                {graph.top_paths.length === 0 ? (
                  <p className="text-[13px] text-slate-500 text-center py-10 bg-white rounded-xl border border-slate-200 shadow-sm">暂无路径数据（需要更多轨迹）</p>
                ) : graph.top_paths.map((path, i) => (
                  <div key={i} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-slate-300 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-xs shrink-0 shadow-inner border border-slate-200/50">
                      #{i + 1}
                    </div>
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-2">
                      {path.map((tool, j) => (
                        <div key={j} className="flex items-center">
                          <span className={`text-[12px] px-2.5 py-1 rounded-md font-mono font-medium border shadow-sm ${
                            graph.high_risk_tools_found.some(hrt => hrt.name === tool)
                              ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-white text-slate-900 border-slate-200"
                          }`}>{tool}</span>
                          {j < path.length - 1 && (
                            <svg className="w-3.5 h-3.5 mx-1.5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Nodes tab */}
            {activeTab === "nodes" && (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-6 py-3 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  <span>工具名称</span><span className="text-right w-16">调用次数</span><span className="text-center w-16">风险级别</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {graph.nodes.map((n, i) => (
                    <div
                      key={n.id}
                      className="grid grid-cols-[1fr_auto_auto] gap-4 px-6 py-3.5 text-[13px] hover:bg-slate-50 transition-colors items-center"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-mono font-medium px-2.5 py-1 rounded-md border shadow-sm ${
                          n.is_high_risk 
                            ? "bg-red-50 text-red-700 border-red-200" 
                            : "bg-white text-slate-900 border-slate-200"
                        }`}>
                          {n.id}
                        </span>
                        {n.is_high_risk && n.risk_reason && (
                          <span className="text-[12px] text-slate-500 truncate max-w-sm hidden sm:block" title={n.risk_reason}>
                            — {n.risk_reason}
                          </span>
                        )}
                      </div>
                      <span className="text-slate-900 font-semibold tabular-nums text-right w-16">{n.count}</span>
                      <div className="w-16 flex justify-center">
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-md border shadow-sm ${
                          n.is_high_risk ? "bg-red-50 text-red-700 border-red-200" : "bg-white text-slate-500 border-slate-200"
                        }`}>
                          {n.is_high_risk ? "高危" : "普通"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {graph && graph.total_trajectories === 0 && !loading && (
        <div className="text-center py-10 text-slate-400 text-sm">
          暂无轨迹数据。请先在「评测列表」中运行至少一次评测。
        </div>
      )}
    </div>
  );
}
