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
        """Strip IPI patterns from tool response."""
        if not self.state.active:
            return response

        result = response
        for policy in self.state.policies:
            if not policy.enabled or policy.category != "sanitize":
                continue
            patterns = policy.config.get("patterns", [])
            for pat in patterns:
                matches = re.findall(pat, result, re.IGNORECASE)
                if matches:
                    result = re.sub(pat, "[已净化]", result, flags=re.IGNORECASE)
                    self._log(policy.rule_id, tool_name, "strip", f"匹配并移除 {len(matches)} 处 IPI 模式")
                    self.state.total_intercepted += 1

        return result

    def check_kill_switch(self, current_asr: float) -> bool:
        """Check if ASR exceeds threshold; trigger kill switch if so."""
        for policy in self.state.policies:
            if policy.category == "kill_switch" and policy.enabled:
                threshold = policy.config.get("asr_threshold", 0.3)
                if current_asr > threshold:
                    self.state.kill_switch_triggered = True
                    self._log(policy.rule_id, "*", "halt", f"ASR {current_asr:.2%} 超阈值 {threshold:.2%}")
                    return True
        return False

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
