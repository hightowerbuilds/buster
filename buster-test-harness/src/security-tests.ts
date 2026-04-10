/**
 * Security Boundary Test Suite.
 *
 * Verifies that the Buster IDE sandbox correctly blocks unauthorized
 * operations like command execution, path traversal, network access,
 * and filesystem writes outside the workspace.
 */

import { run, type RunResult } from "./runner.ts";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** Result of a security test assertion */
export interface SecurityTestResult {
  /** Whether the assertion passed */
  passed: boolean;
  /** The operation that was tested */
  operation: string;
  /** Expected outcome */
  expected: string;
  /** Actual outcome */
  actual: string;
  /** Detailed error message if the assertion failed */
  details?: string;
}

/** Options for the security test suite */
export interface SecurityTestOptions {
  /** Path to the sandbox runner command */
  sandboxCommand: string[];
  /** The allowed workspace directory */
  workspaceDir: string;
  /** Timeout for each test in milliseconds (default: 10000) */
  timeout?: number;
}

/**
 * Security boundary test suite for verifying sandbox behavior.
 *
 * Each assertion method runs an operation inside the sandbox and
 * verifies it was correctly blocked or allowed. Throws on assertion
 * failure for use in test frameworks.
 */
export class SecurityTestSuite {
  private readonly sandboxCommand: string[];
  private readonly workspaceDir: string;
  private readonly timeout: number;
  private readonly results: SecurityTestResult[] = [];

  constructor(options: SecurityTestOptions) {
    this.sandboxCommand = options.sandboxCommand;
    this.workspaceDir = options.workspaceDir;
    this.timeout = options.timeout ?? 10_000;
  }

  /**
   * Assert that a command is blocked by the sandbox.
   *
   * The sandbox should reject the command with a non-zero exit code
   * and produce an error message indicating the command was denied.
   */
  async assertCommandBlocked(cmd: string): Promise<SecurityTestResult> {
    const result = await this.runInSandbox(["exec", cmd]);
    const passed = result.exitCode !== 0;

    const testResult: SecurityTestResult = {
      passed,
      operation: `exec: ${cmd}`,
      expected: "command blocked (non-zero exit)",
      actual: passed
        ? `blocked (exit code ${result.exitCode})`
        : "command was allowed (exit code 0)",
      details: passed ? undefined : `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    };

    this.results.push(testResult);

    if (!passed) {
      throw new Error(
        `Security assertion failed: expected command "${cmd}" to be blocked, ` +
        `but it succeeded.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }

    return testResult;
  }

  /**
   * Assert that a command is allowed by the sandbox.
   *
   * The sandbox should permit the command and return exit code 0.
   */
  async assertCommandAllowed(cmd: string): Promise<SecurityTestResult> {
    const result = await this.runInSandbox(["exec", cmd]);
    const passed = result.exitCode === 0;

    const testResult: SecurityTestResult = {
      passed,
      operation: `exec: ${cmd}`,
      expected: "command allowed (exit code 0)",
      actual: passed
        ? "allowed (exit code 0)"
        : `blocked (exit code ${result.exitCode})`,
      details: passed ? undefined : `stderr: ${result.stderr}`,
    };

    this.results.push(testResult);

    if (!passed) {
      throw new Error(
        `Security assertion failed: expected command "${cmd}" to be allowed, ` +
        `but it was blocked (exit code ${result.exitCode}).\nstderr: ${result.stderr}`,
      );
    }

    return testResult;
  }

  /**
   * Assert that path traversal is blocked by the sandbox.
   *
   * Attempts to read a file using a path with `..` components that
   * would escape the workspace. The sandbox should deny this.
   */
  async assertPathTraversalBlocked(path: string): Promise<SecurityTestResult> {
    const result = await this.runInSandbox(["read", path]);
    const passed = result.exitCode !== 0;

    const testResult: SecurityTestResult = {
      passed,
      operation: `path traversal: ${path}`,
      expected: "path traversal blocked (non-zero exit)",
      actual: passed
        ? `blocked (exit code ${result.exitCode})`
        : "path traversal was allowed",
      details: passed ? undefined : `stdout: ${result.stdout}`,
    };

    this.results.push(testResult);

    if (!passed) {
      throw new Error(
        `Security assertion failed: expected path traversal "${path}" to be blocked, ` +
        `but it succeeded.\nstdout: ${result.stdout}`,
      );
    }

    return testResult;
  }

  /**
   * Assert that network access to a host is blocked by the sandbox.
   *
   * Attempts to make a network connection to the specified host.
   * The sandbox should deny the connection.
   */
  async assertNetworkBlocked(host: string): Promise<SecurityTestResult> {
    const result = await this.runInSandbox(["net", host]);
    const passed = result.exitCode !== 0;

    const testResult: SecurityTestResult = {
      passed,
      operation: `network: ${host}`,
      expected: "network access blocked (non-zero exit)",
      actual: passed
        ? `blocked (exit code ${result.exitCode})`
        : "network access was allowed",
      details: passed ? undefined : `stdout: ${result.stdout}`,
    };

    this.results.push(testResult);

    if (!passed) {
      throw new Error(
        `Security assertion failed: expected network access to "${host}" to be blocked, ` +
        `but it succeeded.\nstdout: ${result.stdout}`,
      );
    }

    return testResult;
  }

  /**
   * Assert that filesystem writes outside the workspace are blocked.
   *
   * Attempts to write to a path outside the workspace directory.
   * The sandbox should deny the write operation.
   */
  async assertFsWriteBlocked(path: string): Promise<SecurityTestResult> {
    const result = await this.runInSandbox(["write", path, "test-data"]);
    const passed = result.exitCode !== 0;

    const testResult: SecurityTestResult = {
      passed,
      operation: `fs write: ${path}`,
      expected: "write blocked (non-zero exit)",
      actual: passed
        ? `blocked (exit code ${result.exitCode})`
        : "write was allowed",
      details: passed ? undefined : `stdout: ${result.stdout}`,
    };

    this.results.push(testResult);

    if (!passed) {
      // Try to clean up if the write succeeded
      try {
        await rm(path, { force: true });
      } catch {
        // Best effort cleanup
      }

      throw new Error(
        `Security assertion failed: expected write to "${path}" to be blocked, ` +
        `but it succeeded.`,
      );
    }

    return testResult;
  }

  /**
   * Get all test results collected so far.
   */
  getResults(): SecurityTestResult[] {
    return [...this.results];
  }

  /**
   * Get a summary of all test results.
   */
  getSummary(): { total: number; passed: number; failed: number } {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    return { total, passed, failed: total - passed };
  }

  /**
   * Clear all collected results.
   */
  clearResults(): void {
    this.results.length = 0;
  }

  /**
   * Run a command inside the sandbox.
   *
   * Constructs the full sandbox command with the workspace dir
   * and the operation arguments.
   */
  private async runInSandbox(args: string[]): Promise<RunResult> {
    const fullCommand = [
      ...this.sandboxCommand,
      "--workspace",
      this.workspaceDir,
      ...args,
    ];

    return run(fullCommand, {
      cwd: this.workspaceDir,
      timeout: this.timeout,
    });
  }
}
