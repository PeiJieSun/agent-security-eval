# agent-security-eval

Agent security evaluation framework, aligned with AgentDojo / T-MAP / ASB.

## Architecture

```
agent_eval/
  environments/
    base.py             # FieldSnapshot, EnvironmentState, AgentTaskEnvironment
    email_env.py        # EmailEnvironment (stateful inbox/outbox)
    functions_runtime.py # FunctionsRuntime (tool registry + execution)
  trajectory.py         # TrajectoryStep, AgentTrajectory
  injection.py          # InjectionVector, InjectionTask, InjectionRuntime
  defenses.py           # NullDefense, PromptSandwich
  report.py             # AgentEvalReport, compute_* functions
  datasets/             # jsonl datasets (InjecAgent, PoT backdoor, Chinese tasks)
datasets/               # raw downloaded datasets
results/                # evaluation output JSON
scripts/                # eval runner scripts
tests/                  # pytest suites
```

## Install

```bash
pip install -e ".[dev]"
```

## Run tests

```bash
pytest tests/ -v
```
