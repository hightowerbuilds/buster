/**
 * Cross-Platform CI Configuration Generator.
 *
 * Generates GitHub Actions workflow YAML for running the Buster IDE
 * test suite across multiple platforms.
 */

/** Supported CI platforms */
export type Platform = "ubuntu-latest" | "macos-latest" | "windows-latest";

/** Options for CI configuration generation */
export interface CIOptions {
  /** Target platforms to run on */
  platforms: Platform[];
  /** Node.js version (used for some tooling) */
  nodeVersion: string;
  /** Bun version */
  bunVersion: string;
  /** Rust toolchain version (e.g., "stable", "1.78.0") */
  rustToolchain: string;
  /** Test suites to run (default: ["unit", "integration", "e2e"]) */
  testSuites?: string[];
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Whether to enable caching (default: true) */
  caching?: boolean;
  /** Workflow name (default: "Buster IDE Tests") */
  workflowName?: string;
  /** Branch triggers (default: ["main", "develop"]) */
  branches?: string[];
}

/**
 * Generate a GitHub Actions workflow YAML string.
 *
 * Creates a matrix strategy with each platform x each test suite,
 * with steps for checking out code, installing Bun, installing Rust,
 * installing dependencies, and running tests.
 */
export function generateGitHubActions(options: CIOptions): string {
  const {
    platforms,
    nodeVersion,
    bunVersion,
    rustToolchain,
    testSuites = ["unit", "integration", "e2e"],
    env = {},
    caching = true,
    workflowName = "Buster IDE Tests",
    branches = ["main", "develop"],
  } = options;

  if (platforms.length === 0) {
    throw new Error("At least one platform must be specified");
  }

  if (testSuites.length === 0) {
    throw new Error("At least one test suite must be specified");
  }

  const lines: string[] = [];

  // Header
  lines.push(`name: ${workflowName}`);
  lines.push("");
  lines.push("on:");
  lines.push("  push:");
  lines.push("    branches:");
  for (const branch of branches) {
    lines.push(`      - ${branch}`);
  }
  lines.push("  pull_request:");
  lines.push("    branches:");
  for (const branch of branches) {
    lines.push(`      - ${branch}`);
  }
  lines.push("");

  // Environment variables
  if (Object.keys(env).length > 0) {
    lines.push("env:");
    for (const [key, value] of Object.entries(env)) {
      lines.push(`  ${key}: ${yamlQuote(value)}`);
    }
    lines.push("");
  }

  // Jobs
  lines.push("jobs:");
  lines.push("  test:");
  lines.push(`    name: \${{ matrix.os }} - \${{ matrix.suite }}`);
  lines.push("    runs-on: ${{ matrix.os }}");
  lines.push("    strategy:");
  lines.push("      fail-fast: false");
  lines.push("      matrix:");

  // OS matrix
  lines.push("        os:");
  for (const platform of platforms) {
    lines.push(`          - ${platform}`);
  }

  // Suite matrix
  lines.push("        suite:");
  for (const suite of testSuites) {
    lines.push(`          - ${suite}`);
  }

  lines.push("");
  lines.push("    steps:");

  // Checkout
  lines.push("      - name: Checkout repository");
  lines.push("        uses: actions/checkout@v4");
  lines.push("");

  // Install Bun
  lines.push("      - name: Install Bun");
  lines.push("        uses: oven-sh/setup-bun@v2");
  lines.push("        with:");
  lines.push(`          bun-version: ${yamlQuote(bunVersion)}`);
  lines.push("");

  // Install Node (some tooling may need it)
  lines.push("      - name: Setup Node.js");
  lines.push("        uses: actions/setup-node@v4");
  lines.push("        with:");
  lines.push(`          node-version: ${yamlQuote(nodeVersion)}`);
  lines.push("");

  // Install Rust
  lines.push("      - name: Install Rust toolchain");
  lines.push("        uses: dtolnay/rust-toolchain@master");
  lines.push("        with:");
  lines.push(`          toolchain: ${rustToolchain}`);
  lines.push("");

  // Caching
  if (caching) {
    lines.push("      - name: Cache Rust artifacts");
    lines.push("        uses: actions/cache@v4");
    lines.push("        with:");
    lines.push("          path: |");
    lines.push("            ~/.cargo/registry");
    lines.push("            ~/.cargo/git");
    lines.push("            target");
    lines.push("          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}");
    lines.push("          restore-keys: |");
    lines.push("            ${{ runner.os }}-cargo-");
    lines.push("");

    lines.push("      - name: Cache Bun dependencies");
    lines.push("        uses: actions/cache@v4");
    lines.push("        with:");
    lines.push("          path: ~/.bun/install/cache");
    lines.push("          key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb') }}");
    lines.push("          restore-keys: |");
    lines.push("            ${{ runner.os }}-bun-");
    lines.push("");
  }

  // System dependencies (Linux only)
  lines.push("      - name: Install system dependencies (Linux)");
  lines.push("        if: runner.os == 'Linux'");
  lines.push("        run: |");
  lines.push("          sudo apt-get update");
  lines.push("          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf");
  lines.push("");

  // Install deps
  lines.push("      - name: Install dependencies");
  lines.push("        run: bun install");
  lines.push("");

  // Build (needed before tests)
  lines.push("      - name: Build");
  lines.push("        run: bun run build");
  lines.push("");

  // Run tests
  lines.push("      - name: Run ${{ matrix.suite }} tests");
  lines.push("        run: bun test --filter ${{ matrix.suite }}");
  lines.push("        env:");
  lines.push("          CI: \"true\"");
  lines.push(`          RUST_TOOLCHAIN: ${yamlQuote(rustToolchain)}`);

  return lines.join("\n") + "\n";
}

/**
 * Quote a string for YAML if it contains special characters.
 */
function yamlQuote(value: string): string {
  if (
    value.includes(":") ||
    value.includes("#") ||
    value.includes("'") ||
    value.includes('"') ||
    value.includes("{") ||
    value.includes("}") ||
    value.includes("[") ||
    value.includes("]") ||
    value.includes(",") ||
    value.includes("&") ||
    value.includes("*") ||
    value.includes("?") ||
    value.includes("|") ||
    value.includes(">") ||
    value.includes("!") ||
    value.includes("%") ||
    value.includes("@") ||
    value.includes("`") ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    /^\d+\.\d+$/.test(value)
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}
