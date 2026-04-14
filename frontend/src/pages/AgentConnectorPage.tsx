/**
 * AgentConnectorPage — step-by-step guide for connecting any OpenAI-compatible agent.
 */
import { useNavigate } from "react-router-dom";

const CODE_BLOCK = "font-mono text-[11px] bg-slate-50 border border-slate-200 rounded px-3 py-2 block whitespace-pre overflow-x-auto";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full border border-slate-300 text-slate-500 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
          {n}
        </span>
        <h2 className="text-[13px] font-semibold text-slate-800">{title}</h2>
      </div>
      <div className="ml-8 space-y-2 text-[12px] text-slate-600">{children}</div>
    </div>
  );
}

export default function AgentConnectorPage() {
  const navigate = useNavigate();

  return (
    <div className="px-8 py-7 max-w-2xl mx-auto space-y-7">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">接入内部 Agent</h1>
        <p className="text-[12px] text-slate-400 mt-0.5">
          将任意支持 OpenAI 兼容协议的内部 Agent 接入安全测评平台，无需改动 agent 代码。
        </p>
      </div>

      {/* Requirements */}
      <div className="border border-slate-200 rounded-lg p-4 space-y-2 bg-slate-50">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">最低接入要求</p>
        <div className="grid grid-cols-1 gap-1.5">
          {[
            ["Chat Completions API", "/v1/chat/completions  (POST)"],
            ["Function Calling 支持", "messages 中的 tool_calls 字段"],
            ["认证方式", "Bearer token 或自定义 api_key header"],
          ].map(([label, detail]) => (
            <div key={label} className="flex items-start gap-2">
              <span className="text-green-500 text-[12px] flex-shrink-0 mt-0.5">✓</span>
              <span>
                <span className="font-medium text-slate-700">{label}</span>
                <span className="ml-2 text-slate-400 font-mono text-[10px]">{detail}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-6">
        <Section n={1} title="确认你的 agent 暴露了 OpenAI 兼容接口">
          <p>向 agent 发一次测试请求，验证工具调用可以正常返回：</p>
          <code className={CODE_BLOCK}>{`curl -X POST http://your-agent-host:8080/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "your-model-name",
    "messages": [{"role":"user","content":"hello"}],
    "tools": []
  }'`}</code>
          <p className="text-slate-400">如果返回 <code className="bg-white px-1 rounded border border-slate-200">choices[0].message</code>，则接口可用。</p>
        </Section>

        <Section n={2} title="在「新建评测」中切换到「接入内部 Agent」模式">
          <p>打开「新建评测」页，顶部切换到 <strong>接入内部 Agent</strong> 模式，然后填写：</p>
          <ul className="list-disc list-inside space-y-1 text-[12px]">
            <li><strong>Base URL</strong>：你的 agent 地址，如 <code className="bg-white px-1 rounded border border-slate-200">http://10.0.0.5:8080/v1</code></li>
            <li><strong>API Key</strong>：你的 agent 认证 key</li>
            <li><strong>模型名称</strong>：调用时传入的 model 参数</li>
            <li><strong>系统提示词覆盖</strong>（可选）：如果你的 agent 需要特定 system prompt</li>
          </ul>
          <button
            onClick={() => navigate("/evals/new")}
            className="inline-block mt-1 px-3 py-1.5 border border-slate-300 rounded text-[11px] text-slate-700 hover:bg-slate-50"
          >
            去新建评测 →
          </button>
        </Section>

        <Section n={3} title="选择测评任务集">
          <p>可以选择单个任务做快速验证，或在「批量评测」中选择多个域全量运行：</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Email 助手", count: 5, color: "border-blue-200 text-blue-700" },
              { label: "AI 研究助手", count: 5, color: "border-violet-200 text-violet-700" },
              { label: "中文 LLM 专项", count: 11, color: "border-orange-200 text-orange-700" },
            ].map(({ label, count, color }) => (
              <div key={label} className={`border rounded px-3 py-2 text-center ${color}`}>
                <div className="text-[11px] font-medium">{label}</div>
                <div className="text-[10px] opacity-70 mt-0.5">{count} 个任务</div>
              </div>
            ))}
          </div>
          <p className="text-slate-400 text-[11px]">
            每个任务会运行「正常执行」和「注入攻击」两轮，输出三维安全指标。
          </p>
        </Section>

        <Section n={4} title="批量接入与 CI 集成">
          <p>批量评测支持自定义 endpoint，适合在 CI 流水线中集成：</p>
          <code className={CODE_BLOCK}>{`# 批量评测 API（直接调用）
curl -X POST http://localhost:18001/batch-evals \\
  -H "Content-Type: application/json" \\
  -d '{
    "domains": ["email", "research"],
    "injection_styles": ["naive", "camouflaged"],
    "model": "your-model",
    "api_key": "YOUR_KEY",
    "base_url": "http://your-agent:8080/v1",
    "system_prompt_override": "You are a helpful assistant..."
  }'`}</code>
          <button
            onClick={() => navigate("/batch-eval")}
            className="inline-block mt-1 px-3 py-1.5 border border-slate-300 rounded text-[11px] text-slate-700 hover:bg-slate-50"
          >
            去批量评测 →
          </button>
        </Section>

        <Section n={5} title="查看三维安全指标">
          <p>评测完成后，可以看到：</p>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              ["Benign Utility", "无攻击时任务成功率"],
              ["Under Attack", "有攻击时任务成功率"],
              ["Targeted ASR", "攻击者目标成功率（越低越安全）"],
            ].map(([name, desc]) => (
              <div key={name} className="border border-slate-200 rounded px-3 py-2">
                <div className="text-[11px] font-semibold text-slate-700">{name}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{desc}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* FAQ */}
      <div className="border border-slate-100 rounded-lg p-4 space-y-3">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">常见问题</p>
        {[
          ["我的 agent 没有 function calling 支持怎么办？",
           "需要先在 agent 侧实现 OpenAI function calling 协议。可以用 litellm、vLLM 等网关做适配层。"],
          ["测评会不会影响我的生产 agent？",
           "建议使用 staging / test 环境接入，或开 Docker 沙箱模式隔离。评测请求与真实用户流量完全独立。"],
          ["支持 Azure OpenAI 吗？",
           "支持。base_url 填 Azure endpoint，api_key 填 Azure key，model 填 deployment name。"],
        ].map(([q, a]) => (
          <div key={q as string}>
            <p className="text-[12px] font-medium text-slate-700">{q}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
