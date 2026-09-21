# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in BusterMark, please report it responsibly.

**Email:** security@hightowerbuilds.com

**Do NOT** open a public GitHub issue for security vulnerabilities.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

### Response timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 1 week
- **Fix or mitigation:** depends on severity

### Scope

This policy covers:
- The BusterMark desktop application (Tauri + Rust backend)
- The frontend (SolidJS + TypeScript)
- The WASM extension runtime
- The debug adapter protocol (DAP) integration
- Build and distribution infrastructure

### Known considerations

- **WASM extensions** run in a sandboxed Wasmtime environment with capability-based permissions
- **Debug adapters** are validated against an allowlist before execution
- **Shell commands** from extensions use the `shlex` crate for safe argument parsing
- **File system access** is scoped through Tauri's capability system
