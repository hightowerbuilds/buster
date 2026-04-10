/**
 * Public API exports for buster-ext-template.
 */

// Manifest types and validation
export { validateId, validateManifest, type ExtensionManifest } from "./manifest.ts";

// Publish
export { publish, type PublishConfig, type PublishResult } from "./publish.ts";

// Test harness
export { MockHostEnvironment, type Notification, type CommandHandler } from "./test-harness.ts";

// Dev server
export { DevServer, type DevServerOptions } from "./dev-server.ts";

// Template generators
export { generateFormatter } from "./templates/formatter.ts";
export { generateLinter } from "./templates/linter.ts";
export { generateLanguage } from "./templates/language.ts";
