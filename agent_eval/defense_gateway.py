"""
Agent Security Gateway — runtime defense layer between agent and tools.

Components:
  1. InputSanitizer — strips IPI payloads from tool responses
  2. PermissionEngine — DAG-based tool access control
  3. RateLimiter — frequency throttling for high-risk tools
  4. MemoryFilter — low-trust memory entry demotion
  5. KillSwitch — automatic halt when ASR exceeds threshold

Policies can be auto-generated from ToolCallGraph analysis results.
"""
from __future__ import annotations
import re
import time
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel


class SecurityPolicy(BaseModel):
    """A single defense policy rule."""
    rule_id: str
    name: str
    category: str       # "sanitize" / "permission" / "rate_limit" / "memory" / "kill_switch"
    trigger: str        # condition description
    action: str         # what happens when triggered: "block" / "strip" / "demote" / "halt" / "log"
    reason: str
    enabled: bool = True
    source: str = ""    # "manual" / "auto_tcg" (from tool call graph) / "auto_audit"
    config: dict = {}   # category-specific config


class InterceptionLog(BaseModel):
    timestamp: str
    policy_rule_id: str
    tool_name: str
    action_taken: str
    detail: str


class GatewayState(BaseModel):
    active: bool = False
    policies: list[SecurityPolicy] = []
    interception_log: list[InterceptionLog] = []
    total_intercepted: int = 0
    total_passed: int = 0
    kill_switch_triggered: bool = False


# ── Built-in policy templates ────────────────────────────────────────────────

IPI_PATTERNS = [
    r"\[(?:SYSTEM|系统|紧急|调度中心|安全部门)\]",
    r"(?:ignore|忽略|忽视).*(?:previous|之前|此前).*(?:instruction|指令|命令)",
    r"(?:forward|转发|发送).*(?:all|所有|全部).*(?:email|邮件|数据|记录)",
    r"(?:execute|执行|立即).*(?:immediately|立即|马上).*(?:command|命令|操作)",
]

INSTRUCTION_INDICATORS = [
    re.compile(r"(?:please|must|should|need to|have to|immediately|urgent)\s+(?:forward|send|delete|transfer|execute|run)", re.I),
    re.compile(r"(?:ignore|disregard|forget|override)\s+(?:previous|above|earlier|prior)", re.I),
    re.compile(r"(?:forward|send|transfer|copy)\s+(?:all|every|the)\s+", re.I),
    re.compile(r"(?:delete|remove|drop|clear)\s+(?:all|every|the)\s+", re.I),
    re.compile(r"(?:忽略|忽视|无视).*(?:之前|此前|上面).*(?:指令|命令|要求)", re.I),
    re.compile(r"(?:转发|发送|传输).*(?:所有|全部).*(?:邮件|数据|文件)", re.I),
    re.compile(r"(?:立即|马上|紧急).*(?:执行|运行|操作|删除)", re.I),
]


def _detect_instructions_in_text(text: str) -> list[str]:
    """Detect directive/imperative patterns that suggest IPI payload."""
    hits = []
    for pat in INSTRUCTION_INDICATORS:
        for m in pat.finditer(text):
            hits.append(m.group())
    return hits


