import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  Position,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { PageHeader } from "../components/AppShell";

// ── Types ──────────────────────────────────────────────────────────────────

interface TraceSummary {
  trace_id: string;
  task_id: string;
  sources: number;
  sinks: number;
  links: number;
  attack_chains: number;
  taint_coverage: number;
  max_chain_length: number;
}

interface TaintSource {
  source_id: string;
  step_k: number;
  tool_name: string;
  field_path: string;
  tainted_text: string;
  is_injected: boolean;
  trust_level: number;
}

interface TaintPropagation {
  prop_id: string;
  source_id: string;
  step_k: number;
  mechanism: string;
  evidence: string;
  similarity_score: number;
  confidence: string;
}

interface TaintSink {
  sink_id: string;
  step_k: number;
  tool_name: string;
  argument_name: string;
  argument_value: string;
  is_high_risk: boolean;
  risk_reason: string;
}

interface TaintLink {
  link_id: string;
  source: TaintSource;
  propagations: TaintPropagation[];
  sink: TaintSink;
  overall_confidence: number;
  attack_confirmed: boolean;
  summary: string;
}

interface TaintTrace {
  trace_id: string;
  task_id: string;
  sources: TaintSource[];
  propagations: TaintPropagation[];
  sinks: TaintSink[];
  links: TaintLink[];
  taint_coverage: number;
  max_chain_length: number;
  attack_chains: number;
}

interface TaintStats {
  total_traces: number;
  total_sources: number;
  total_sinks: number;
  total_links: number;
  total_attack_chains: number;
  avg_taint_coverage: number;
  avg_confidence: number;
  propagation_mechanisms?: Record<string, number>;
  top_source_tools?: Record<string, number>;
  top_sink_tools?: Record<string, number>;
}

// ── Dagre Layout ───────────────────────────────────────────────────────────

const NODE_W = 170;
const NODE_H = 52;

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  const laid = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    };
  });
  return { nodes: laid, edges };
}

// ── Flow Diagram ───────────────────────────────────────────────────────────

function TaintFlowDiagram({
  trace,
  onSelectLink,
}: {
  trace: TaintTrace;
  onSelectLink: (link: TaintLink | null) => void;
}) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodeMap = new Map<string, Node>();
    const edgeList: Edge[] = [];

    trace.links.forEach((link) => {
      const srcId = link.source.source_id;
      if (!nodeMap.has(srcId)) {
        nodeMap.set(srcId, {
          id: srcId,
          position: { x: 0, y: 0 },
          data: {
            label: (
              <div className="flex flex-col justify-center h-full px-2">
                <div className="font-mono text-[10px] font-bold text-amber-800 truncate">
                  {link.source.tool_name}()
                </div>
                <div className="text-[9px] text-amber-600 truncate">
                  Step {link.source.step_k} · {link.source.field_path}
                </div>
              </div>
            ),
          },
          style: {
            width: NODE_W,
            height: NODE_H,
            background: link.source.is_injected ? "#fef2f2" : "#fffbeb",
            border: `1.5px solid ${link.source.is_injected ? "#f87171" : "#f59e0b"}`,
            borderRadius: "8px",
            padding: 0,
          },
        });
      }

      link.propagations.forEach((p) => {
        const pid = p.prop_id;
        if (!nodeMap.has(pid)) {
          nodeMap.set(pid, {
            id: pid,
            position: { x: 0, y: 0 },
            data: {
              label: (
                <div className="flex flex-col justify-center h-full px-2">
                  <div className="font-mono text-[10px] font-bold text-blue-800 truncate">
                    CoT Step {p.step_k}
                  </div>
                  <div className="text-[9px] text-blue-500 truncate">{p.mechanism}</div>
                </div>
              ),
            },
            style: {
              width: NODE_W,
              height: NODE_H,
              background: "#eff6ff",
              border: "1.5px solid #60a5fa",
              borderRadius: "8px",
              padding: 0,
            },
          });
        }
        edgeList.push({
          id: `${srcId}-${pid}`,
          source: srcId,
          target: pid,
          type: "smoothstep",
          animated: true,
          style: { strokeWidth: 2, stroke: "#93c5fd" },
          markerEnd: { type: "arrowclosed" as any, color: "#93c5fd" },
        });
      });

      const sinkId = link.sink.sink_id;
      if (!nodeMap.has(sinkId)) {
        const hr = link.sink.is_high_risk;
        nodeMap.set(sinkId, {
          id: sinkId,
          position: { x: 0, y: 0 },
          data: {
            label: (
              <div className="flex flex-col justify-center h-full px-2">
                <div
                  className={`font-mono text-[10px] font-bold truncate ${hr ? "text-red-800" : "text-emerald-800"}`}
                >
                  {link.sink.tool_name}() {hr && "⚠"}
                </div>
                <div className={`text-[9px] truncate ${hr ? "text-red-500" : "text-emerald-500"}`}>
                  Step {link.sink.step_k} · .{link.sink.argument_name}
                </div>
              </div>
            ),
          },
          style: {
            width: NODE_W,
            height: NODE_H,
            background: hr ? "#fef2f2" : "#f0fdf4",
            border: `1.5px solid ${hr ? "#f87171" : "#4ade80"}`,
            borderRadius: "8px",
            padding: 0,
            boxShadow: link.attack_confirmed
              ? "0 0 12px 2px rgba(239,68,68,0.35)"
              : undefined,
          },
        });
      }

      const lastNode =
        link.propagations.length > 0
          ? link.propagations[link.propagations.length - 1].prop_id
          : srcId;

      edgeList.push({
        id: `${lastNode}-${sinkId}-${link.link_id}`,
        source: lastNode,
        target: sinkId,
        type: "smoothstep",
        animated: true,
        label: `${(link.overall_confidence * 100).toFixed(0)}%`,
        labelStyle: { fill: link.attack_confirmed ? "#dc2626" : "#64748b", fontSize: 9, fontWeight: 700 },
        labelBgStyle: { fill: "#fff", fillOpacity: 0.9, rx: 3, ry: 3 },
        style: {
          strokeWidth: Math.max(1.5, link.overall_confidence * 5),
          stroke: link.attack_confirmed ? "#ef4444" : "#94a3b8",
        },
        markerEnd: {
          type: "arrowclosed" as any,
          color: link.attack_confirmed ? "#ef4444" : "#94a3b8",
        },
      });
    });

    return { initialNodes: Array.from(nodeMap.values()), initialEdges: edgeList };
  }, [trace]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (initialNodes.length === 0) return;
    const { nodes: ln, edges: le } = layoutGraph(initialNodes, initialEdges);
    setNodes(ln);
    setEdges(le);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: any, node: Node) => {
      const link = trace.links.find(
        (l) =>
          l.source.source_id === node.id ||
          l.sink.sink_id === node.id ||
          l.propagations.some((p) => p.prop_id === node.id),
      );
      onSelectLink(link ?? null);
    },
    [trace, onSelectLink],
  );

  if (initialNodes.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-slate-400 text-sm border border-slate-200 rounded-xl bg-white">
        该轨迹未检测到污点传播路径
      </div>
    );
  }

  return (
    <div className="h-[420px] w-full border border-slate-200 rounded-xl bg-white relative overflow-hidden shadow-sm">
      <style>{`.react-flow__handle { opacity: 0; }`}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.15}
        attributionPosition="bottom-right"
      >
        <Background color="#f1f5f9" gap={20} size={2} />
        <Controls showInteractive={false} className="bg-white border-slate-200 shadow-sm rounded-lg" />
      </ReactFlow>
    </div>
  );
}

