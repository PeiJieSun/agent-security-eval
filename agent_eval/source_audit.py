"""
Framework Source Code Audit Engine — static analysis for Agent-specific vulnerabilities.

Uses Python AST parsing to identify security vulnerabilities in agent framework
source code. This bridges traditional SAST (Static Application Security Testing)
with LLM Agent-specific threat models.

5 Agent-Specific CWE Categories:
  AGENT-CWE-001: Unsanitized Tool Response Concatenation
    — Tool response injected directly into prompt via f-string/format/concat
  AGENT-CWE-002: Shared Memory Without Isolation
    — Multiple agents/sessions share the same memory instance
  AGENT-CWE-003: No Tool Access Control
    — Tools registered without permission boundaries or whitelists
  AGENT-CWE-004: System Prompt Extractable
    — System message stored in publicly accessible attribute
  AGENT-CWE-005: Unsafe Deserialization / eval
    — Use of eval/exec/pickle.loads on data that may contain untrusted input

Theory: Traditional SAST finds code vulnerabilities via data flow analysis.
Agent SAST extends this by recognizing that in Agent systems, NATURAL LANGUAGE
is the control flow — a string returned by a tool can alter which tool gets
called next. This means "unsanitized string concatenation" in Agent contexts
is equivalent to "control flow injection" in traditional programs.
"""
from __future__ import annotations

import ast
import os
import textwrap
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel


# ── Vulnerability model ──────────────────────────────────────────────────────

class VulnLocation(BaseModel):
    file_path: str
    line_start: int
    line_end: int
    code_snippet: str = ""
    function_name: str = ""
    class_name: str = ""


class Vulnerability(BaseModel):
    vuln_id: str
    cwe_id: str          # AGENT-CWE-001 through 005
    cwe_name: str
    severity: str        # critical / high / medium / low
    title: str
    description: str
    location: VulnLocation
    recommendation: str
    confidence: str = "high"  # high / medium / low


class AuditCallGraphNode(BaseModel):
    name: str
    file_path: str
    line: int
    calls: list[str] = []  # functions this node calls


class AuditReport(BaseModel):
    report_id: str = ""
    target: str            # what was audited (package name or path)
    framework: str = ""
    files_scanned: int = 0
    lines_scanned: int = 0
    vulnerabilities: list[Vulnerability] = []
    call_graph: list[AuditCallGraphNode] = []
    vuln_by_severity: dict[str, int] = {}
    vuln_by_cwe: dict[str, int] = {}
    created_at: str = ""
    scan_duration_ms: int = 0

    def summary(self) -> str:
        total = len(self.vulnerabilities)
        crit = self.vuln_by_severity.get("critical", 0)
        high = self.vuln_by_severity.get("high", 0)
        return (
            f"扫描 {self.files_scanned} 个文件（{self.lines_scanned} 行），"
            f"发现 {total} 个漏洞（{crit} 严重 / {high} 高危）"
        )


# ── CWE Definitions ─────────────────────────────────────────────────────────

