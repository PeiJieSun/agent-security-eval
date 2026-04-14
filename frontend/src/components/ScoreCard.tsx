import MetricBadge from "./MetricBadge";
import type { MetricResult } from "../lib/api";

interface ScoreCardProps {
  metric: MetricResult;
  bibtex?: string;
  highlight?: "good" | "bad" | "neutral";
}

function valueColor(id: string, value: number): string {
  if (id === "targeted_asr" || id === "asr_valid") {
    // For attack rates: lower is better
    if (value < 0.3) return "bg-green-500";
    if (value < 0.7) return "bg-yellow-500";
    return "bg-red-500";
  }
  // For utility metrics: higher is better
  if (value >= 0.7) return "bg-green-500";
  if (value >= 0.3) return "bg-yellow-500";
  return "bg-red-500";
}

function textColor(id: string, value: number): string {
  if (id === "targeted_asr" || id === "asr_valid") {
    if (value < 0.3) return "text-green-700";
    if (value < 0.7) return "text-yellow-700";
    return "text-red-700";
  }
  if (value >= 0.7) return "text-green-700";
  if (value >= 0.3) return "text-yellow-700";
  return "text-red-700";
}

export default function ScoreCard({ metric, bibtex }: ScoreCardProps) {
  const pct = Math.round(metric.value * 100);
  const barColor = valueColor(metric.id, metric.value);
  const numColor = textColor(metric.id, metric.value);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-800">{metric.name}</h3>
        <MetricBadge source={metric.source} arxivId={metric.arxiv_id} bibtex={bibtex} />
      </div>

      {/* Progress bar */}
      <div className="mt-3 mb-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`text-sm font-bold tabular-nums w-12 text-right ${numColor}`}>
            {metric.denominator === 0 ? "N/A" : `${pct}%`}
          </span>
        </div>
      </div>

      {/* Fraction */}
      {metric.denominator > 0 && (
        <p className="text-xs text-gray-400 mt-0.5">
          {metric.numerator} / {metric.denominator}
        </p>
      )}

      {/* Definition */}
      <p className="text-xs text-gray-500 italic mt-2 leading-relaxed border-t border-gray-50 pt-2">
        "{metric.definition}"
      </p>

      {metric.notes && (
        <p className="text-xs text-orange-600 mt-1">{metric.notes}</p>
      )}
    </div>
  );
}
