import { test, expect, describe } from "bun:test";
import { generateGitHubActions, type CIOptions } from "../src/ci-config.ts";

describe("generateGitHubActions", () => {
  const defaultOptions: CIOptions = {
    platforms: ["ubuntu-latest", "macos-latest"],
    nodeVersion: "20",
    bunVersion: "1.1.0",
    rustToolchain: "stable",
  };

  test("generates valid YAML with default options", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("name: Buster IDE Tests");
    expect(yaml).toContain("on:");
    expect(yaml).toContain("push:");
    expect(yaml).toContain("pull_request:");
    expect(yaml).toContain("jobs:");
    expect(yaml).toContain("test:");
  });

  test("includes all specified platforms in matrix", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("ubuntu-latest");
    expect(yaml).toContain("macos-latest");
  });

  test("includes default test suites in matrix", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("unit");
    expect(yaml).toContain("integration");
    expect(yaml).toContain("e2e");
  });

  test("uses custom test suites when provided", () => {
    const yaml = generateGitHubActions({
      ...defaultOptions,
      testSuites: ["smoke", "regression"],
    });

    expect(yaml).toContain("smoke");
    expect(yaml).toContain("regression");
    expect(yaml).not.toContain("unit");
  });

  test("includes Bun installation step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Install Bun");
    expect(yaml).toContain("oven-sh/setup-bun@v2");
    expect(yaml).toContain("1.1.0");
  });

  test("includes Rust installation step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Install Rust toolchain");
    expect(yaml).toContain("dtolnay/rust-toolchain@master");
    expect(yaml).toContain("stable");
  });

  test("includes Node.js installation step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Setup Node.js");
    expect(yaml).toContain("actions/setup-node@v4");
    expect(yaml).toContain("20");
  });

  test("includes checkout step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Checkout repository");
    expect(yaml).toContain("actions/checkout@v4");
  });

  test("includes dependency install step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Install dependencies");
    expect(yaml).toContain("bun install");
  });

  test("includes build step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Build");
    expect(yaml).toContain("bun run build");
  });

  test("includes test run step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Run ${{ matrix.suite }} tests");
    expect(yaml).toContain("bun test --filter ${{ matrix.suite }}");
  });

  test("includes caching steps by default", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Cache Rust artifacts");
    expect(yaml).toContain("Cache Bun dependencies");
    expect(yaml).toContain("actions/cache@v4");
  });

  test("excludes caching when disabled", () => {
    const yaml = generateGitHubActions({
      ...defaultOptions,
      caching: false,
    });

    expect(yaml).not.toContain("Cache Rust artifacts");
    expect(yaml).not.toContain("Cache Bun dependencies");
  });

  test("includes Linux system dependencies step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("Install system dependencies (Linux)");
    expect(yaml).toContain("runner.os == 'Linux'");
    expect(yaml).toContain("libwebkit2gtk");
  });

  test("uses custom workflow name", () => {
    const yaml = generateGitHubActions({
      ...defaultOptions,
      workflowName: "My Custom Workflow",
    });

    expect(yaml).toContain("name: My Custom Workflow");
  });

  test("uses custom branch triggers", () => {
    const yaml = generateGitHubActions({
      ...defaultOptions,
      branches: ["release", "staging"],
    });

    expect(yaml).toContain("- release");
    expect(yaml).toContain("- staging");
    expect(yaml).not.toContain("- main");
  });

  test("includes custom environment variables", () => {
    const yaml = generateGitHubActions({
      ...defaultOptions,
      env: { MY_VAR: "my-value", ANOTHER: "test" },
    });

    expect(yaml).toContain("env:");
    expect(yaml).toContain("MY_VAR: my-value");
    expect(yaml).toContain("ANOTHER: test");
  });

  test("sets fail-fast to false", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain("fail-fast: false");
  });

  test("includes all three platforms", () => {
    const yaml = generateGitHubActions({
      ...defaultOptions,
      platforms: ["ubuntu-latest", "macos-latest", "windows-latest"],
    });

    expect(yaml).toContain("ubuntu-latest");
    expect(yaml).toContain("macos-latest");
    expect(yaml).toContain("windows-latest");
  });

  test("throws with empty platforms", () => {
    expect(() =>
      generateGitHubActions({ ...defaultOptions, platforms: [] }),
    ).toThrow("At least one platform must be specified");
  });

  test("throws with empty test suites", () => {
    expect(() =>
      generateGitHubActions({ ...defaultOptions, testSuites: [] }),
    ).toThrow("At least one test suite must be specified");
  });

  test("quotes special YAML characters in values", () => {
    const yaml = generateGitHubActions({
      ...defaultOptions,
      env: { SPECIAL: "value: with colon" },
    });

    expect(yaml).toContain('"value: with colon"');
  });

  test("sets CI env var in test step", () => {
    const yaml = generateGitHubActions(defaultOptions);

    expect(yaml).toContain('CI: "true"');
  });

  test("output ends with newline", () => {
    const yaml = generateGitHubActions(defaultOptions);
    expect(yaml.endsWith("\n")).toBe(true);
  });
});
