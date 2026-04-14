import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import RunDetail from "./pages/RunDetail";
import Standards from "./pages/Standards";
import NewEval from "./pages/NewEval";
import EvalDetail from "./pages/EvalDetail";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/runs/:run_id" element={<RunDetail />} />
        <Route path="/standards" element={<Standards />} />
        <Route path="/evals/new" element={<NewEval />} />
        <Route path="/evals/:eval_id" element={<EvalDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
