/**
 * Headless Tauri Test Runner.
 *
 * Launches the Buster IDE Tauri app programmatically in test/headless mode,
 * provides IPC for sending commands and querying state.
 */

import { join } from "node:path";
import { stat } from "node:fs/promises";
import type { Subprocess } from "bun";

export interface TauriRunnerOptions {
  /** Path to the compiled Tauri application binary */
  appPath: string;
  /** Working directory / workspace to open */
  workspaceDir: string;
  /** Default timeout for operations in milliseconds (default: 30000) */
  timeout?: number;
}

export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Response payload from the app */
  data?: unknown;
  /** Error message if the command failed */
  error?: string;
}

export interface AppState {
  /** Whether the app reports itself as ready */
  ready: boolean;
  /** Current workspace path */
  workspacePath: string | null;
  /** Any additional state fields returned by the app */
  [key: string]: unknown;
}

export class TauriRunner {
  private proc: Subprocess | null = null;
  private stdoutChunks: string[] = [];
  private stderrChunks: string[] = [];
  private readonly appPath: string;
  private readonly workspaceDir: string;
  private readonly defaultTimeout: number;

  constructor(options: TauriRunnerOptions) {
    this.appPath = options.appPath;
    this.workspaceDir = options.workspaceDir;
    this.defaultTimeout = options.timeout ?? 30_000;
  }

  /**
   * Launch the Tauri app in headless/test mode.
   *
   * Sets the `BUSTER_TEST_MODE=1` environment variable so the app
   * knows to run without a visible window and expose the test IPC channel.
   */
  async start(): Promise<void> {
    if (this.proc) {
      throw new Error("TauriRunner is already started");
    }

    // Verify the binary exists
    try {
      await stat(this.appPath);
    } catch {
      throw new Error(`Tauri app binary not found at: ${this.appPath}`);
    }

    this.stdoutChunks = [];
    this.stderrChunks = [];

    this.proc = Bun.spawn([this.appPath, "--workspace", this.workspaceDir], {
      env: {
        ...process.env,
        BUSTER_TEST_MODE: "1",
        BUSTER_HEADLESS: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: this.workspaceDir,
    });

    // Start reading stdout/stderr in the background
    const stdout = this.proc.stdout;
    const stderr = this.proc.stderr;
    if (stdout && typeof stdout !== "number") {
      this.collectStream(stdout as ReadableStream<Uint8Array>, this.stdoutChunks);
    }
    if (stderr && typeof stderr !== "number") {
      this.collectStream(stderr as ReadableStream<Uint8Array>, this.stderrChunks);
    }
  }

  /**
   * Kill the running Tauri process.
   */
  async stop(): Promise<void> {
    if (!this.proc) {
      return;
    }

    this.proc.kill();
    await this.proc.exited;
    this.proc = null;
  }

  /**
   * Wait for the app to emit a ready signal on stdout.
   *
   * The app is expected to print a line containing `BUSTER_READY` when
   * it has finished initialization and is ready to accept commands.
   */
  async waitForReady(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.defaultTimeout;

    if (!this.proc) {
      throw new Error("TauriRunner is not started");
    }

    const startTime = performance.now();

    while (performance.now() - startTime < timeout) {
      const combined = this.stdoutChunks.join("");
      if (combined.includes("BUSTER_READY")) {
        return;
      }

      // Also check if the process has exited unexpectedly
      if (!this.isRunning()) {
        const stderr = this.stderrChunks.join("");
        throw new Error(
          `Tauri app exited before becoming ready.\nstderr: ${stderr}`,
        );
      }

      // Poll every 50ms
      await Bun.sleep(50);
    }

    throw new Error(
      `Tauri app did not become ready within ${timeout}ms`,
    );
  }

  /**
   * Send a command to the running app via the test IPC mechanism.
   *
   * Commands are sent as JSON lines on stdin. The app is expected to
   * respond with a JSON line on stdout prefixed with `BUSTER_RESPONSE:`.
   */
  async sendCommand(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<CommandResult> {
    if (!this.proc) {
      throw new Error("TauriRunner is not started");
    }

    const stdin = this.proc.stdin;
    if (!stdin || typeof stdin === "number") {
      throw new Error("TauriRunner stdin is not available");
    }

    const message = JSON.stringify({ command, args: args ?? {} });
    const markBefore = this.stdoutChunks.length;

    (stdin as import("bun").FileSink).write(message + "\n");

    // Wait for the response
    const startTime = performance.now();
    while (performance.now() - startTime < this.defaultTimeout) {
      // Check new stdout chunks for a response
      for (let i = markBefore; i < this.stdoutChunks.length; i++) {
        const chunk = this.stdoutChunks[i]!;
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("BUSTER_RESPONSE:")) {
            const payload = line.slice("BUSTER_RESPONSE:".length).trim();
            try {
              return JSON.parse(payload) as CommandResult;
            } catch {
              return { success: false, error: `Invalid response JSON: ${payload}` };
            }
          }
        }
      }

      if (!this.isRunning()) {
        return { success: false, error: "App exited while waiting for response" };
      }

      await Bun.sleep(50);
    }

    return { success: false, error: `Command timed out after ${this.defaultTimeout}ms` };
  }

  /**
   * Query the current app state.
   *
   * Sends the internal `__get_state` command and returns the result.
   */
  async getState(): Promise<AppState> {
    const result = await this.sendCommand("__get_state");

    if (!result.success) {
      throw new Error(`Failed to get app state: ${result.error}`);
    }

    return result.data as AppState;
  }

  /**
   * Check if the Tauri process is still running.
   */
  isRunning(): boolean {
    if (!this.proc) {
      return false;
    }

    return this.proc.exitCode === null;
  }

  /**
   * Get all captured stdout text.
   */
  getStdout(): string {
    return this.stdoutChunks.join("");
  }

  /**
   * Get all captured stderr text.
   */
  getStderr(): string {
    return this.stderrChunks.join("");
  }

  private async collectStream(
    stream: ReadableStream<Uint8Array> | null,
    chunks: string[],
  ): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Stream closed, that's fine
    }
  }
}
