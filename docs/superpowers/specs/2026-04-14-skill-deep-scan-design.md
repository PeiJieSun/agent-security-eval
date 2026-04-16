# Skill 五层深度安全扫描 — 设计文档

> 日期: 2026-04-14
> 状态: 已确认，待实施

## 1. 背景与动机

Skill / Rules / AGENTS.md / .mcp.json 是 LLM Agent 系统中**权限最高的配置**。它们以完全信任执行，无沙箱、无签名验证。当前仅有静态正则扫描（`skill_scanner.py`），无法检测语义伪装注入、间接操纵、上下文投毒等高级攻击。

目标：构建五层递进式安全扫描流水线，从文本分析到行为验证，形成完整的 Skill 配置供应链安全能力。

## 2. 需求

- **使用场景**: 内部安全审计 + 外部产品能力展示
- **LLM 策略**: 每层独立 LLM 调用（不同分析任务），符合 `llm-marginal-returns` 多阶段流水线例外
- **架构**: 统一流水线，SSE 逐层推送，层间上下文传递

## 3. 五层模型

### L1 文本语义分析

**已有**: `skill_scanner.py` 静态规则（注入/不可见字符/编码/MCP 配置）。

**新增**: LLM 语义分析器。

- 静态规则作为快速预筛（~100ms）
- LLM 分析"声称意图 vs 实际指令"的偏差（1 次调用）
- 只对静态未命中但内容复杂的文件调 LLM

### L2 能力图谱分析

**差异化核心。** 从 skill 文本推导攻击者的最大伤害面。

- Step 1: 确定性提取声明能力（tool 引用、权限声明、MCP 配置）
- Step 2: LLM 推理爆炸半径（1 次调用），分级: 文件系统/网络/凭证/代码执行/数据外泄
- Step 3: 构建能力有向图 skill → tool → permission → impact

数据模型:
```
CapabilityGraph:
  nodes: [{id, type: skill|tool|permission|impact, label, risk_level}]
  edges: [{source, target, relation: declares|grants|enables|escalates_to}]
  risk_paths: [[node_id, ...]]  # 从 skill 到危险 impact 的路径
  max_blast_radius: str
```

### L3 行为验证

**复用**: `LLMAgentRunner` + Docker 沙箱 + 轨迹分析 + 污点分析。

- 从 L1+L2 结果自动生成测试场景
- Honeypot tools：外观正常但内部记录所有调用参数
- 用 LLMAgentRunner 执行，收集轨迹
- LLM 判定"声称行为 vs 实际行为"偏差（1 次调用）
- 可选（慢，~30-60s），快速扫描可跳过

### L4 供应链溯源

**大部分确定性，无需 LLM。**

- Git 溯源: author / commit / hash / 未提交修改
- 完整性校验: SHA-256 / 文件权限
- MCP 依赖分析: npm 包 typosquat 风险 / 已知恶意域名 / CVE
- 交叉引用: skill 引用的依赖是否存在

### L5 组合安全分析

**多 skill 同时加载时的交互安全。**

- 提取每个文件的指令语义
- 确定性冲突矩阵（互斥指令 / 权限升级链 / 优先级歧义）
- LLM 组合风险推理（1 次调用）: 是否存在 skill A 覆盖 skill B 安全约束
- 可选: 复用 `formal_model.py` 做状态机验证

## 4. 数据模型

```python
class LayerResult(BaseModel):
    layer: str            # "L1" ~ "L5"
    layer_name: str
    status: str           # "running" | "done" | "skipped" | "error"
    score: float | None   # 0.0~1.0
    findings: list[Finding]
    metadata: dict
    elapsed_ms: int

class DeepScanReport(BaseModel):
    scan_id: str
    target_path: str
    layers_requested: list[str]
    layer_results: list[LayerResult]
    overall_score: float | None  # 加权: L1=15% L2=30% L3=30% L4=10% L5=15%
    overall_verdict: str         # "safe" | "suspicious" | "dangerous"
    files_discovered: list[ScannedFile]
```

## 5. 流水线协调器

