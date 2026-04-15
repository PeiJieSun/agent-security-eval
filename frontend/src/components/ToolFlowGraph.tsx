import { useEffect, useMemo } from 'react';
import { ReactFlow, useNodesState, useEdgesState, Background, Controls, Position } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

interface ToolFlowGraphProps {
  nodesData: { id: string; count: number; is_high_risk: boolean }[];
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
          <div className={`flex flex-col h-full justify-center w-full ${n.is_high_risk ? 'text-red-700' : 'text-slate-700'}`}>
            <div className="font-mono text-[11px] truncate px-1 font-bold">{n.id}</div>
            <div className={`text-[9px] ${n.is_high_risk ? 'text-red-400' : 'text-slate-400'}`}>
              {n.count} calls
            </div>
          </div>
        )
      },
      style: {
        width: nodeWidth,
        height: nodeHeight,
        background: n.is_high_risk ? '#fef2f2' : '#ffffff',
        border: `1px solid ${n.is_high_risk ? '#fca5a5' : '#e2e8f0'}`,
        borderRadius: '6px',
        padding: 0,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
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
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.8 },
      style: {
        strokeWidth: Math.max(1, Math.min(4, e.weight / 10)),
        stroke: '#94a3b8',
      },
      markerEnd: { type: 'arrowclosed' as any, color: '#94a3b8' },
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
    <div className="h-[600px] w-full border border-slate-200 rounded-lg bg-slate-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-right"
        minZoom={0.2}
      >
        <Background color="#cbd5e1" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}