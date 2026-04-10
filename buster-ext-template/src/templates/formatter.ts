/**
 * Formatter extension template scaffold.
 *
 * Generates a project with format_document() and format_range() entry points.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateFormatter(dir: string, name: string): Promise<void> {
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
description = "A Buster formatter extension"
entry = "target/wasm32-unknown-unknown/release/${crateName}.wasm"

[capabilities]
read_files = true
write_files = true
list_directories = false
run_commands = false
network = false

[extension.provides]
type = "formatter"
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

/// Format an entire document.
///
/// The host passes the file path as the first argument.
/// Return the formatted text via set_return.
#[no_mangle]
pub extern "C" fn format_document() {
    log_info("${name}: format_document called");

    match read_file("__input__") {
        Ok(source) => {
            // TODO: implement formatting logic
            let formatted = source; // pass-through for now
            set_return(&serde_json::json!({
                "formatted": formatted,
            }));
        }
        Err(e) => {
            set_return(&serde_json::json!({ "error": e }));
        }
    }
}

/// Format a range within a document.
///
/// The host provides start_line, end_line via the input JSON.
#[no_mangle]
pub extern "C" fn format_range() {
    log_info("${name}: format_range called");

    match read_file("__input__") {
        Ok(source) => {
            // TODO: implement range formatting logic
            let formatted = source; // pass-through for now
            set_return(&serde_json::json!({
                "formatted": formatted,
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