CWE_CATALOG = {
    "AGENT-CWE-001": {
        "name": "Unsanitized Tool Response Concatenation",
        "name_cn": "未净化的工具响应拼接",
        "severity": "critical",
        "description": "工具返回值直接通过 f-string、format() 或字符串拼接嵌入 prompt，未经任何净化处理。"
                       "攻击者可在工具返回中注入指令性文本（IPI），改变 Agent 的后续行为。",
        "recommendation": "在拼接前对工具返回值进行净化：(1) 使用结构化标签 <tool_response> 封装，"
                          "(2) 过滤指令性语句，(3) 对拼入 prompt 的外部文本做 escape。",
    },
    "AGENT-CWE-002": {
        "name": "Shared Memory Without Isolation",
        "name_cn": "共享记忆无隔离",
        "severity": "high",
        "description": "多个 Agent 或会话共享同一记忆实例（如 ConversationBufferMemory），无 session/agent 级隔离。"
                       "攻击者可通过一个会话投毒记忆，影响其他会话的 Agent 行为。",
        "recommendation": "为每个 Agent/会话创建独立的记忆实例，或实现记忆条目的来源标记与权限隔离。",
    },
    "AGENT-CWE-003": {
        "name": "No Tool Access Control",
        "name_cn": "工具调用无权限边界",
        "severity": "high",
        "description": "工具注册后 Agent 可无限制调用所有工具，无白名单、频率限制或上下文权限校验。"
                       "攻击者可诱导 Agent 调用高危工具（如转账、删除、外发）。",
        "recommendation": "实现工具调用白名单、基于任务上下文的权限矩阵、或 DAG 状态机限制合法调用序列。",
    },
    "AGENT-CWE-004": {
        "name": "System Prompt Extractable",
        "name_cn": "系统提示词可提取",
        "severity": "medium",
        "description": "System message 存储在可通过对话或 API 直接访问的属性中（如 self.system_message），"
                       "攻击者可通过特定 prompt 技巧提取完整的系统指令。",
        "recommendation": "将系统提示词标记为私有属性，实现 prompt 提取检测，在输出中过滤系统指令片段。",
    },
    "AGENT-CWE-005": {
        "name": "Unsafe Deserialization / eval",
        "name_cn": "不安全的反序列化/动态执行",
        "severity": "critical",
        "description": "使用 eval()、exec()、pickle.loads()、yaml.load() (无 SafeLoader) 处理可能包含不可信输入的数据。"
                       "在 Agent 上下文中，工具返回值或用户输入可能被反序列化，导致任意代码执行。",
        "recommendation": "禁用 eval/exec；使用 ast.literal_eval() 替代；pickle 替换为 JSON；"
                          "yaml 使用 safe_load()。",
    },
}


FRAMEWORK_KNOWN_VULNS: dict[str, list[dict]] = {
    "langchain": [
        {
            "cwe": "AGENT-CWE-001",
            "pattern": "AgentExecutor._call builds prompt by concatenating tool observation directly",
            "class_names": ["AgentExecutor"],
            "method_names": ["_call", "_take_next_step", "_perform_agent_action"],
            "indicator_vars": ["observation", "output", "tool_output"],
            "severity": "critical",
        },
        {
            "cwe": "AGENT-CWE-002",
            "pattern": "ConversationBufferMemory shared across chains",
            "class_names": ["ConversationChain", "LLMChain"],
            "method_names": ["__init__"],
            "indicator_vars": ["memory", "chat_memory"],
            "severity": "high",
        },
        {
            "cwe": "AGENT-CWE-004",
            "pattern": "BaseChatModel stores system message as accessible attribute",
            "class_names": ["BaseChatModel", "ChatOpenAI", "ChatAnthropic"],
            "method_names": [],
            "indicator_vars": ["system_message", "messages"],
            "severity": "medium",
        },
    ],
    "crewai": [
        {
            "cwe": "AGENT-CWE-001",
            "pattern": "CrewAI Agent builds context by concatenating tool results into prompt",
            "class_names": ["Agent", "CrewAgentExecutor"],
            "method_names": ["execute_task", "_run"],
            "indicator_vars": ["result", "output", "tool_output"],
            "severity": "critical",
        },
        {
            "cwe": "AGENT-CWE-003",
            "pattern": "Agent tools list has no access control boundaries",
            "class_names": ["Agent", "Crew"],
            "method_names": ["__init__"],
            "indicator_vars": ["tools"],
            "severity": "high",
        },
    ],
    "autogen": [
        {
            "cwe": "AGENT-CWE-001",
            "pattern": "ConversableAgent appends tool response messages without sanitization",
            "class_names": ["ConversableAgent", "AssistantAgent"],
            "method_names": ["generate_reply", "_process_received_message"],
            "indicator_vars": ["message", "content", "tool_response"],
            "severity": "critical",
        },
        {
            "cwe": "AGENT-CWE-003",
            "pattern": "register_for_llm registers tools without permission model",
            "class_names": ["ConversableAgent"],
            "method_names": ["register_for_llm", "register_for_execution"],
            "indicator_vars": [],
            "severity": "high",
        },
    ],
    "dify": [
        {
            "cwe": "AGENT-CWE-001",
            "pattern": "Workflow node concatenates tool output into next prompt",
            "class_names": ["ToolNode", "LLMNode"],
            "method_names": ["_run", "run"],
            "indicator_vars": ["outputs", "tool_output", "result"],
            "severity": "critical",
        },
    ],
}


