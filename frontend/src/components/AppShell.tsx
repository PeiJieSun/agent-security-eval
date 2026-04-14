/**
 * AppShell — persistent sidebar navigation + scrollable content area.
 * All pages (except LiveMonitorPage) render inside this shell via <Outlet />.
 */
import { Outlet, NavLink, useNavigate } from "react-router-dom";

// ── Nav structure ────────────────────────────────────────────────────────────

type NavItem = { label: string; path: string; mono?: boolean };
type NavSection = { heading: string; badge?: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    heading: "一类威胁",
    badge: "外部攻击防御",
    items: [
      { label: "评测列表", path: "/" },
      { label: "新建评测", path: "/evals/new" },
      { label: "评测标准", path: "/standards" },
    ],
  },
  {
    heading: "二类威胁",
    badge: "Agent 诚实性",
    items: [
      { label: "一致性探测", path: "/safety/consistency" },
      { label: "评测感知", path: "/safety/eval-awareness" },
      { label: "CoT 推理审计", path: "/safety/cot-audit" },
      { label: "后门扫描", path: "/safety/backdoor-scan" },
    ],
  },
  {
    heading: "攻击变体",
    badge: "外部攻击扩展",
    items: [{ label: "记忆投毒", path: "/safety/memory-poison" }],
  },
];

const BOTTOM_NAV: NavItem[] = [{ label: "LLM 配置", path: "/settings" }];

// ── Sidebar NavItem ──────────────────────────────────────────────────────────

function SideNavItem({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 px-3 py-1.5 rounded text-[13px] transition-colors select-none",
          isActive
            ? "bg-white/10 text-white font-medium"
            : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
        ].join(" ")
      }
    >
      <span
        className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0"
        aria-hidden
      />
      {item.label}
    </NavLink>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar() {
  const navigate = useNavigate();

  return (
    <aside className="fixed left-0 top-0 h-screen w-[196px] bg-[#0d0d0d] border-r border-white/[0.06] flex flex-col z-30 select-none">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-white/[0.06]">
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
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-5">
        {NAV.map((section) => (
          <div key={section.heading}>
            <div className="px-3 mb-1 flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                {section.heading}
              </span>
              {section.badge && (
                <span className="text-[9px] text-slate-600">{section.badge}</span>
              )}
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
      <div className="px-2 pb-3 pt-2 border-t border-white/[0.06]">
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
      <main className="flex-1 ml-[196px] min-h-screen">
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
