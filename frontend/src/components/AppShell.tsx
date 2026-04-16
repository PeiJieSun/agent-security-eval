/**
 * AppShell — persistent sidebar navigation + scrollable content area.
 * All pages (except LiveMonitorPage) render inside this shell via <Outlet />.
 */
import { Outlet, NavLink, useNavigate } from "react-router-dom";

// ── Nav structure ────────────────────────────────────────────────────────────

type NavItem = { label: string; path: string; desc?: string };
type NavSection = { heading: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    heading: "评测",
    items: [
      { label: "安全报告",   path: "/report",       desc: "内部方案 v1 十二维统一评分卡" },
      { label: "评测列表",   path: "/",             desc: "所有单次攻防评测记录" },
      { label: "批量评测",   path: "/batch-eval",   desc: "任务×风格批量跑，汇总三维指标" },
      { label: "多模型横评", path: "/benchmark",    desc: "同批任务跨模型对比安全性" },
      { label: "发布门",     path: "/release-gate", desc: "指标阈值联动 CI pass/fail" },
    ],
  },
  {
    heading: "一类威胁 · 外部攻击",
    items: [
      { label: "记忆投毒",   path: "/safety/memory-poison", desc: "RAG 记忆污染 ASR vs 污染率曲线" },
      { label: "进化攻击",   path: "/safety/evo-attack",    desc: "轨迹反馈驱动的自动化攻击变异" },
      { label: "MCP 安全",   path: "/mcp-security",         desc: "hidden payload 注入 MCP tool 描述" },
      { label: "工具调用图", path: "/analysis/tool-graph",  desc: "从历史轨迹提取高危工具调用链路" },
    ],
  },
  {
    heading: "二类威胁 · Agent 诚实性",
    items: [
      { label: "一致性探测",   path: "/safety/consistency",    desc: "相似提问行为是否稳定（后门预警）" },
      { label: "评测感知",     path: "/safety/eval-awareness", desc: "检测 agent 是否识别出被测评" },
      { label: "CoT 推理审计", path: "/safety/cot-audit",      desc: "推理链 vs 实际工具调用一致性" },
      { label: "后门扫描",     path: "/safety/backdoor-scan",  desc: "触发词注入后行为突变检测" },
      { label: "PoT 后门检测", path: "/safety/pot-backdoor",   desc: "分析 system prompt 推理链后门" },
    ],
  },
  {
    heading: "深度分析",
    items: [
      { label: "三层联动分析", path: "/deep-analysis", desc: "L1 行为 × L2 源码 × L3 污点 — 完整证据链" },
      { label: "源码审计", path: "/source-audit", desc: "AST 静态分析 Agent 框架特有漏洞" },
      { label: "污点追踪", path: "/taint-analysis", desc: "Prompt Flow 中不可信数据传播链路追踪" },
      { label: "形式化验证", path: "/formal-verification", desc: "Agent 行为状态机安全属性验证" },
    ],
  },
  {
    heading: "防御",
    items: [
      { label: "安全网关", path: "/defense", desc: "运行时拦截、净化、频率限制、Kill Switch" },
    ],
  },
  {
    heading: "真实 Agent 接入",
    items: [
      { label: "轨迹导入", path: "/import", desc: "导入 Claude Code / Codex / MCP 等外部 Agent 日志" },
      { label: "MCP 安全代理", path: "/mcp-proxy", desc: "透明拦截 Agent 与 MCP Server 之间的通信" },
      { label: "Skill 安全扫描", path: "/skill-scan", desc: "扫描 SKILL.md / Rules / AGENTS.md / MCP 配置中的隐藏指令" },
    ],
  },
  {
    heading: "工具 & 扩展",
    items: [
      { label: "长期趋势",    path: "/behavior/trend",    desc: "跨版本三维指标漂移与 KL 散度" },
      { label: "Docker 沙箱", path: "/sandbox",           desc: "隔离容器运行任意 agent 框架评测" },
      { label: "接入 Agent",  path: "/agent-connector",  desc: "任意 OpenAI 兼容 endpoint 接入" },
      { label: "行业垂直包", path: "/verticals",        desc: "按行业预置攻击场景与合规映射" },
      { label: "框架安全指纹", path: "/framework-fingerprints", desc: "LangChain/CrewAI/AutoGen/Dify 安全基线对比" },
      { label: "二开审计", path: "/delta-audit", desc: "框架基线 vs 二开产物 A/B 安全对比" },
      { label: "合规报告", path: "/compliance", desc: "等保/金融/NRC/HIPAA 行业合规审计" },
    ],
  },
];

const BOTTOM_NAV: NavItem[] = [
  { label: "评测维度方案", path: "/eval-frameworks", desc: "OWASP/MITRE/AgentDojo/内部方案对比" },
  { label: "LLM 配置",     path: "/settings" },
];

// ── Sidebar NavItem ──────────────────────────────────────────────────────────

function SideNavItem({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      title={item.desc}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 px-3 py-[5px] rounded transition-colors select-none",
          isActive
            ? "bg-white/10 text-white"
            : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0" aria-hidden />
          <span className={`text-[13px] leading-none ${isActive ? "font-medium text-white" : ""}`}>
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar() {
  const navigate = useNavigate();

  return (
    <aside className="fixed left-0 top-0 h-screen w-[210px] bg-[#0d0d0d] border-r border-white/[0.06] flex flex-col z-30 select-none">
      {/* Logo */}
      <div className="px-4 pt-5 pb-3 border-b border-white/[0.06]">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold tracking-tight text-white">AgentEval</span>
          <span className="text-[10px] text-slate-600 font-mono">v0.1</span>
        </div>
        <p className="text-[10px] text-slate-600 mt-0.5 leading-tight">LLM Agent 安全评测平台</p>
      </div>

      {/* Primary action */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={() => navigate("/evals/new")}
          className="w-full rounded bg-white/10 border border-white/10 text-white text-[12px] font-medium py-1.5 px-3 text-left hover:bg-white/15 transition-colors flex items-center gap-2"
        >
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新建评测
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {NAV.map((section) => (
          <div key={section.heading}>
            <div className="px-3 mb-1">
              <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-widest">
                {section.heading}
              </span>
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <SideNavItem key={item.path} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-2 pb-3 pt-2 border-t border-white/[0.06] space-y-0.5">
        {BOTTOM_NAV.map((item) => (
          <SideNavItem key={item.path} item={item} />
        ))}
      </div>
    </aside>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export default function AppShell() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 ml-[210px] min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}

// ── Page header helper (used by each page) ───────────────────────────────────

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Actions rendered top-right */
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900 leading-tight">{title}</h1>
        {subtitle && (
          <p className="text-[12px] text-slate-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