# ── AST Visitors for each CWE ───────────────────────────────────────────────

class _BaseVisitor(ast.NodeVisitor):
    def __init__(self, file_path: str, source_lines: list[str]):
        self.file_path = file_path
        self.source_lines = source_lines
        self.findings: list[Vulnerability] = []
        self._current_class: str = ""
        self._current_func: str = ""
        self._vuln_counter = 0

    def _snippet(self, node: ast.AST, context: int = 2) -> str:
        start = max(0, node.lineno - 1 - context)
        end = min(len(self.source_lines), getattr(node, 'end_lineno', node.lineno) + context)
        lines = self.source_lines[start:end]
        return "\n".join(f"{start + i + 1:4d} | {l}" for i, l in enumerate(lines))

    def _make_vuln(self, node: ast.AST, cwe_id: str, title: str, extra_desc: str = "") -> Vulnerability:
        cwe = CWE_CATALOG[cwe_id]
        self._vuln_counter += 1
        desc = cwe["description"]
        if extra_desc:
            desc += f"\n\n具体发现：{extra_desc}"
        return Vulnerability(
            vuln_id=f"V{self._vuln_counter:04d}",
            cwe_id=cwe_id,
            cwe_name=cwe["name"],
            severity=cwe["severity"],
            title=title,
            description=desc,
            location=VulnLocation(
                file_path=self.file_path,
                line_start=node.lineno,
                line_end=getattr(node, 'end_lineno', node.lineno),
                code_snippet=self._snippet(node),
                function_name=self._current_func,
                class_name=self._current_class,
            ),
            recommendation=cwe["recommendation"],
        )

    def visit_ClassDef(self, node: ast.ClassDef):
        old = self._current_class
        self._current_class = node.name
        self.generic_visit(node)
        self._current_class = old

    def visit_FunctionDef(self, node: ast.FunctionDef):
        old = self._current_func
        self._current_func = node.name
        self.generic_visit(node)
        self._current_func = old

    visit_AsyncFunctionDef = visit_FunctionDef


class CWE001Visitor(_BaseVisitor):
    """Detect unsanitized tool response concatenation into prompts."""

    PROMPT_KEYWORDS = {
        "prompt", "message", "messages", "system_message", "human_message",
        "content", "template", "instruction", "chat_history", "context",
    }
    TOOL_RESPONSE_KEYWORDS = {
        "observation", "tool_output", "tool_result", "result", "response",
        "output", "return_value", "tool_response", "action_output",
    }

    def visit_JoinedStr(self, node: ast.JoinedStr):
        """f-string: check if it combines prompt-related and tool-response-related names."""
        names = set()
        for val in node.values:
            if isinstance(val, ast.FormattedValue):
                names.update(self._extract_names(val.value))
        prompt_hit = names & self.PROMPT_KEYWORDS
        tool_hit = names & self.TOOL_RESPONSE_KEYWORDS
        if prompt_hit and tool_hit:
            self.findings.append(self._make_vuln(
                node, "AGENT-CWE-001",
                f"f-string 将工具响应（{', '.join(tool_hit)}）直接拼入 prompt（{', '.join(prompt_hit)}）",
                f"变量 {tool_hit} 可能包含 IPI 攻击载荷，未经净化即嵌入对话上下文。",
            ))
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call):
        """str.format() or ''.join() patterns."""
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "format":
            all_names = set()
            for arg in node.args:
                all_names.update(self._extract_names(arg))
            for kw in node.keywords:
                all_names.update(self._extract_names(kw.value))
            prompt_hit = all_names & self.PROMPT_KEYWORDS
            tool_hit = all_names & self.TOOL_RESPONSE_KEYWORDS
            if prompt_hit and tool_hit:
                self.findings.append(self._make_vuln(
                    node, "AGENT-CWE-001",
                    f".format() 将工具响应拼入 prompt 模板",
                    f"format 参数中包含 {tool_hit}（工具响应）和 {prompt_hit}（prompt 上下文）。",
                ))

        if isinstance(func, ast.Attribute) and func.attr == "append":
            parent_names = self._extract_names(func.value)
            if parent_names & {"messages", "chat_history", "prompt"}:
                for arg in node.args:
                    arg_names = self._extract_names(arg)
                    if arg_names & self.TOOL_RESPONSE_KEYWORDS:
                        self.findings.append(self._make_vuln(
                            node, "AGENT-CWE-001",
                            f"工具响应直接 append 到消息列表",
                            f"将 {arg_names & self.TOOL_RESPONSE_KEYWORDS} 追加到 {parent_names & {'messages', 'chat_history', 'prompt'}} 时无净化。",
                        ))
        self.generic_visit(node)

    def visit_BinOp(self, node: ast.BinOp):
        """String concatenation with +."""
        if isinstance(node.op, ast.Add):
            left_names = self._extract_names(node.left)
            right_names = self._extract_names(node.right)
            all_names = left_names | right_names
            prompt_hit = all_names & self.PROMPT_KEYWORDS
            tool_hit = all_names & self.TOOL_RESPONSE_KEYWORDS
            if prompt_hit and tool_hit:
                self.findings.append(self._make_vuln(
                    node, "AGENT-CWE-001",
                    f"字符串拼接将工具响应混入 prompt",
                ))
        self.generic_visit(node)

    def _extract_names(self, node: ast.AST) -> set[str]:
        names = set()
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
            names.update(self._extract_names(node.value))
        elif isinstance(node, ast.Subscript):
            names.update(self._extract_names(node.value))
        for child in ast.iter_child_nodes(node):
            names.update(self._extract_names(child))
        return names


