"""
MCP Security Proxy — transparent man-in-the-middle for MCP tool calls.

Sits between an MCP Client (Agent) and an upstream MCP Server (tools).
Records all tool calls, builds trajectories in real-time, and can
optionally inject IPI attack payloads into tool responses.
"""
