import { useEffect, useMemo } from 'react';
import { ReactFlow, useNodesState, useEdgesState, Background, Controls, Position } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

interface ToolFlowGraphProps {
  nodesData: { id: string; count: number; is_high_risk: boolean; risk_reason?: string }[];
  edgesData: { from_tool: string; to_tool: string; weight: number; transition_rate: number }[];
}

const nodeWidth = 140;
const nodeHeight = 40;

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 100 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      // We are shifting the dagre node position (anchor=center) to the top left so it matches the React Flow node anchor point
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
    return newNode;
  });

  return { nodes: newNodes, edges };
};

export default function ToolFlowGraph({ nodesData, edgesData }: ToolFlowGraphProps) {
  const initialNodes: Node[] = useMemo(() => {
    return nodesData.map(n => ({
      id: n.id,
      position: { x: 0, y: 0 },
      data: {
        label: (
          <div 
            className={`flex flex-col h-full justify-center w-full ${n.is_high_risk ? 'text-red-700' : 'text-slate-700'}`}
            title={n.risk_reason || `${n.id} (${n.count}次调用)`}
          >
            <div className="font-mono text-[11px] truncate px-1 font-bold">
              {n.id} {n.is_high_risk && "⚠"}
            </div>
            <div className={`text-[9px] ${n.is_high_risk ? 'text-red-400' : 'text-slate-400'}`}>
              {n.count} calls
            </div>
          </div>
        )
      },
      style: {
        width: nodeWidth,
        height: nodeHeight,
        background: n.is_high_risk ? '#fff1f2' : '#ffffff',
        border: `1px solid ${n.is_high_risk ? '#fda4af' : '#e2e8f0'}`,
        borderRadius: '8px',
        padding: 0,
        boxShadow: n.is_high_risk ? '0 4px 6px -1px rgba(225, 29, 72, 0.1), 0 2px 4px -1px rgba(225, 29, 72, 0.06)' : '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        textAlign: 'center' as const,
      }
    }));
  }, [nodesData]);

  const initialEdges: Edge[] = useMemo(() => {
    return edgesData.map((e, i) => ({
      id: `e-${e.from_tool}-${e.to_tool}-${i}`,
      source: e.from_tool,
      target: e.to_tool,
      label: `${e.weight} (${(e.transition_rate * 100).toFixed(0)}%)`,
      type: 'smoothstep',
      animated: e.weight > 50,
      labelStyle: { fill: '#64748b', fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9, rx: 4, ry: 4 },
      style: {
        strokeWidth: Math.max(1.5, Math.min(5, e.weight / 10)),
        stroke: '#cbd5e1',
      },
      markerEnd: { type: 'arrowclosed' as any, color: '#cbd5e1' },
    }));
  }, [edgesData]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      initialNodes,
      initialEdges
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="h-[600px] w-full border border-slate-200 rounded-xl bg-white relative overflow-hidden shadow-sm">
      <style>{`.react-flow__handle { opacity: 0; }`}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-right"
        minZoom={0.2}
      >
        <Background color="#f1f5f9" gap={20} size={2} />
        <Controls showInteractive={false} className="bg-white border-slate-200 shadow-sm rounded-lg" />
      </ReactFlow>
    </div>
  );
}