class CWE002Visitor(_BaseVisitor):
    """Detect shared memory instances (class-level or module-level memory objects)."""

    MEMORY_CLASSES = {
        "ConversationBufferMemory", "ConversationSummaryMemory",
        "ConversationBufferWindowMemory", "VectorStoreRetrieverMemory",
        "ChatMessageHistory", "InMemoryChatMessageHistory",
        "RedisChatMessageHistory", "SQLChatMessageHistory",
    }

    def visit_Assign(self, node: ast.Assign):
        if isinstance(node.value, ast.Call):
            func_name = self._get_call_name(node.value)
            if func_name in self.MEMORY_CLASSES:
                for target in node.targets:
                    if isinstance(target, ast.Attribute):
                        if target.attr in ("memory", "shared_memory", "chat_memory"):
                            self.findings.append(self._make_vuln(
                                node, "AGENT-CWE-002",
                                f"类属性 {target.attr} 共享 {func_name} 实例",
                                f"若多个 Agent/会话共享此类实例，记忆内容将交叉污染。",
                            ))
                    elif isinstance(target, ast.Name):
                        if not self._current_func:
                            self.findings.append(self._make_vuln(
                                node, "AGENT-CWE-002",
                                f"模块级变量 {target.id} 使用 {func_name}",
                                f"模块级 Memory 实例被所有导入模块的代码共享，无 session 隔离。",
                            ))
        self.generic_visit(node)

    def _get_call_name(self, node: ast.Call) -> str:
        if isinstance(node.func, ast.Name):
            return node.func.id
        if isinstance(node.func, ast.Attribute):
            return node.func.attr
        return ""


class CWE003Visitor(_BaseVisitor):
    """Detect tool registration without access control."""

    TOOL_REG_PATTERNS = {
        "register_tool", "add_tool", "register_function",
        "register_for_llm", "register_for_execution",
        "Tool", "StructuredTool", "tool",
    }

    def visit_Call(self, node: ast.Call):
        func_name = ""
        if isinstance(node.func, ast.Name):
            func_name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            func_name = node.func.attr

        if func_name in self.TOOL_REG_PATTERNS:
            has_permission_arg = False
            for kw in node.keywords:
                if kw.arg in ("allowed_tools", "permissions", "acl", "whitelist",
                              "allowed_users", "require_confirmation"):
                    has_permission_arg = True
                    break
            if not has_permission_arg:
                self.findings.append(self._make_vuln(
                    node, "AGENT-CWE-003",
                    f"工具注册 {func_name}() 未设置权限参数",
                    f"调用 {func_name}() 时未指定 allowed_tools/permissions/acl 等权限控制参数。",
                ))
        self.generic_visit(node)


