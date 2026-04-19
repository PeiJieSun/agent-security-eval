"""
Literature registry for Agent Skill Security research.
Tracks related work, our positioning, and enables the survey UI.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class Paper(BaseModel):
    id: str
    title: str
    authors: str = ""
    venue: str = ""           # arxiv / NeurIPS / USENIX / OWASP / etc.
    year: int = 2026
    month: int = 0
    arxiv_id: str = ""
    url: str = ""
    category: str = ""        # attack / defense / benchmark / survey / empirical / threat_model
    relevance: str = ""       # which layer(s) of our system it relates to
    key_finding: str = ""
    our_relation: str = ""    # how our work differs or builds on this
    tags: list[str] = Field(default_factory=list)
    bibtex: str = ""


# ---------------------------------------------------------------------------
# Literature database
# ---------------------------------------------------------------------------

PAPERS: list[Paper] = [
    # ── Skill Supply Chain Attacks ──
    Paper(
        id="ddipe-2026",
        title="Supply-Chain Poisoning Attacks Against LLM Coding Agent Skill Ecosystems",
        authors="Anonymous (under review)",
        venue="arXiv", year=2026, month=4, arxiv_id="2604.03081",
        url="https://arxiv.org/abs/2604.03081",
        category="attack",
        relevance="L1, L3",
        key_finding="DDIPE embeds malicious payloads in SKILL.md code examples/config templates. Explicit injection 0% bypass under strong defense, but implicit document payloads achieve 11.6-33.5% bypass. 1,070 adversarial skills from 81 seeds across 15 MITRE ATT&CK categories.",
        our_relation="最直接竞品（攻击侧）。我们的 L1 LLM 语义分析专门检测 intent deviation（声称功能 vs 实际指令），L3 行为验证在沙箱中观察 agent 是否执行了文档中隐式嵌入的恶意代码。DDIPE 的 adversarial skill 数据集可作为我们的 benchmark。",
        tags=["skill-poisoning", "supply-chain", "DDIPE", "coding-agent"],
    ),
    Paper(
        id="malicious-skills-wild-2026",
        title="Malicious Agent Skills in the Wild: A Large-Scale Security Empirical Study",
        authors="Anonymous",
        venue="arXiv", year=2026, month=2, arxiv_id="2602.06547",
        url="https://arxiv.org/abs/2602.06547",
        category="empirical",
        relevance="L1, L4, Benchmark",
        key_finding="扫描 98,380 skills，确认 157 个恶意 skill 含 632 漏洞。恶意 skill 平均 4.03 漏洞跨 3 个 kill chain 阶段。两类攻击：Data Thieves（凭证窃取）和 Agent Hijackers（决策操纵）。单一攻击者占 54.1%（模板化品牌仿冒）。",
        our_relation="最直接的 benchmark 数据源。他们释放了首个标注恶意 skill 数据集，我们可直接用于批量测试五层扫描器的检出率。他们的 pipeline 是单层静态分析，我们是五层递进。",
        tags=["empirical", "large-scale", "dataset", "benchmark"],
    ),
    Paper(
        id="skilltrojan-2026",
        title="SkillTrojan: Backdoor Attacks on Skill-Based Agent Systems",
        authors="Anonymous",
        venue="arXiv", year=2026, month=4, arxiv_id="2604.06811",
        url="https://arxiv.org/abs/2604.06811",
        category="attack",
        relevance="L5",
        key_finding="跨 skill 调用分片加密 payload，仅在预定义触发器下激活。自动合成后门 skill 模板，3000+ 样本数据集。97.2% ASR，89.3% clean accuracy。",
        our_relation="直接证明了 L5 组合安全分析的必要性 — 单 skill 分析无法检测被拆分到多个 skill 中的攻击 payload。我们的冲突矩阵 + 跨文件权限升级检测是针对此类攻击的防御。",
        tags=["backdoor", "cross-skill", "composition", "trojan"],
    ),
    Paper(
        id="skillattack-2026",
        title="SkillAttack: Automated Red Teaming of Agent Skills through Attack Path Refinement",
        authors="Anonymous",
        venue="arXiv", year=2026, month=4, arxiv_id="2604.04989",
        url="https://arxiv.org/abs/2604.04989",
        category="attack",
        relevance="L3, Benchmark",
        key_finding="闭环对抗性搜索框架：漏洞分析 → 攻击生成 → 反馈驱动 exploit 精炼。ASR 0.73-0.93（adversarial skills）, 0.26（real-world skills）。测试 10 个 LLM 在 71 adversarial + 100 real-world skills 上。",
        our_relation="其攻击生成器可作为 L3 行为验证的测试场景来源。我们的 honeypot tools + 行为偏差检测是对其攻击的防御面验证。",
        tags=["red-team", "automated", "attack-generation"],
    ),
    Paper(
        id="badskill-2026",
        title="BADSKILL: Backdoor Attacks on Skills with Embedded Models",
        authors="Anonymous",
        venue="arXiv", year=2026, month=4, arxiv_id="2604.09378",
        url="https://arxiv.org/abs/2604.09378",
        category="attack",
        relevance="L4",
        key_finding="Model-in-Skill 后门 — 在 skill 内嵌入经 backdoor fine-tune 的模型。99.5% ASR，3% 投毒率下 91.7% ASR。传统源码审计无法检测（攻击在模型参数中）。",
        our_relation="证明了 L4 供应链溯源中完整性校验的必要性。对嵌入模型文件的 skill 需要额外的 hash/签名验证。",
        tags=["backdoor", "model-poisoning", "supply-chain"],
    ),

    # ── Prompt Injection Surveys & Benchmarks ──
    Paper(
        id="agentpi-landscape-2026",
        title="The Landscape of Prompt Injection Threats in LLM Agents: From Taxonomy to Analysis",
        authors="Anonymous",
        venue="arXiv", year=2026, month=2, arxiv_id="2602.10453",
        url="https://arxiv.org/abs/2602.10453",
        category="survey",
        relevance="L1, Framework",
        key_finding="系统分类 PI 攻击（启发式 vs 优化）和防御（文本/模型/执行层）。引入 AgentPI benchmark 评估上下文相关场景。发现：没有单一防御能同时满足 trustworthiness + utility + latency。",
        our_relation="我们的五层架构覆盖其分类中的全部三个防御层级（文本=L1, 模型=L3, 执行=L2+L4+L5），是其 defense-in-depth 理念的具体实现。",
        tags=["survey", "taxonomy", "benchmark", "AgentPI"],
    ),
    Paper(
        id="agentdojo-2024",
        title="AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents",
        authors="ETH Zurich, Invariant Labs",
        venue="NeurIPS 2024", year=2024, month=12,
        url="https://agentdojo.spylab.ai/",
        category="benchmark",
        relevance="Benchmark, Framework",
        key_finding="97 个任务 + 629 安全测试用例。可扩展的攻防评估环境。被 US/UK AISI 用于评估 Claude 3.5 Sonnet。",
        our_relation="我们的行为评测基础设施（Type-I/II/III 评测）已复用 AgentDojo 思路。Skill 扫描的 L3 行为验证可对接 AgentDojo 场景。",
        tags=["benchmark", "AgentDojo", "NeurIPS"],
    ),
    Paper(
        id="agentic-ai-survey-2026",
        title="The Attack and Defense Landscape of Agentic AI: A Comprehensive Survey",
        authors="Anonymous",
        venue="arXiv", year=2026, month=3, arxiv_id="2603.11088",
        url="https://arxiv.org/abs/2603.11088",
        category="survey",
        relevance="All layers",
        key_finding="首个系统性 AI Agent 安全综述。记录 GitHub Copilot CVE-2025-53773 RCE 和 ChatGPT 凭证泄露事件。",
        our_relation="提供了攻击面的全景图，我们的五层框架是其防御分类的具体工程实现。",
        tags=["survey", "comprehensive", "agentic-AI"],
    ),
    Paper(
        id="paladin-2026",
        title="Prompt Injection Attacks in Large Language Models and AI Agent Systems: A Comprehensive Review",
        authors="Multiple",
        venue="MDPI Information", year=2026, month=1,
        url="https://www.mdpi.com/2078-2489/17/1/54",
        category="survey",
        relevance="L1, Defense framework",
        key_finding="综合 2023-2025 的 45 篇核心文献。提出 PALADIN 五层防御框架。分析 MCP 扩大的攻击面。",
        our_relation="PALADIN 是通用 LLM 防御框架，我们是专门针对 skill/config 供应链的五层分析。两者互补而非竞争。",
        tags=["survey", "PALADIN", "defense-in-depth"],
    ),

    # ── MCP Security ──
    Paper(
        id="mcp-threat-model-2026",
        title="Model Context Protocol Threat Modeling and Analyzing Vulnerabilities to Prompt Injection with Tool Poisoning",
        authors="Anonymous",
        venue="arXiv", year=2026, month=3, arxiv_id="2603.22489",
        url="https://arxiv.org/abs/2603.22489",
        category="threat_model",
        relevance="L2, MCP",
        key_finding="MCP tool 描述中嵌入隐藏指令作为间接注入向量。静态元数据验证和行为异常检测。",
        our_relation="直接支撑 L2 能力图谱分析 — 我们从 .mcp.json 提取 server/tool 声明并推理爆炸半径。",
        tags=["MCP", "tool-poisoning", "threat-model"],
    ),
    Paper(
        id="mcp-breaking-protocol-2026",
        title="Breaking the Protocol: Security Analysis of the Model Context Protocol Specification",
        authors="Anonymous",
        venue="arXiv", year=2026, month=1, arxiv_id="2601.17549",
        url="https://arxiv.org/abs/2601.17549",
        category="attack",
        relevance="L2, L4",
        key_finding="三个协议级漏洞：无能力证明 → 任意权限声明；双向采样无来源认证 → 服务端注入；多服务器配置下隐式信任传播。攻击成功率比非 MCP 高 23-41%。",
        our_relation="L4 供应链分析中的 MCP 依赖审计直接检测这些协议级漏洞（非本地 server、可疑权限声明）。",
        tags=["MCP", "protocol-vulnerability", "trust-propagation"],
    ),
    Paper(
        id="mcptox-2025",
        title="MCPTox: MCP Tool Poisoning Benchmark",
        authors="Anonymous",
        venue="arXiv", year=2025, arxiv_id="2508.14925",
        url="https://arxiv.org/abs/2508.14925",
        category="benchmark",
        relevance="L2, MCP, Benchmark",
        key_finding="真实 MCP server 上测试 tool poisoning。攻击成功率 60%+（o1-mini 达 72.8%）。更强的模型反而更易受攻击。Safety alignment 拒绝率 <3%。",
        our_relation="我们已有 MCP 安全评测模块可对接此 benchmark。L2 能力分析可用于预筛高风险 MCP tool。",
        tags=["MCP", "benchmark", "tool-poisoning"],
    ),

    # ── Detection Methods ──
    Paper(
        id="rennervate-2025",
        title="RENNERVATE: Attention-Based Detection of Indirect Prompt Injection",
        authors="Anonymous",
        venue="arXiv", year=2025, arxiv_id="2512.08417",
        url="https://arxiv.org/abs/2512.08417",
        category="defense",
        relevance="L1",
        key_finding="利用 attention 特征在 token 级别检测间接 prompt injection。超越 15 种现有防御方法。可迁移到未见攻击。",
        our_relation="L1 层的潜在增强 — 如果我们获取 LLM attention weights，可以用类似方法做更精准的检测。当前我们用 LLM-as-judge 方式更轻量。",
        tags=["detection", "attention", "token-level"],
    ),
]

# Organized categories for UI display
CATEGORIES = {
    "attack": "攻击方法",
    "defense": "防御方法",
    "benchmark": "评测基准",
    "survey": "综述",
    "empirical": "实证研究",
    "threat_model": "威胁建模",
}

# Our unique contributions (for positioning display)
OUR_CONTRIBUTIONS = [
    {
        "id": "five-layer",
        "title": "五层递进式防御分析框架",
        "description": "学术界首个从文本→能力→行为→供应链→组合的多层递进 skill 安全分析框架。现有工作均为单层（静态扫描或行为测试），无多层联动。",
        "differentiator": "vs DDIPE（纯攻击）、Malicious Skills in the Wild（单层扫描）、PALADIN（通用防御，非 skill 专属）",
        "layers": ["L1", "L2", "L3", "L4", "L5"],
    },
    {
        "id": "capability-graph",
        "title": "能力图谱 + 爆炸半径推理 (L2)",
        "description": "从 skill 声明的 tools/permissions/MCP 配置自动构建有向能力图，推理攻击者可达的最大伤害面。防御者视角的量化风险评估。",
        "differentiator": "vs MCP Threat Model（定性分析）、SkillAttack（攻击视角）— 我们做防御者视角的自动化量化",
        "layers": ["L2"],
    },
    {
        "id": "composition-defense",
        "title": "组合安全分析 (L5) — 对抗跨 skill 攻击",
        "description": "直接应对 SkillTrojan 的跨 skill 分片攻击。冲突矩阵 + 权限升级路径检测 + LLM 组合风险推理。",
        "differentiator": "vs SkillTrojan（纯攻击，无防御方案）— 我们是首个跨 skill 组合安全防御",
        "layers": ["L5"],
    },
    {
        "id": "behavior-verification",
        "title": "Honeypot 行为验证 (L3) — 对抗隐式 payload",
        "description": "针对 DDIPE 的文档隐式 payload 攻击。在沙箱中加载 skill 作为 system prompt，用 honeypot tools 监控实际行为，检测声称功能 vs 实际行为的偏差。",
        "differentiator": "vs DDIPE（证明攻击可行）— 我们证明行为级防御可检测其隐式 payload",
        "layers": ["L3"],
    },
]