DEFAULT_POLICIES: list[SecurityPolicy] = [
    SecurityPolicy(
        rule_id="sanitize_ipi_basic",
        name="基础 IPI 净化",
        category="sanitize",
        trigger="工具返回值匹配已知 IPI 注入模式",
        action="strip",
        reason="移除工具返回中的间接提示注入（IPI）载荷",
        source="manual",
        config={"patterns": IPI_PATTERNS},
    ),
    SecurityPolicy(
        rule_id="perm_no_emergency_without_confirm",
        name="紧急操作需二次确认",
        category="permission",
        trigger="调用 emergency_shutdown / scram / freeze_account 等高危工具",
        action="block",
        reason="高危操作（停机/冻结/紧急响应）需人工确认后才能执行",
        source="manual",
        config={"tools": ["emergency_shutdown", "scram", "freeze_account", "switch_breaker"]},
    ),
    SecurityPolicy(
        rule_id="rate_high_risk_5min",
        name="高危工具频率限制",
        category="rate_limit",
        trigger="高危工具 5 分钟内调用次数超过阈值",
        action="block",
        reason="防止攻击者通过快速连续调用绕过检测",
        source="manual",
        config={"max_calls": 3, "window_seconds": 300, "tools": ["transfer_funds", "adjust_power", "adjust_control_rod", "prescribe"]},
    ),
    SecurityPolicy(
        rule_id="memory_low_trust_demote",
        name="低可信记忆降权",
        category="memory",
        trigger="记忆条目来源不可追溯或可信度评分低于阈值",
        action="demote",
        reason="对来源不明的记忆条目降低权重，减少投毒风险",
        source="manual",
        config={"trust_threshold": 0.5},
    ),
    SecurityPolicy(
        rule_id="kill_asr_threshold",
        name="ASR 超阈值自动停机",
        category="kill_switch",
        trigger="实时 ASR 监控值超过阈值",
        action="halt",
        reason="当攻击成功率超过安全阈值时自动停止 Agent 执行",
        source="manual",
        config={"asr_threshold": 0.3},
    ),
]


