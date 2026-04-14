import { useState } from "react";

interface MetricBadgeProps {
  source: string;
  arxivId: string;
  bibtex?: string;
}

export default function MetricBadge({ source, arxivId, bibtex }: MetricBadgeProps) {
  const [open, setOpen] = useState(false);
  const color = source.includes("AgentDojo") ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700";

  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className={`text-xs font-mono px-2 py-0.5 rounded cursor-pointer hover:opacity-80 ${color}`}
        title="Click to see BibTeX"
      >
        [{source}]
      </button>
      {open && (
        <div className="absolute z-50 left-0 mt-1 w-96 bg-white border border-gray-200 rounded-lg shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600">BibTeX · arXiv:{arxivId}</span>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 text-xs"
            >
              ✕
            </button>
          </div>
          {bibtex && (
            <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono leading-4">
              {bibtex}
            </pre>
          )}
          <a
            href={`https://arxiv.org/abs/${arxivId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block text-xs text-blue-600 hover:underline"
          >
            View on arXiv ↗
          </a>
        </div>
      )}
    </span>
  );
}