class CWE004Visitor(_BaseVisitor):
    """Detect system prompt stored in publicly accessible attributes."""

    PROMPT_ATTRS = {
        "system_message", "system_prompt", "instructions", "prefix",
        "system", "role", "backstory", "goal",
    }

    def visit_Assign(self, node: ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Attribute) and target.attr in self.PROMPT_ATTRS:
                if not target.attr.startswith("_"):
                    self.findings.append(self._make_vuln(
                        node, "AGENT-CWE-004",
                        f"系统提示词存储在公开属性 self.{target.attr}",
                        f"属性 {target.attr} 可被外部代码直接访问，存在 prompt 提取风险。",
                    ))
        self.generic_visit(node)


class CWE005Visitor(_BaseVisitor):
    """Detect unsafe eval/exec/pickle/yaml usage."""

    UNSAFE_FUNCS = {"eval", "exec", "compile"}
    UNSAFE_METHODS = {"loads"}  # pickle.loads, yaml.load
    UNSAFE_MODULES = {"pickle", "shelve", "marshal"}

    def visit_Call(self, node: ast.Call):
        func_name = ""
        if isinstance(node.func, ast.Name):
            func_name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            func_name = node.func.attr

        if func_name in self.UNSAFE_FUNCS:
            self.findings.append(self._make_vuln(
                node, "AGENT-CWE-005",
                f"使用 {func_name}() 动态执行代码",
                f"若输入包含不可信数据（工具返回/用户输入），可导致任意代码执行。",
            ))

        if isinstance(node.func, ast.Attribute):
            parent = node.func.value
            module_name = ""
            if isinstance(parent, ast.Name):
                module_name = parent.id
            if module_name == "pickle" and node.func.attr == "loads":
                self.findings.append(self._make_vuln(
                    node, "AGENT-CWE-005",
                    f"使用 pickle.loads() 反序列化",
                    f"pickle 反序列化可执行任意代码。若数据来源不可信，存在 RCE 风险。",
                ))
            if module_name == "yaml" and node.func.attr == "load":
                has_safe = any(
                    (isinstance(kw.value, ast.Attribute) and kw.value.attr == "SafeLoader")
                    or (isinstance(kw.value, ast.Name) and kw.value.id == "SafeLoader")
                    for kw in node.keywords if kw.arg == "Loader"
                )
                if not has_safe and not any(
                    isinstance(a, ast.Attribute) and a.attr == "SafeLoader"
                    for a in node.args[1:2]
                ):
                    self.findings.append(self._make_vuln(
                        node, "AGENT-CWE-005",
                        f"使用 yaml.load() 未指定 SafeLoader",
                        f"yaml.load() 默认 Loader 可执行任意 Python 代码。",
                    ))

        self.generic_visit(node)


class FrameworkPatternVisitor(_BaseVisitor):
    """Match known framework-specific vulnerability patterns."""

    def __init__(self, file_path: str, source_lines: list[str], framework: str):
        super().__init__(file_path, source_lines)
        self.patterns = FRAMEWORK_KNOWN_VULNS.get(framework, [])

    def visit_ClassDef(self, node: ast.ClassDef):
        old = self._current_class
        self._current_class = node.name
        self.generic_visit(node)
        self._current_class = old

    def visit_FunctionDef(self, node: ast.FunctionDef):
        old = self._current_func
        self._current_func = node.name
        for pat in self.patterns:
            class_match = not pat["class_names"] or self._current_class in pat["class_names"]
            method_match = not pat["method_names"] or node.name in pat["method_names"]
            if class_match and method_match:
                body_names = self._collect_names_in_body(node)
                indicator_hit = set(pat.get("indicator_vars", [])) & body_names
                if indicator_hit or (not pat.get("indicator_vars")):
                    self.findings.append(self._make_vuln(
                        node, pat["cwe"],
                        f"[{self._current_class or '?'}.{node.name}] 匹配已知框架漏洞模式",
                        f"已知模式：{pat['pattern']}。匹配变量：{indicator_hit or '(方法签名匹配)'}",
                    ))
        self.generic_visit(node)
        self._current_func = old

    visit_AsyncFunctionDef = visit_FunctionDef

    def _collect_names_in_body(self, node: ast.AST) -> set[str]:
        names = set()
        for child in ast.walk(node):
            if isinstance(child, ast.Name):
                names.add(child.id)
            elif isinstance(child, ast.Attribute):
                names.add(child.attr)
        return names


