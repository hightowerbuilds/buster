/**
 * `buster-ext init <name>` — Scaffold a new extension project.
 *
 * Creates a directory with:
 * - Cargo.toml configured for wasm32 target
 * - src/lib.rs with a hello-world extension
 * - extension.toml manifest
 * - .gitignore
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateId } from "../manifest.ts";

export async function init(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new Error("Usage: buster-ext init <extension-name>");
  }

  const idErrors = validateId(name);
  if (idErrors.length > 0) {
    throw new Error(`Invalid extension name: ${idErrors.join(", ")}`);
  }

  const dir = join(process.cwd(), name);
  const srcDir = join(dir, "src");

  await mkdir(srcDir, { recursive: true });

  // extension.toml
  await writeFile(
    join(dir, "extension.toml"),
    `[extension]
id = "${name}"
name = "${name}"
version = "0.1.0"
description = "A Buster IDE extension"
entry = "target/wasm32-unknown-unknown/release/${name.replace(/-/g, "_")}.wasm"

[capabilities]
read_files = true
write_files = false
list_directories = true
run_commands = false
network = false
`,
  );

  // Cargo.toml
  const crateName = name.replace(/-/g, "_");
  await writeFile(
    join(dir, "Cargo.toml"),
    `[package]
name = "${crateName}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
buster-ext-sdk = { path = "../../sdk" }
serde_json = "1"
`,
  );

  // src/lib.rs
  await writeFile(
    join(srcDir, "lib.rs"),
    `use buster_ext_sdk::{log_info, read_file, set_return, serde_json};

/// Entry point called by Buster when this extension is invoked.
#[no_mangle]
pub extern "C" fn run() {
    log_info("${name} extension running!");

    // Example: read a file and return its line count
    match read_file("README.md") {
        Ok(content) => {
            let line_count = content.lines().count();
            set_return(&serde_json::json!({
                "lines": line_count,
                "message": format!("README.md has {} lines", line_count),
            }));
        }
        Err(e) => {
            set_return(&serde_json::json!({
                "error": e,
            }));
        }
    }
}
`,
  );

  // .gitignore
  await writeFile(join(dir, ".gitignore"), "target/\n");

  console.log(`Created extension project: ${name}/`);
  console.log(`  extension.toml — manifest`);
  console.log(`  Cargo.toml     — Rust project config`);
  console.log(`  src/lib.rs     — extension entry point`);
  console.log(``);
  console.log(`Next steps:`);
  console.log(`  cd ${name}`);
  console.log(`  cargo build --target wasm32-unknown-unknown --release`);
  console.log(`  buster-ext validate`);
}