// ── Confidence Badge ───────────────────────────────────────────────────────

function ConfBadge({ value }: { value: number }) {
  const pct = (value * 100).toFixed(0);
  const cls =
    value > 0.7
      ? "bg-red-100 text-red-700"
      : value > 0.4
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600";
  return <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${cls}`}>{pct}%</span>;
}

// ── Stats Card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${accent ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <div className={`text-[20px] font-bold tabular-nums ${accent ? "text-red-700" : "text-slate-800"}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

// ── Evidence Panel ─────────────────────────────────────────────────────────

function EvidencePanel({ link }: { link: TaintLink }) {
  return (
    <div className="border border-slate-200 rounded-xl bg-white p-4 space-y-3 text-[12px]">
      <h4 className="text-[13px] font-semibold text-slate-800">
        {link.attack_confirmed ? "⚠ 攻击链证据" : "污点路径证据"}
        <ConfBadge value={link.overall_confidence} />
      </h4>

      <div>
        <div className="text-[10px] font-semibold text-amber-700 mb-1">Source — {link.source.tool_name}() Step {link.source.step_k}</div>
        <pre className="bg-amber-50 border border-amber-200 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">
          {link.source.tainted_text}
        </pre>
      </div>

      {link.propagations.map((p) => (
        <div key={p.prop_id}>
          <div className="text-[10px] font-semibold text-blue-700 mb-1">
            Propagation — CoT Step {p.step_k} · {p.mechanism}
            <span className="ml-1 text-blue-500">({(p.similarity_score * 100).toFixed(0)}%)</span>
          </div>
          <pre className="bg-blue-50 border border-blue-200 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-all max-h-24 overflow-auto">
            {p.evidence}
          </pre>
        </div>
      ))}

      <div>
        <div className={`text-[10px] font-semibold mb-1 ${link.sink.is_high_risk ? "text-red-700" : "text-emerald-700"}`}>
          Sink — {link.sink.tool_name}(.{link.sink.argument_name}) Step {link.sink.step_k}
          {link.sink.is_high_risk && <span className="ml-1 text-red-500">HIGH RISK</span>}
        </div>
        <pre
          className={`rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-all max-h-24 overflow-auto border ${
            link.sink.is_high_risk ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"
          }`}
        >
          {link.sink.argument_value}
        </pre>
      </div>

      <p className="text-slate-500 text-[11px] italic">{link.summary}</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function TaintAnalysisPage() {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [stats, setStats] = useState<TaintStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<TaintTrace | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedLink, setSelectedLink] = useState<TaintLink | null>(null);

  useEffect(() => {
    fetch("/api/v1/agent-eval/taint/analyze-all")
      .then((r) => r.json())
      .then((d) => {
        setTraces(d.traces ?? []);
        setStats(d.stats ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadDetail = useCallback((taskId: string) => {
    setDetailLoading(true);
    setSelectedLink(null);
    fetch(`/api/v1/agent-eval/taint/trace/${encodeURIComponent(taskId)}`)
      .then((r) => r.json())
      .then((d: TaintTrace) => setDetail(d))
      .finally(() => setDetailLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Prompt Flow 污点追踪"
        subtitle="追踪不可信数据（Source）如何经由 LLM 推理链（Propagation）影响高危操作（Sink）— 基于子串匹配 + 语义相似度的灰盒污点分析"
        actions={
          detail && (
            <button
              onClick={() => { setDetail(null); setSelectedLink(null); }}
              className="text-[12px] px-3 py-1.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              ← 返回列表
            </button>
          )
        }
      />

      {/* Stats overview */}
      {stats && !detail && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="污点源" value={stats.total_sources} />
          <StatCard label="汇聚点" value={stats.total_sinks} />
          <StatCard label="污点路径" value={stats.total_links} />
          <StatCard label="攻击链" value={stats.total_attack_chains} accent={stats.total_attack_chains > 0} />
          <StatCard label="平均置信度" value={`${(stats.avg_confidence * 100).toFixed(1)}%`} />
        </div>
      )}

      {/* Trace list */}
      {!detail && (
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-left">
                <th className="px-4 py-2 font-medium">Task ID</th>
                <th className="px-3 py-2 font-medium text-center">Sources</th>
                <th className="px-3 py-2 font-medium text-center">Sinks</th>
                <th className="px-3 py-2 font-medium text-center">Links</th>
                <th className="px-3 py-2 font-medium text-center">Attack Chains</th>
                <th className="px-3 py-2 font-medium text-center">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">加载中...</td></tr>
              ) : traces.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">暂无轨迹数据</td></tr>
              ) : (
                traces.map((t) => (
                  <tr
                    key={t.trace_id}
                    onClick={() => loadDetail(t.task_id)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2 font-mono text-slate-700 truncate max-w-[260px]">{t.task_id}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{t.sources}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{t.sinks}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{t.links}</td>
                    <td className="px-3 py-2 text-center">
                      {t.attack_chains > 0 ? (
                        <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{t.attack_chains}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{(t.taint_coverage * 100).toFixed(1)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail view */}
      {detail && (
        <div className="space-y-5">
          {/* Mini stats */}
          <div className="grid grid-cols-5 gap-3">
            <StatCard label="污点源" value={detail.sources.length} />
            <StatCard label="汇聚点" value={detail.sinks.length} />
            <StatCard label="污点路径" value={detail.links.length} />
            <StatCard label="攻击链" value={detail.attack_chains} accent={detail.attack_chains > 0} />
            <StatCard label="最长链" value={`${detail.max_chain_length} steps`} />
          </div>

          {detailLoading ? (
            <div className="text-center py-12 text-slate-400">加载详细追踪数据...</div>
          ) : (
            <>
              <div>
                <h3 className="text-[13px] font-semibold text-slate-800 mb-2">污点传播流图</h3>
                <TaintFlowDiagram trace={detail} onSelectLink={setSelectedLink} />
              </div>

              {/* Attack chains */}
              {detail.links.filter((l) => l.attack_confirmed).length > 0 && (
                <div>
                  <h3 className="text-[13px] font-semibold text-red-700 mb-2">确认攻击链</h3>
                  <div className="space-y-2">
                    {detail.links
                      .filter((l) => l.attack_confirmed)
                      .map((l) => (
                        <div
                          key={l.link_id}
                          onClick={() => setSelectedLink(l)}
                          className="border border-red-200 rounded-lg bg-red-50/50 p-3 cursor-pointer hover:bg-red-50 transition-colors"
                        >
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="font-mono font-bold text-amber-700">
                              {l.source.tool_name}()
                            </span>
                            <span className="text-slate-400">→</span>
                            {l.propagations.length > 0 && (
                              <>
                                <span className="font-mono text-blue-600">
                                  CoT({l.propagations.map((p) => p.step_k).join(",")})
                                </span>
                                <span className="text-slate-400">→</span>
                              </>
                            )}
                            <span className="font-mono font-bold text-red-700">
                              {l.sink.tool_name}(.{l.sink.argument_name})
                            </span>
                            <ConfBadge value={l.overall_confidence} />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Evidence panel */}
              {selectedLink && <EvidencePanel link={selectedLink} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
