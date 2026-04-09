/**
 * `buster-ext build` — Build the extension WASM binary.
 *
 * Wraps `cargo build --target wasm32-unknown-unknown --release`.
 */

export async function build(_args: string[]): Promise<void> {
  console.log("Building extension...");

  const proc = Bun.spawn(
    ["cargo", "build", "--target", "wasm32-unknown-unknown", "--release"],
    {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Build failed with exit code ${exitCode}`);
  }

  console.log("Build complete.");
}
