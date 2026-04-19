import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppShell from "./components/AppShell";
import Dashboard from "./pages/Dashboard";
import RunDetail from "./pages/RunDetail";
import Standards from "./pages/Standards";
import NewEval from "./pages/NewEval";
import EvalDetail from "./pages/EvalDetail";
import SettingsPage from "./pages/SettingsPage";
import SafetyEvalList from "./pages/SafetyEvalList";
import ConsistencyPage from "./pages/ConsistencyPage";
import EvalAwarenessPage from "./pages/EvalAwarenessPage";
import CoTAuditPage from "./pages/CoTAuditPage";
import BackdoorScanPage from "./pages/BackdoorScanPage";
import LiveMonitorPage from "./pages/LiveMonitorPage";
import MemoryPoisonPage from "./pages/MemoryPoisonPage";
import PotBackdoorPage from "./pages/PotBackdoorPage";
import ToolCallGraphPage from "./pages/ToolCallGraphPage";
import EvoAttackPage from "./pages/EvoAttackPage";
import ReleaseGatePage from "./pages/ReleaseGatePage";
import BehaviorTrendPage from "./pages/BehaviorTrendPage";
import BatchEvalPage from "./pages/BatchEvalPage";
import MCPSecurityPage from "./pages/MCPSecurityPage";
import BenchmarkComparePage from "./pages/BenchmarkComparePage";
import DockerSandboxPage from "./pages/DockerSandboxPage";
import AgentConnectorPage from "./pages/AgentConnectorPage";
import EvalFrameworksPage from "./pages/EvalFrameworksPage";
import AgentReportPage from "./pages/AgentReportPage";
import FrameworkFingerprintPage from "./pages/FrameworkFingerprintPage";
import VerticalsPage from "./pages/VerticalsPage";
import DefenseGatewayPage from "./pages/DefenseGatewayPage";
import DeltaAuditPage from "./pages/DeltaAuditPage";
import CompliancePage from "./pages/CompliancePage";
import SourceAuditPage from "./pages/SourceAuditPage";
import TaintAnalysisPage from "./pages/TaintAnalysisPage";
import DeepAnalysisPage from "./pages/DeepAnalysisPage";
import FormalVerificationPage from "./pages/FormalVerificationPage";
import TrajectoryImportPage from "./pages/TrajectoryImportPage";
import MCPProxyPage from "./pages/MCPProxyPage";
import SkillScanPage from "./pages/SkillScanPage";
import LiteraturePage from "./pages/LiteraturePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LiveMonitorPage is full-screen dark — lives outside AppShell */}
        <Route path="/evals/:eval_id/monitor" element={<LiveMonitorPage />} />

        {/* All other pages share the AppShell */}
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/runs/:run_id" element={<RunDetail />} />
          <Route path="/standards" element={<Standards />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/evals/new" element={<NewEval />} />
          <Route path="/evals/:eval_id" element={<EvalDetail />} />
          <Route path="/safety" element={<SafetyEvalList />} />
          <Route path="/safety/consistency" element={<ConsistencyPage />} />
          <Route path="/safety/consistency/:safety_id" element={<ConsistencyPage />} />
          <Route path="/safety/eval-awareness" element={<EvalAwarenessPage />} />
          <Route path="/safety/eval-awareness/:safety_id" element={<EvalAwarenessPage />} />
          <Route path="/safety/cot-audit" element={<CoTAuditPage />} />
          <Route path="/safety/cot-audit/:safety_id" element={<CoTAuditPage />} />
          <Route path="/safety/backdoor-scan" element={<BackdoorScanPage />} />
          <Route path="/safety/backdoor-scan/:safety_id" element={<BackdoorScanPage />} />
          <Route path="/safety/memory-poison" element={<MemoryPoisonPage />} />
          <Route path="/safety/memory-poison/:safety_id" element={<MemoryPoisonPage />} />
          {/* M2-2 */}
          <Route path="/safety/pot-backdoor" element={<PotBackdoorPage />} />
          <Route path="/safety/pot-backdoor/:safety_id" element={<PotBackdoorPage />} />
          {/* M2-3 */}
          <Route path="/analysis/tool-graph" element={<ToolCallGraphPage />} />
          {/* M2-4 */}
          <Route path="/safety/evo-attack" element={<EvoAttackPage />} />
          <Route path="/safety/evo-attack/:safety_id" element={<EvoAttackPage />} />
          {/* Batch eval */}
          <Route path="/batch-eval" element={<BatchEvalPage />} />
          {/* M3-3 */}
          <Route path="/release-gate" element={<ReleaseGatePage />} />
          {/* M3-5 */}
          <Route path="/behavior/trend" element={<BehaviorTrendPage />} />
          <Route path="/behavior/trend/:task_id" element={<BehaviorTrendPage />} />
          {/* M4-4 */}
          <Route path="/mcp-security" element={<MCPSecurityPage />} />
          {/* M4-3 */}
          <Route path="/benchmark" element={<BenchmarkComparePage />} />
          {/* M5-1 */}
          <Route path="/sandbox" element={<DockerSandboxPage />} />
          {/* P1-1 */}
          <Route path="/agent-connector" element={<AgentConnectorPage />} />
          {/* Eval Frameworks */}
          <Route path="/eval-frameworks" element={<EvalFrameworksPage />} />
          {/* Unified Agent Report */}
          <Route path="/report" element={<AgentReportPage />} />
          {/* Framework Security Fingerprint */}
          <Route path="/framework-fingerprints" element={<FrameworkFingerprintPage />} />
          {/* Vertical Packs */}
          <Route path="/verticals" element={<VerticalsPage />} />
          {/* Delta Audit */}
          <Route path="/delta-audit" element={<DeltaAuditPage />} />
          {/* Compliance */}
          <Route path="/compliance" element={<CompliancePage />} />
          {/* Source Audit */}
          <Route path="/source-audit" element={<SourceAuditPage />} />
          {/* Taint Analysis */}
          <Route path="/taint-analysis" element={<TaintAnalysisPage />} />
          {/* Deep Analysis (three-layer integration) */}
          <Route path="/deep-analysis" element={<DeepAnalysisPage />} />
          {/* Formal Verification */}
          <Route path="/formal-verification" element={<FormalVerificationPage />} />
          {/* Defense Gateway */}
          <Route path="/defense" element={<DefenseGatewayPage />} />
          {/* Trajectory Import */}
          <Route path="/import" element={<TrajectoryImportPage />} />
          {/* MCP Proxy */}
          <Route path="/mcp-proxy" element={<MCPProxyPage />} />
          {/* Skill Security Scan */}
          <Route path="/skill-scan" element={<SkillScanPage />} />
          <Route path="/literature" element={<LiteraturePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
