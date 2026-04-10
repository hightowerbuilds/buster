/**
 * Language support extension template scaffold.
 *
 * Generates a project with completion, hover, and definition stubs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateLanguage(dir: string, name: string): Promise<void> {
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
description = "A Buster language support extension"
entry = "target/wasm32-unknown-unknown/release/${crateName}.wasm"

[capabilities]
read_files = true
write_files = false
list_directories = true
run_commands = false
network = false

[extension.provides]
type = "language"
language_id = "${name}"
file_types = ["*.${name}"]
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

/// Provide completion items at the current cursor position.
///
/// Input JSON includes: file_path, line, column, trigger_character
#[no_mangle]
pub extern "C" fn completion() {
    log_info("${name}: completion called");

    match read_file("__input__") {
        Ok(_source) => {
            // TODO: implement completion logic
            let items = vec![
                serde_json::json!({
                    "label": "example_completion",
                    "kind": "function",
                    "detail": "An example completion item",
                    "insert_text": "example_completion()",
                }),
            ];

            set_return(&serde_json::json!({
                "items": items,
            }));
        }
        Err(e) => {
            set_return(&serde_json::json!({ "error": e }));
        }
    }
}

/// Provide hover information for the symbol at the cursor.
///
/// Input JSON includes: file_path, line, column
#[no_mangle]
pub extern "C" fn hover() {
    log_info("${name}: hover called");

    match read_file("__input__") {
        Ok(_source) => {
            // TODO: implement hover logic
            set_return(&serde_json::json!({
                "contents": "Hover information for this symbol.",
                "range": {
                    "start": { "line": 0, "column": 0 },
                    "end": { "line": 0, "column": 0 },
                },
            }));
        }
        Err(e) => {
            set_return(&serde_json::json!({ "error": e }));
        }
    }
}

/// Go to definition for the symbol at the cursor.
///
/// Input JSON includes: file_path, line, column
#[no_mangle]
pub extern "C" fn definition() {
    log_info("${name}: definition called");

    match read_file("__input__") {
        Ok(_source) => {
            // TODO: implement go-to-definition logic
            set_return(&serde_json::json!({
                "locations": [],
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
