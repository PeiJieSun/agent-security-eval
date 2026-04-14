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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
