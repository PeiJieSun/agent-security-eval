import { useEffect, useState } from "react";
import { api, type MetricStandard } from "../lib/api";
import MetricBadge from "../components/MetricBadge";

function StandardCard({ std }: { std: MetricStandard }) {
  const [bibtexOpen, setBibtexOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyBibtex = () => {
    navigator.clipboard.writeText(std.bibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tagColor = std.id.startsWith("asr") ? "text-red-700 bg-red-50" : "text-blue-700 bg-blue-50";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-gray-900">{std.name}</h2>
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${tagColor}`}>
              {std.id}
            </span>
          </div>

          <blockquote className="mt-3 pl-3 border-l-4 border-gray-300 text-sm text-gray-700 italic leading-relaxed">
            "{std.definition}"
          </blockquote>
        </div>
        <MetricBadge source={std.source} arxivId={std.arxiv_id} bibtex={std.bibtex} />
      </div>

      {/* Citation info */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>
          <strong>Authors:</strong> {std.authors}
        </span>
        <span>
          <strong>Venue:</strong> {std.venue}
        </span>
        <a
          href={std.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          arXiv:{std.arxiv_id} ↗
        </a>
      </div>

      {/* BibTeX toggle */}
      <div className="mt-3">
        <button
          onClick={() => setBibtexOpen(!bibtexOpen)}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          {bibtexOpen ? "▲ Hide BibTeX" : "▼ Show BibTeX"}
        </button>
        {bibtexOpen && (
          <div className="mt-2 relative">
            <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-4">
              {std.bibtex}
            </pre>
            <button
              onClick={copyBibtex}
              className="absolute top-2 right-2 text-xs bg-white border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Standards() {
  const [standards, setStandards] = useState<MetricStandard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMetricStandards()
      .then(setStandards)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <a href="/" className="text-sm text-gray-400 hover:text-gray-600">← Back to Dashboard</a>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Evaluation Standards</h1>
          <p className="text-sm text-gray-500 mt-1">
            These metric definitions are quoted verbatim from peer-reviewed publications,
            ensuring results are reproducible, comparable, and citable.
          </p>
        </div>

        {/* Methodology note */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800">
          <strong>Framework:</strong> Three dimensions from AgentDojo (Debenedetti et al., NeurIPS 2024)
          capture the security-utility trade-off for any LLM agent.
          ASR-valid from InjecAgent (Zhan et al., 2024) provides a more precise attack success measure
          that excludes invalid agent outputs from the denominator.
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full" />
            Loading standards…
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        <div className="space-y-4">
          {standards.map((std) => (
            <StandardCard key={std.id} std={std} />
          ))}
        </div>

        {/* References */}
        {standards.length > 0 && (
          <div className="mt-8 text-xs text-gray-400 border-t border-gray-200 pt-4 space-y-1">
            <p className="font-semibold text-gray-500 mb-2">Primary references</p>
            <p>[1] Debenedetti et al., "AgentDojo: A Dynamic Environment to Evaluate Prompt Injection
              Attacks and Defenses for LLM Agents," NeurIPS 2024. arXiv:2406.13352</p>
            <p>[2] Zhan et al., "InjecAgent: Benchmarking Indirect Prompt Injections in
              Tool-Integrated Large Language Model Agents," 2024. arXiv:2403.02691</p>
          </div>
        )}
      </div>
    </div>
  );
}