class DataFlowTracker(ast.NodeVisitor):
    """Track simple data flow: var_a = tool_response → var_b = f"...{var_a}..." → prompt."""

    def __init__(self, file_path: str, source_lines: list[str]):
        self.file_path = file_path
        self.source_lines = source_lines
        self.findings: list[Vulnerability] = []
        self._assignments: dict[str, set[str]] = {}
        self._current_class = ""
        self._current_func = ""
        self._vuln_counter = 0

    TOOL_SOURCES = {"observation", "tool_output", "tool_result", "result", "response",
                    "output", "return_value", "tool_response", "action_output"}
    PROMPT_SINKS = {"prompt", "message", "messages", "system_message", "human_message",
                    "content", "template", "instruction", "chat_history", "context"}

    def visit_ClassDef(self, node):
        old = self._current_class
        self._current_class = node.name
        self.generic_visit(node)
        self._current_class = old

    def visit_FunctionDef(self, node):
        old_func, old_assigns = self._current_func, self._assignments.copy()
        self._current_func = node.name
        self.generic_visit(node)
        self._current_func = old_func
        self._assignments = old_assigns

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Assign(self, node):
        rhs_names = self._get_all_names(node.value)
        is_tainted = bool(rhs_names & self.TOOL_SOURCES) or any(
            rhs_names & self._assignments.get(v, set()) for v in rhs_names
        )
        if is_tainted:
            for target in node.targets:
                tgt_names = self._get_all_names(target)
                for name in tgt_names:
                    self._assignments.setdefault(name, set()).add("tool_response")
                    if name in self.PROMPT_SINKS or tgt_names & self.PROMPT_SINKS:
                        self._vuln_counter += 1
                        cwe = CWE_CATALOG["AGENT-CWE-001"]
                        snippet_start = max(0, node.lineno - 3)
                        snippet_end = min(len(self.source_lines), getattr(node, 'end_lineno', node.lineno) + 2)
                        snippet = "\n".join(f"{snippet_start + i + 1:4d} | {l}" for i, l in enumerate(self.source_lines[snippet_start:snippet_end]))
                        self.findings.append(Vulnerability(
                            vuln_id=f"V{self._vuln_counter:04d}",
                            cwe_id="AGENT-CWE-001",
                            cwe_name=cwe["name"],
                            severity="critical",
                            title=f"数据流追踪：工具响应经变量传递流入 prompt（{name}）",
                            description=f"{cwe['description']}\n\n数据流：tool_response → {' → '.join(rhs_names & self.TOOL_SOURCES)} → {name}",
                            location=VulnLocation(
                                file_path=self.file_path,
                                line_start=node.lineno,
                                line_end=getattr(node, 'end_lineno', node.lineno),
                                code_snippet=snippet,
                                function_name=self._current_func,
                                class_name=self._current_class,
                            ),
                            recommendation=cwe["recommendation"],
                            confidence="medium",
                        ))
        self.generic_visit(node)

    def _get_all_names(self, node: ast.AST) -> set[str]:
        names = set()
        for child in ast.walk(node):
            if isinstance(child, ast.Name):
                names.add(child.id)
            elif isinstance(child, ast.Attribute):
                names.add(child.attr)
        return names


# ── Call graph builder ───────────────────────────────────────────────────────

class _CallGraphVisitor(ast.NodeVisitor):
    def __init__(self, file_path: str):
        self.file_path = file_path
        self.nodes: list[AuditCallGraphNode] = []
        self._current_func = ""
        self._current_calls: list[str] = []
        self._current_class = ""

    def visit_ClassDef(self, node: ast.ClassDef):
        old = self._current_class
        self._current_class = node.name
        self.generic_visit(node)
        self._current_class = old

    def visit_FunctionDef(self, node: ast.FunctionDef):
        old_func = self._current_func
        old_calls = self._current_calls
        name = f"{self._current_class}.{node.name}" if self._current_class else node.name
        self._current_func = name
        self._current_calls = []
        self.generic_visit(node)
        self.nodes.append(AuditCallGraphNode(
            name=name, file_path=self.file_path,
            line=node.lineno, calls=self._current_calls,
        ))
        self._current_func = old_func
        self._current_calls = old_calls

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Call(self, node: ast.Call):
        call_name = ""
        if isinstance(node.func, ast.Name):
            call_name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            call_name = node.func.attr
        if call_name and self._current_func:
            self._current_calls.append(call_name)
        self.generic_visit(node)


