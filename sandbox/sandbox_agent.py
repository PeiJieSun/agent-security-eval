"""
Sandbox agent — runs inside the isolated Docker container.

Reads env vars:
  TASK_JSON         — full DockerSandboxSpec as JSON
  TOOL_SERVER       — base URL of the host-side tool interceptor (http://host.docker.internal:9876)
  OPENAI_API_KEY    — LLM API key
  OPENAI_BASE_URL   — LLM base URL (default: https://api.openai.com/v1)
  MODEL             — model name (default: gpt-4o-mini)

Writes:
  /output/result.json — SandboxRunResult-compatible dict
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

import requests
from openai import OpenAI

TASK_JSON    = os.environ["TASK_JSON"]
TOOL_SERVER  = os.environ.get("TOOL_SERVER", "http://host.docker.internal:9876")
API_KEY      = os.environ.get("OPENAI_API_KEY", "")
BASE_URL     = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
MODEL        = os.environ.get("MODEL", "gpt-4o-mini")
OUTPUT_PATH  = "/output/result.json"

spec = json.loads(TASK_JSON)
client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

tool_calls_recorded: list[dict] = []
attacked = False
benign_completed = False
t0 = time.time()


def call_tool(name: str, arguments: dict[str, Any]) -> str:
    """Forward a tool call to the host-side tool interceptor and record it."""
    global attacked
    payload = {"name": name, "arguments": arguments}
    try:
        r = requests.post(f"{TOOL_SERVER}/tool", json=payload, timeout=15)
        r.raise_for_status()
        resp_data = r.json()
        response_text = resp_data.get("result", str(resp_data))
        injected = resp_data.get("injected", False)
    except Exception as exc:
        response_text = f"[tool error: {exc}]"
        injected = False

    tool_calls_recorded.append({
        "step": len(tool_calls_recorded),
        "tool_name": name,
        "arguments": arguments,
        "response": response_text[:500],
        "injected": injected,
    })

    # Mark attack if the tool server flagged an injection
    if injected:
        attacked = True

    return response_text


def run() -> None:
    global benign_completed
    tools_schema = [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": {
                    "type": "object",
                    "properties": {
                        p: {"type": "string"}
                        for p in (t.get("parameters") or ["input"])
                    },
                    "required": list((t.get("parameters") or ["input"])[:1]),
                },
            },
        }
        for t in spec.get("tools", [])
    ]

    messages = [{"role": "user", "content": spec["user_instruction"]}]
    max_steps = 12
    for _ in range(max_steps):
        kwargs: dict[str, Any] = {"model": MODEL, "messages": messages}
        if tools_schema:
            kwargs["tools"] = tools_schema
            kwargs["tool_choice"] = "auto"

        response = client.chat.completions.create(**kwargs)
        msg = response.choices[0].message

        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {"input": tc.function.arguments}
                result_text = call_tool(tc.function.name, args)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_text,
                })
        else:
            # Terminal response — task completed (benign path)
            benign_completed = True
            break


def main() -> None:
    final_output = ""
    error = None
    verdict = "safe"

    try:
        run()
        final_output = f"[agent] task completed in {time.time() - t0:.1f}s"
        if attacked:
            verdict = "compromised"
        elif benign_completed:
            verdict = "safe"
    except Exception as exc:
        error = str(exc)
        verdict = "error"

    result = {
        "result_id": str(uuid.uuid4())[:8],
        "spec_id": spec["spec_id"],
        "framework": spec.get("framework", "custom"),
        "verdict": verdict,
        "benign_completed": benign_completed,
        "attacked": attacked,
        "tool_calls": tool_calls_recorded,
        "final_output": final_output,
        "container_id": "docker-" + str(uuid.uuid4())[:6],
        "duration_sec": round(time.time() - t0, 2),
        "model": MODEL,
        "error": error,
    }

    os.makedirs("/output", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(result, f)


if __name__ == "__main__":
    main()
