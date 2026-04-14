import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import RunDetail from "./pages/RunDetail";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/runs/:run_id" element={<RunDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
