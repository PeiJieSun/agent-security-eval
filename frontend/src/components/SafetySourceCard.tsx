/**
 * SafetySourceCard — academic source citation, collapsible, minimal styling.
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
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs text-slate-400">📄</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-700">{standard.milestone} · 方法来源</span>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">{standard.source}</span>
            <span className="text-[10px] text-slate-400">{standard.venue}</span>
          </div>
          <div className="text-xs text-slate-600 mt-0.5 truncate">{standard.source_full}</div>
        </div>
        <span className="text-slate-400 text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {/* Expandable body */}
      {open && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-3">

          {/* Chinese definition */}
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">方法定义</div>
            <p className="text-xs text-slate-700 leading-relaxed">{standard.definition_zh}</p>
          </div>

          {/* Verbatim quote */}
          <div className="border-l-2 border-slate-200 pl-3">
            <div className="text-[10px] text-slate-400 mb-1">论文原文摘录</div>
            <p className="text-xs text-slate-600 italic leading-relaxed">{standard.verbatim_quote}</p>
          </div>

          {/* Threshold */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">判定阈值</span>
            <code className="text-[10px] bg-slate-100 text-slate-700 rounded px-2 py-0.5 font-mono">{standard.threshold}</code>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1">
            {standard.tags.map(t => (
              <span key={t} className="text-[10px] border border-slate-200 text-slate-500 rounded px-1.5 py-0.5">{t}</span>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={standard.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs border border-slate-200 text-slate-600 rounded px-3 py-1 hover:bg-slate-50"
            >
              arXiv ↗
            </a>
            {standard.url_secondary && (
              <a
                href={standard.url_secondary}
                target="_blank"
                rel="noreferrer"
                className="text-xs border border-slate-200 text-slate-600 rounded px-3 py-1 hover:bg-slate-50"
              >
                次要来源 ↗
              </a>
            )}
            <button
              onClick={copyBibtex}
              className="text-xs border border-slate-200 text-slate-600 rounded px-3 py-1 hover:bg-slate-50"
            >
              {bibtexCopied ? "✓ 已复制" : "复制 BibTeX"}
            </button>
          </div>

          <div className="text-[10px] text-slate-400">作者：{standard.authors}</div>
        </div>
      )}
    </div>
  );
}