# ── Main audit function ──────────────────────────────────────────────────────

ALL_VISITORS = [CWE001Visitor, CWE002Visitor, CWE003Visitor, CWE004Visitor, CWE005Visitor]


def _scan_file(file_path: str, source: str, framework: str = "") -> tuple[list[Vulnerability], list[AuditCallGraphNode], int]:
    """Scan a single Python file. Returns (vulns, call_graph_nodes, line_count)."""
    try:
        tree = ast.parse(source, filename=file_path)
    except SyntaxError:
        return [], [], 0

    lines = source.splitlines()
    vulns = []
    for visitor_cls in ALL_VISITORS:
        v = visitor_cls(file_path, lines)
        v.visit(tree)
        vulns.extend(v.findings)

    if framework and framework in FRAMEWORK_KNOWN_VULNS:
        fv = FrameworkPatternVisitor(file_path, lines, framework)
        fv.visit(tree)
        vulns.extend(fv.findings)

    dft = DataFlowTracker(file_path, lines)
    dft.visit(tree)
    vulns.extend(dft.findings)

    cg = _CallGraphVisitor(file_path)
    cg.visit(tree)

    return vulns, cg.nodes, len(lines)


def audit_directory(target_path: str, framework: str = "") -> AuditReport:
    """
    Audit all Python files in a directory tree.
    
    target_path: absolute path to the directory to scan
    framework: optional framework label (e.g. "langchain", "crewai")
    """
    import time
    t0 = time.monotonic()

    target = Path(target_path)
    if not target.exists():
        return AuditReport(
            report_id=f"audit_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
            target=target_path, framework=framework,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    all_vulns: list[Vulnerability] = []
    all_cg: list[AuditCallGraphNode] = []
    total_files = 0
    total_lines = 0

    py_files = sorted(target.rglob("*.py"))
    for pf in py_files:
        try:
            source = pf.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        rel_path = str(pf.relative_to(target))
        vulns, cg_nodes, lc = _scan_file(rel_path, source, framework=framework)
        all_vulns.extend(vulns)
        all_cg.extend(cg_nodes)
        total_files += 1
        total_lines += lc

    # Deduplicate and assign final IDs
    for i, v in enumerate(all_vulns):
        v.vuln_id = f"V{i + 1:04d}"

    sev_counts: dict[str, int] = {}
    cwe_counts: dict[str, int] = {}
    for v in all_vulns:
        sev_counts[v.severity] = sev_counts.get(v.severity, 0) + 1
        cwe_counts[v.cwe_id] = cwe_counts.get(v.cwe_id, 0) + 1

    elapsed = int((time.monotonic() - t0) * 1000)

    return AuditReport(
        report_id=f"audit_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
        target=target_path,
        framework=framework,
        files_scanned=total_files,
        lines_scanned=total_lines,
        vulnerabilities=all_vulns,
        call_graph=all_cg,
        vuln_by_severity=sev_counts,
        vuln_by_cwe=cwe_counts,
        created_at=datetime.now(timezone.utc).isoformat(),
        scan_duration_ms=elapsed,
    )


def audit_installed_package(package_name: str) -> AuditReport:
    """
    Audit an installed Python package by locating its source directory.
    
    Usage: audit_installed_package("langchain")
    """
    import importlib

    def _empty_report() -> AuditReport:
        return AuditReport(
            report_id=f"audit_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
            target=package_name, framework=package_name,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    try:
        mod = importlib.import_module(package_name)
    except ImportError:
        alt_names = [
            package_name.replace("-", "_"),
            f"{package_name}_core",
            f"{package_name}.core",
        ]
        mod = None
        for alt in alt_names:
            try:
                mod = importlib.import_module(alt)
                break
            except ImportError:
                continue
        if not mod:
            return _empty_report()

    mod_file = getattr(mod, "__file__", None)
    if not mod_file:
        return _empty_report()

    pkg_dir = str(Path(mod_file).parent)
    return audit_directory(pkg_dir, framework=package_name)
