import { useEffect, useState } from "react";
import { api, type MetricStandard } from "../lib/api";
import MetricBadge from "../components/MetricBadge";

const METRIC_LABEL: Record<string, string> = {
  benign_utility: "正常效用（Benign Utility）",
  utility_under_attack: "攻击下效用（Utility Under Attack）",
  targeted_asr: "目标攻击成功率（Targeted ASR）",
  asr_valid: "有效攻击成功率（ASR-valid）",
};

function StandardCard({ std }: { std: MetricStandard }) {
  const [bibtexOpen, setBibtexOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyBibtex = () => {
    navigator.clipboard.writeText(std.bibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-gray-900">
              {METRIC_LABEL[std.id] ?? std.name}
            </h2>
          </div>

          {/* 原文定义 */}
          <blockquote className="mt-3 pl-3 border-l-4 border-gray-300 text-sm text-gray-700 italic leading-relaxed">
            "{std.definition}"
          </blockquote>
        </div>
        <MetricBadge source={std.source} arxivId={std.arxiv_id} bibtex={std.bibtex} />
      </div>

      {/* 引用信息 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span><strong>作者：</strong>{std.authors}</span>
        <span><strong>发表：</strong>{std.venue}</span>
        <a href={std.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          arXiv:{std.arxiv_id} ↗
        </a>
      </div>

      {/* BibTeX */}
      <div className="mt-3">
        <button
          onClick={() => setBibtexOpen(!bibtexOpen)}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          {bibtexOpen ? "▲ 收起 BibTeX" : "▼ 展开 BibTeX"}
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
              {copied ? "✓ 已复制" : "复制"}
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
        <div className="mb-6">
          <a href="/" className="text-sm text-gray-400 hover:text-gray-600">← 返回主页</a>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">评测维度标准</h1>
          <p className="text-sm text-gray-500 mt-1">
            以下指标定义均逐字引用自同行评审学术论文，确保评测结果可复现、可比较、可引用。
          </p>
        </div>

        {/* 方法论说明 */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800">
          <p>
            <strong>框架来源：</strong>
            AgentDojo（Debenedetti et al., NeurIPS 2024）的三维框架捕捉了任意 LLM Agent 的安全-效用权衡关系。
            InjecAgent（Zhan et al., 2024）补充了 ASR-valid 指标，通过排除无效输出使攻击成功率的衡量更为精准。
          </p>
          <p className="mt-1 text-blue-600 text-xs">
            这两篇论文是目前学界评测 LLM Agent 安全性最广泛引用的基准。
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full" />
            加载中…
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            错误：{error}
          </div>
        )}

        <div className="space-y-4">
          {standards.map((std) => (
            <StandardCard key={std.id} std={std} />
          ))}
        </div>

        {standards.length > 0 && (
          <div className="mt-8 text-xs text-gray-400 border-t border-gray-200 pt-4 space-y-1">
            <p className="font-semibold text-gray-500 mb-2">主要参考文献</p>
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