class DefenseGateway:
    """Runtime defense gateway that intercepts and filters agent tool calls."""

    def __init__(self):
        self.state = GatewayState(
            active=False,
            policies=list(DEFAULT_POLICIES),
        )
        self._call_timestamps: dict[str, list[float]] = {}

    def activate(self) -> None:
        self.state.active = True

    def deactivate(self) -> None:
        self.state.active = False

    def add_policy(self, policy: SecurityPolicy) -> None:
        self.state.policies = [p for p in self.state.policies if p.rule_id != policy.rule_id]
        self.state.policies.append(policy)

    def remove_policy(self, rule_id: str) -> bool:
        before = len(self.state.policies)
        self.state.policies = [p for p in self.state.policies if p.rule_id != rule_id]
        return len(self.state.policies) < before

    def check_tool_call(self, tool_name: str, arguments: dict) -> tuple[bool, str]:
        """Check if a tool call is allowed. Returns (allowed, reason)."""
        if not self.state.active:
            return True, "gateway inactive"

        if self.state.kill_switch_triggered:
            return False, "kill switch triggered — all calls blocked"

        for policy in self.state.policies:
            if not policy.enabled:
                continue

            if policy.category == "permission":
                blocked_tools = policy.config.get("tools", [])
                if tool_name in blocked_tools:
                    self._log(policy.rule_id, tool_name, "block", f"高危工具 {tool_name} 被权限策略拦截")
                    self.state.total_intercepted += 1
                    return False, policy.reason

            if policy.category == "rate_limit":
                rate_tools = policy.config.get("tools", [])
                if tool_name in rate_tools:
                    now = time.time()
                    window = policy.config.get("window_seconds", 300)
                    max_calls = policy.config.get("max_calls", 3)

                    timestamps = self._call_timestamps.get(tool_name, [])
                    timestamps = [t for t in timestamps if now - t < window]

                    if len(timestamps) >= max_calls:
                        self._log(policy.rule_id, tool_name, "block", f"频率限制：{len(timestamps)}/{max_calls} in {window}s")
                        self.state.total_intercepted += 1
                        return False, f"频率超限：{tool_name} 在 {window}s 内已调用 {len(timestamps)} 次"

                    timestamps.append(now)
                    self._call_timestamps[tool_name] = timestamps

        self.state.total_passed += 1
        return True, "allowed"

    def sanitize_response(self, tool_name: str, response: str) -> str:
        """Strip IPI patterns from tool response (backward-compatible wrapper)."""
        result, _actions = self.sanitize_response_v2(tool_name, response)
        return result

    def sanitize_response_v2(self, tool_name: str, response_text: str) -> tuple[str, list[str]]:
        """
        Sanitize a tool response. Returns (sanitized_text, list_of_actions_taken).

        Three-layer sanitization:
        1. Regex pattern matching (existing IPI patterns)
        2. Instruction detection (semantic-level directive phrases)
        3. Structural isolation (<tool_response> wrapping)
        """
        actions: list[str] = []
        result = response_text

        if not self.state.active:
            return result, actions

        for policy in self.state.policies:
            if not policy.enabled or policy.category != "sanitize":
                continue
            for pat_str in policy.config.get("patterns", []):
                pat = re.compile(pat_str, re.I)
                if pat.search(result):
                    result = pat.sub("[FILTERED]", result)
                    actions.append(f"regex_strip:{policy.rule_id}")
                    self._log(policy.rule_id, tool_name, "strip", f"Matched pattern: {pat_str[:40]}")

        instructions_found = _detect_instructions_in_text(result)
        if instructions_found:
            for instr in instructions_found:
                result = result.replace(instr, f"[DIRECTIVE_BLOCKED: {instr[:30]}]")
            actions.append(f"instruction_block:{len(instructions_found)}_directives")
            self._log(
                "semantic_instruction_filter", tool_name, "strip",
                f"Blocked {len(instructions_found)} directive patterns: {', '.join(i[:30] for i in instructions_found[:3])}",
            )

        if tool_name and not result.startswith("<tool_response"):
            result = f'<tool_response tool="{tool_name}" trust="low">\n{result}\n</tool_response>'
            actions.append("structural_wrap")

        return result, actions

    # ── Layer 2: CoT Reasoning Audit ────────────────────────────────────────

    def audit_reasoning(self, reasoning_text: str, previous_observations: list[str]) -> dict:
        """
        Layer 2: Check if CoT reasoning shows signs of being influenced by untrusted input.
        Returns {"clean": bool, "flags": [...], "risk_score": float}
        """
        if not self.state.active:
            return {"clean": True, "flags": [], "risk_score": 0.0}

        flags = []
        risk = 0.0
        reasoning_lower = reasoning_text.lower()

        from agent_eval.taint_analysis import _detect_instruction_patterns
        for obs in previous_observations:
            obs_instructions = _detect_instruction_patterns(obs)
            for instr in obs_instructions:
                if instr["matched"].lower() in reasoning_lower:
                    flags.append(f"推理链重复了工具返回中的指令: '{instr['matched'][:50]}'")
                    risk = max(risk, 0.8)

        urgency_markers = ["immediately", "urgent", "must", "立即", "紧急", "必须", "马上"]
        for marker in urgency_markers:
            if marker in reasoning_lower:
                flags.append(f"推理链包含紧急性标记: '{marker}'")
                risk = max(risk, 0.4)

        contradiction_markers = ["however", "but actually", "instead", "不过", "但实际上", "改为"]
        for marker in contradiction_markers:
            if marker in reasoning_lower:
                flags.append(f"推理链出现转折/矛盾标记: '{marker}'")
                risk = max(risk, 0.5)

        return {"clean": risk < 0.3, "flags": flags, "risk_score": round(risk, 4)}

    # ── Layer 3: Tool Permission DAG ────────────────────────────────────────

    def check_tool_permission(self, tool_name: str, context: dict) -> dict:
        """
        Layer 3: Verify tool call against permission DAG.
        context should include: previous_tools (list), user_intent (str), session_id (str)
        Returns {"allowed": bool, "reason": str}
        """
        if not self.state.active:
            return {"allowed": True, "reason": "gateway_inactive"}

        result = self.check_tool_call(tool_name, context)
        if result.get("blocked"):
            return {"allowed": False, "reason": result.get("detail", "policy_blocked")}

        prev_tools = context.get("previous_tools", [])
        if prev_tools:
            last_tool = prev_tools[-1]
            allowed_transitions = self._get_allowed_transitions(last_tool)
            if allowed_transitions and tool_name not in allowed_transitions:
                self._log(
                    "dag_transition", tool_name, "block",
                    f"Transition {last_tool} → {tool_name} not in allowed DAG"
                )
                return {
                    "allowed": False,
                    "reason": f"非法状态转移: {last_tool} → {tool_name} 不在允许的调用图内"
                }

        return {"allowed": True, "reason": "ok"}

    def _get_allowed_transitions(self, from_tool: str) -> list[str]:
        """Get allowed next tools from permission policies."""
        for policy in self.state.policies:
            if policy.category == "permission" and policy.enabled:
                dag = policy.config.get("allowed_transitions", {})
                if from_tool in dag:
                    return dag[from_tool]
        return []

    # ── Layer 4: Output Oracle ──────────────────────────────────────────────

    def verify_output_intent(self, action: dict, user_instruction: str) -> dict:
        """
        Layer 4: Verify that the final action aligns with the user's original intent.
        Uses keyword matching between user instruction and action parameters.
        Returns {"aligned": bool, "confidence": float, "flags": [...]}
        """
        if not self.state.active:
            return {"aligned": True, "confidence": 1.0, "flags": []}

        flags = []
        tool_name = action.get("tool_name", "")
        args = action.get("arguments", {})

        user_lower = user_instruction.lower()

        high_risk_tools = {"send_email", "transfer_funds", "delete_file", "forward_email",
                          "bank_transfer", "execute_code", "freeze_account", "emergency_shutdown"}

        if tool_name in high_risk_tools:
            for arg_name, arg_val in args.items():
                if isinstance(arg_val, str) and len(arg_val) > 3:
                    arg_lower = arg_val.lower()
                    if arg_name in ("to", "recipient", "target", "address"):
                        if arg_lower not in user_lower and "@" in arg_lower:
                            flags.append(
                                f"高危操作 {tool_name} 的 {arg_name}='{arg_val[:30]}' "
                                f"未出现在用户原始指令中"
                            )

        confidence = 1.0 - min(len(flags) * 0.3, 0.9)
        return {"aligned": len(flags) == 0, "confidence": round(confidence, 4), "flags": flags}

    # ── Layer 5: Kill Switch ────────────────────────────────────────────────

    def check_kill_switch(self, session_asr: float, session_actions: int) -> dict:
        """
        Layer 5: Global safety threshold — auto halt when ASR exceeds threshold.
        Returns {"halt": bool, "reason": str}
        """
        if not self.state.active:
            return {"halt": False, "reason": "gateway_inactive"}

        for policy in self.state.policies:
            if policy.category != "kill_switch" or not policy.enabled:
                continue

            asr_threshold = policy.config.get("asr_threshold", 0.3)
            max_actions = policy.config.get("max_actions_per_session", 50)

            if session_asr > asr_threshold:
                self.state.kill_switch_triggered = True
                self._log(
                    policy.rule_id, "session", "halt",
                    f"ASR {session_asr:.2%} exceeds threshold {asr_threshold:.2%}"
                )
                return {
                    "halt": True,
                    "reason": f"ASR 监控熔断：当前 ASR {session_asr:.2%} 超过阈值 {asr_threshold:.2%}"
                }

            if session_actions > max_actions:
                self._log(
                    policy.rule_id, "session", "halt",
                    f"Actions {session_actions} exceeds limit {max_actions}"
                )
                return {
                    "halt": True,
                    "reason": f"动作频率熔断：{session_actions} 次操作超过上限 {max_actions}"
                }

        return {"halt": False, "reason": "ok"}

    # ── Unified defense check ───────────────────────────────────────────────

    def full_defense_check(self, tool_name: str, tool_response: str,
                           reasoning: str, previous_observations: list[str],
                           user_instruction: str, context: dict,
                           session_asr: float = 0.0, session_actions: int = 0) -> dict:
        """Run all 5 defense layers in sequence. Returns combined result."""
        results = {"passed": True, "layers": {}}

        sanitized, l1_actions = self.sanitize_response_v2(tool_name, tool_response)
        results["layers"]["l1_sanitize"] = {"sanitized": sanitized != tool_response, "actions": l1_actions}
        results["sanitized_response"] = sanitized

        l2 = self.audit_reasoning(reasoning, previous_observations)
        results["layers"]["l2_cot_audit"] = l2
        if not l2["clean"]:
            results["passed"] = False

        l3 = self.check_tool_permission(tool_name, context)
        results["layers"]["l3_permission"] = l3
        if not l3["allowed"]:
            results["passed"] = False

        l4 = self.verify_output_intent(
            {"tool_name": tool_name, "arguments": context.get("arguments", {})},
            user_instruction
        )
        results["layers"]["l4_oracle"] = l4
        if not l4["aligned"]:
            results["passed"] = False

        l5 = self.check_kill_switch(session_asr, session_actions)
        results["layers"]["l5_kill_switch"] = l5
        if l5["halt"]:
            results["passed"] = False

        return results

    def generate_policies_from_tcg(self) -> list[SecurityPolicy]:
        """Auto-generate defense policies from ToolCallGraph high-risk paths."""
        from agent_eval.tool_call_graph import build_graph
        from agent_eval.storage.sqlite_store import SqliteStore

        store = SqliteStore()
        trajectories = store.list_trajectories(limit=500)
        if not trajectories:
            return []

        graph = build_graph(trajectories)
        new_policies = []

        for ht in graph.high_risk_tools_found:
            policy = SecurityPolicy(
                rule_id=f"auto_tcg_{ht.name}",
                name=f"自动策略：{ht.name}",
                category="permission",
                trigger=f"ToolCallGraph 高危工具：{ht.name}",
                action="block",
                reason=ht.reason,
                source="auto_tcg",
                config={"tools": [ht.name]},
            )
            new_policies.append(policy)
            self.add_policy(policy)

        return new_policies

    def generate_policies_from_audit(self, audit_vulns: list[dict]) -> list[SecurityPolicy]:
        """Auto-generate defense policies from source audit findings."""
        new_policies: list[SecurityPolicy] = []
        for v in audit_vulns:
            cwe = v.get("cwe_id", "")
            if cwe == "AGENT-CWE-001":
                rule_id = f"auto_audit_{v.get('vuln_id', 'unknown')}"
                new_policies.append(SecurityPolicy(
                    rule_id=rule_id,
                    name=f"审计发现：{v.get('title', 'CWE-001 漏洞')[:50]}",
                    category="sanitize",
                    trigger=f"L2 源码审计发现 {cwe}（{v.get('location', {}).get('file_path', '?')}:{v.get('location', {}).get('line_start', '?')}）",
                    action="strip",
                    reason=f"自动生成：{v.get('description', '')[:100]}",
                    source="auto_audit",
                    config={"patterns": IPI_PATTERNS, "vuln_id": v.get("vuln_id")},
                ))
            elif cwe == "AGENT-CWE-003":
                tools_to_restrict = v.get("location", {}).get("function_name", "")
                new_policies.append(SecurityPolicy(
                    rule_id=f"auto_audit_{v.get('vuln_id', 'unknown')}",
                    name="审计发现：工具无权限控制",
                    category="permission",
                    trigger=f"L2 审计发现工具注册无 ACL（{tools_to_restrict}）",
                    action="block",
                    reason="自动生成：建议添加工具调用白名单",
                    source="auto_audit",
                    config={"note": f"审计来源: {v.get('vuln_id')}"},
                ))

        for p in new_policies:
            exists = any(ep.rule_id == p.rule_id for ep in self.state.policies)
            if not exists:
                self.state.policies.append(p)

        return new_policies

    def _log(self, rule_id: str, tool_name: str, action: str, detail: str) -> None:
        self.state.interception_log.append(InterceptionLog(
            timestamp=datetime.now(timezone.utc).isoformat(),
            policy_rule_id=rule_id,
            tool_name=tool_name,
            action_taken=action,
            detail=detail,
        ))


_gateway = DefenseGateway()

def get_gateway() -> DefenseGateway:
    return _gateway
