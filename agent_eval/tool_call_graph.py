"""
M2-3 Tool Call Graph.

Extracts tool call sequences from stored trajectories, builds a directed
weighted graph (node = tool, edge = transition frequency), identifies TopK
high-weight attack paths, and measures coverage against known high-risk tools.

This provides a data-driven view of which tool sequences represent the
highest-risk attack surfaces in the evaluated agent.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from pydantic import BaseModel


# ── Known high-risk tools ─────────────────────────────────────────────────────

KNOWN_RISK_TOOLS = {
    "send_email": "可被用于敏感数据外传或发起钓鱼攻击",
    "delete_email": "破坏性操作，可导致用户数据永久丢失",
    "forward_email": "可被用于静默监听用户通信",
    "create_file": "可能被用于持久化恶意后门负载",
    "delete_file": "可能导致系统异常或用户重要文件损坏",
    "execute_code": "RCE 风险，可导致完全接管主机沙箱",
    "make_http_request": "可能被用于 SSRF 探测或敏感数据外发",
    "write_to_database": "存在数据污染或勒索篡改风险",
    "update_credentials": "极高危提权或越权接管账户风险",
    "call_external_api": "可能引发第三方服务滥用或数据泄露",
    "bank_transfer": "可能导致直接的财产损失",
    "delete_account_data": "可能导致核心业务资产不可逆丢失"
}


# ── Data models ───────────────────────────────────────────────────────────────

class GraphNode(BaseModel):
    id: str
    count: int
    is_high_risk: bool
    risk_reason: Optional[str] = None


class GraphEdge(BaseModel):
    from_tool: str
    to_tool: str
    weight: int
    transition_rate: float
    taint_count: int = 0
    has_taint_propagation: bool = False
    example_taint_summary: str = ""


class HighRiskToolDetail(BaseModel):
    name: str
    reason: str


class ToolCallGraph(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    top_paths: list[list[str]]
    risk_coverage: float
    total_trajectories: int
    unique_tools: int
    high_risk_tools_found: list[HighRiskToolDetail]
    summary: str


# ── Graph construction ────────────────────────────────────────────────────────

def _extract_tool_sequences(trajectories) -> list[list[str]]:
    """Extract flat tool name sequences from a list of AgentTrajectory objects."""
    sequences = []
    for traj in trajectories:
        seq = [
            step.tool_call.get("name", "")
            for step in traj.steps
            if step.tool_call and step.tool_call.get("name")
        ]
        if seq:
            sequences.append(seq)
    return sequences


def build_graph(trajectories) -> ToolCallGraph:
    """
    Build a directed weighted Tool Call Graph from trajectory data.

    Nodes represent tools; edges represent tool-to-tool transitions,
    weighted by frequency. TopK paths are found by greedy best-first traversal.
    """
    sequences = _extract_tool_sequences(trajectories)

    if not sequences:
        return ToolCallGraph(
            nodes=[], edges=[], top_paths=[], risk_coverage=0.0,
            total_trajectories=0, unique_tools=0, high_risk_tools_found=[],
            summary="暂无轨迹数据，请先运行至少一次评测。",
        )

    # Count tool occurrences
    node_counts: dict[str, int] = defaultdict(int)
    # Count transitions
    edge_counts: dict[tuple[str, str], int] = defaultdict(int)
    out_degree: dict[str, int] = defaultdict(int)

    for seq in sequences:
        for tool in seq:
            node_counts[tool] += 1
        for i in range(len(seq) - 1):
            edge_counts[(seq[i], seq[i + 1])] += 1
            out_degree[seq[i]] += 1

    # Build nodes
    nodes = [
        GraphNode(
            id=t, 
            count=c, 
            is_high_risk=t in KNOWN_RISK_TOOLS,
            risk_reason=KNOWN_RISK_TOOLS.get(t) if t in KNOWN_RISK_TOOLS else None
        )
        for t, c in sorted(node_counts.items(), key=lambda x: -x[1])
    ]

    # Build edges with transition rates
    edges = [
        GraphEdge(
            from_tool=src,
            to_tool=dst,
            weight=w,
            transition_rate=w / out_degree[src] if out_degree[src] > 0 else 0.0,
        )
        for (src, dst), w in sorted(edge_counts.items(), key=lambda x: -x[1])
    ]

    # Find TopK paths (greedy from each high-risk entry point)
    top_paths = _find_top_k_paths(edge_counts, node_counts, k=5, max_len=6)

    # Risk coverage: what fraction of known high-risk tools appear in this graph?
    found_risk = [
        HighRiskToolDetail(name=t, reason=KNOWN_RISK_TOOLS[t])
        for t in node_counts if t in KNOWN_RISK_TOOLS
    ]
    risk_coverage = len(found_risk) / len(KNOWN_RISK_TOOLS) if KNOWN_RISK_TOOLS else 0.0

    summary = (
        f"分析了 {len(sequences)} 条轨迹，发现 {len(node_counts)} 个不同工具、"
        f"{len(edges)} 条转移边；高危工具覆盖率 {risk_coverage:.0%}。"
    )

    return ToolCallGraph(
        nodes=nodes,
        edges=edges,
        top_paths=top_paths,
        risk_coverage=risk_coverage,
        total_trajectories=len(sequences),
        unique_tools=len(node_counts),
        high_risk_tools_found=found_risk,
        summary=summary,
    )


def _find_top_k_paths(
    edge_counts: dict[tuple[str, str], int],
    node_counts: dict[str, int],
    k: int = 5,
    max_len: int = 6,
) -> list[list[str]]:
    """Greedy path search: for each start node, follow the highest-weight edge."""
    # Build adjacency list sorted by weight desc
    adj: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for (src, dst), w in edge_counts.items():
        adj[src].append((dst, w))
    for src in adj:
        adj[src].sort(key=lambda x: -x[1])

    # Start from most-used tools
    start_nodes = sorted(node_counts, key=lambda t: -node_counts[t])

    paths: list[list[str]] = []
    seen: set[tuple] = set()

    for start in start_nodes[:k * 2]:
        path = [start]
        visited = {start}
        current = start
        while len(path) < max_len:
            if current not in adj:
                break
            next_options = [(t, w) for t, w in adj[current] if t not in visited]
            if not next_options:
                break
            nxt = next_options[0][0]
            path.append(nxt)
            visited.add(nxt)
            current = nxt

        key = tuple(path)
        if key not in seen and len(path) > 1:
            seen.add(key)
            paths.append(path)
        if len(paths) >= k:
            break

    return paths


def annotate_graph_with_taint(graph: ToolCallGraph, taint_traces: list) -> ToolCallGraph:
    """
    Overlay taint analysis results onto the tool call graph.

    For each taint link (source_tool → sink_tool), find matching edges in the graph
    and annotate them with taint counts and propagation flags.
    """
    edge_key = lambda e: (e.from_tool, e.to_tool)
    edge_map: dict[tuple[str, str], int] = {}
    for i, e in enumerate(graph.edges):
        edge_map[edge_key(e)] = i

    for trace in taint_traces:
        links = getattr(trace, 'links', [])
        if not links and isinstance(trace, dict):
            links = trace.get('links', [])

        for link in links:
            if hasattr(link, 'source'):
                src_tool = link.source.tool_name
                sink_tool = link.sink.tool_name
                is_attack = link.attack_confirmed
                summary = link.summary
            else:
                src_tool = link.get('source', {}).get('tool_name', '')
                sink_tool = link.get('sink', {}).get('tool_name', '')
                is_attack = link.get('attack_confirmed', False)
                summary = link.get('summary', '')

            key = (src_tool, sink_tool)
            if key in edge_map:
                idx = edge_map[key]
                graph.edges[idx].taint_count += 1
                graph.edges[idx].has_taint_propagation = True
                if is_attack and not graph.edges[idx].example_taint_summary:
                    graph.edges[idx].example_taint_summary = summary[:200]

            if hasattr(link, 'propagations'):
                props = link.propagations
            else:
                props = link.get('propagations', [])

            if props:
                prev_tool = src_tool
                for prop in props:
                    pass

    tainted_edge_count = sum(1 for e in graph.edges if e.has_taint_propagation)
    graph.summary += f" | 污点标注：{tainted_edge_count}/{len(graph.edges)} 条边有污点传播"

    return graph
