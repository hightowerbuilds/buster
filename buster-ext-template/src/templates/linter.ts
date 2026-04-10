/**
 * Linter extension template scaffold.
 *
 * Generates a project with lint_document() entry point that returns diagnostics.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateLinter(dir: string, name: string): Promise<void> {
  const srcDir = join(dir, "src");
  await mkdir(srcDir, { recursive: true });

  const crateName = name.replace(/-/g, "_");

  // extension.toml
  await writeFile(
    join(dir, "extension.toml"),
    `[extension]
id = "${name}"
name = "${name}"
version = "0.1.0"
description = "A Buster linter extension"
entry = "target/wasm32-unknown-unknown/release/${crateName}.wasm"

[capabilities]
read_files = true
write_files = false
list_directories = true
run_commands = false
network = false

[extension.provides]
type = "diagnostics"
file_types = ["*.rs", "*.ts"]
`,
  );

  // Cargo.toml
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
    join(dir, "src/lib.rs"),
    `use buster_ext_sdk::{log_info, read_file, set_return, serde_json};

/// Lint a document and return diagnostic results.
///
/// The host passes the file path as the first argument.
/// Return an array of diagnostics via set_return.
#[no_mangle]
pub extern "C" fn lint_document() {
    log_info("${name}: lint_document called");

    match read_file("__input__") {
        Ok(source) => {
            let mut diagnostics = Vec::<serde_json::Value>::new();

            // TODO: implement linting logic
            // Example diagnostic:
            for (i, line) in source.lines().enumerate() {
                if line.len() > 120 {
                    diagnostics.push(serde_json::json!({
                        "line": i + 1,
                        "column": 121,
                        "severity": "warning",
                        "message": "Line exceeds 120 characters",
                        "code": "line-too-long",
                    }));
                }
            }

            set_return(&serde_json::json!({
                "diagnostics": diagnostics,
            }));
        }
        Err(e) => {
            set_return(&serde_json::json!({ "error": e }));
        }
    }
}
`,
  );

  // .gitignore
  await writeFile(join(dir, ".gitignore"), "target/\n");
}