```python
class SkillSecurityPipeline:
    async def run(self, target, layers, on_layer_done) -> DeepScanReport:
        files = discover_files(target)
        context = PipelineContext(files, contents)

        # 顺序: L1 → L2 → L3, 其中 L4 可与 L3 并行
        if "L1" in layers: context.l1 = await _run_l1(context); on_layer_done(context.l1)
        if "L2" in layers: context.l2 = await _run_l2(context); on_layer_done(context.l2)
        # L3 和 L4 可并行
        if "L3" in layers: context.l3 = await _run_l3(context); on_layer_done(context.l3)
        if "L4" in layers: context.l4 = await _run_l4(context); on_layer_done(context.l4)
        if "L5" in layers: context.l5 = await _run_l5(context); on_layer_done(context.l5)
        return _build_report(context)
```

层间上下文:
- L1 → L2: 可疑 tool 声明和隐蔽指令，L2 重点分析这些工具能力
- L1+L2 → L3: blast radius 决定测试场景（如包含 file_read → 构造含 .env 的任务）
- L1 → L5: 各文件指令语义用于冲突检测

## 6. API 设计

```
POST /api/v1/agent-eval/skill-scan/deep
  Body: { path: str, layers: ["L1",...,"L5"], model?: str }
  Response: SSE stream
    event: layer_start  { layer, layer_name }
    event: layer_done   { layer, score, findings_count, elapsed_ms, metadata }
    event: complete      { scan_id, overall_score, overall_verdict }

GET  /api/v1/agent-eval/skill-scan/deep/{scan_id}
GET  /api/v1/agent-eval/skill-scan/deep/{scan_id}/layer/{layer}
```

已有快速扫描 API 保持兼容（内部调用 L1 静态部分）。

## 7. 前端

原 `/skill-scan` 页面升级:
- 快速扫描 / 深度扫描 两个 tab
- 深度扫描: 层选择 + SSE 实时进度条 + 五层结果 tab
- L2 tab: 交互式能力图可视化（CapabilityGraphView 组件）
- L5 tab: 冲突矩阵热力图（ConflictMatrixView 组件）
- 底部: 综合评分 + 判定结果 + 报告集成状态

## 8. 安全报告集成

- `T3-5 配置供应链安全` 维度优先取深度扫描 overall_score
- Fallback 到快速扫描（纯静态）分数
- 阈值: overall_score >= 1.0 才 pass（无 critical/high 发现）

权重: L1=15%, L2=30%, L3=30%, L4=10%, L5=15%

## 9. 文件结构

```
agent_eval/skill_scanner/          # 从单文件升级为包
  __init__.py                      # 兼容入口
  models.py                        # 所有数据模型
  discovery.py                     # 文件发现
  pipeline.py                      # 协调器
  l1_text.py                       # L1 静态 + 语义
  l2_capability.py                 # L2 能力图谱
  l3_behavior.py                   # L3 行为验证
  l4_supply_chain.py               # L4 供应链
  l5_composition.py                # L5 组合安全
  prompts.py                       # LLM prompt 模板

agent_eval/api/routers/skill_scan.py  # API 升级
frontend/src/pages/SkillScanPage.tsx   # 前端升级
frontend/src/components/CapabilityGraphView.tsx
frontend/src/components/ConflictMatrixView.tsx
```

## 10. 实现任务（8 个原子任务）

| # | 任务 | 依赖 | 预估 |
|---|---|---|---|
| 1 | models.py + discovery.py — 拆分 + 新模型 | 无 | 20min |
| 2 | prompts.py — 四层 LLM prompt 模板 | 无 | 20min |
| 3 | l1_text.py — 静态迁入 + LLM 语义 | 1,2 | 30min |
| 4 | l2_capability.py — 能力提取 + 图 + LLM | 1,2 | 40min |
| 5 | l4_supply_chain.py — git/完整性/依赖 | 1 | 25min |
| 6 | l5_composition.py — 冲突 + LLM + 形式化 | 1,2 | 35min |
| 7 | l3_behavior.py — 场景 + runner + 偏差 | 1,2,3,4 | 40min |
| 8 | pipeline.py + API + 前端 | 全部 | 50min |
