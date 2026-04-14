/**
 * SafetySourceCard — displays academic source and rationale for a safety evaluation method.
 * Collapsible; defaults to collapsed.
 */
import { useState } from "react";
import type { SafetyStandard } from "../lib/api";

interface Props {
  standard: SafetyStandard;
  defaultOpen?: boolean;
}

export default function SafetySourceCard({ standard, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [bibtexCopied, setBibtexCopied] = useState(false);

  const copyBibtex = () => {
    navigator.clipboard.writeText(standard.bibtex).then(() => {
      setBibtexCopied(true);
      setTimeout(() => setBibtexCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 overflow-hidden mb-5">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-emerald-100/60 transition-colors"
      >
        <span className="text-base">📚</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
              {standard.milestone} · 方法来源
            </span>
            <span className="text-xs bg-emerald-200 text-emerald-800 rounded px-2 py-0.5 font-mono">
              {standard.source}
            </span>
            <span className="text-xs text-emerald-600">{standard.venue}</span>
          </div>
          <div className="text-sm font-semibold text-emerald-900 mt-0.5 truncate">
            {standard.source_full}
          </div>
        </div>
        <span className="text-emerald-400 text-sm shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {/* Expandable body */}
      {open && (
        <div className="border-t border-emerald-200 px-5 py-4 space-y-4">

          {/* Chinese definition */}
          <div>
            <div className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-1">
              方法定义（中文）
            </div>
            <p className="text-sm text-emerald-900 leading-relaxed">{standard.definition_zh}</p>
          </div>

          {/* Verbatim quote */}
          <div className="rounded-xl border border-emerald-300 bg-white px-4 py-3">
            <div className="text-xs font-bold text-emerald-600 mb-1">论文原文摘录</div>
            <p className="text-sm text-slate-700 italic leading-relaxed">{standard.verbatim_quote}</p>
          </div>

          {/* Decision threshold */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-emerald-700">判定阈值</span>
            <code className="text-xs bg-slate-100 text-slate-800 rounded px-2 py-1 font-mono">
              {standard.threshold}
            </code>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {standard.tags.map(t => (
              <span key={t} className="text-[11px] bg-emerald-100 text-emerald-700 rounded px-2 py-0.5">
                {t}
              </span>
            ))}
          </div>

          {/* Paper links + BibTeX */}
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={standard.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs bg-emerald-700 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-800"
            >
              在 arXiv 查看 ↗
            </a>
            {standard.url_secondary && (
              <a
                href={standard.url_secondary}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs bg-slate-700 text-white rounded-lg px-3 py-1.5 hover:bg-slate-800"
              >
                次要来源 ↗
              </a>
            )}
            <button
              onClick={copyBibtex}
              className="inline-flex items-center gap-1 text-xs border border-emerald-300 text-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100"
            >
              {bibtexCopied ? "✓ 已复制" : "复制 BibTeX"}
            </button>
          </div>

          {/* Authors */}
          <div className="text-xs text-emerald-600">
            <span className="font-semibold">作者：</span>{standard.authors}
          </div>
        </div>
      )}
    </div>
  );
}
