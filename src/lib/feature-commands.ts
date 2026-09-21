/** App-native commands shared by the command line and in-app AI callers. */
export type CommandCaller = "user" | "ai";

// JSON Schema subset supported by the initial command catalog.
export interface CommandSchema {
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  properties?: Record<string, CommandSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: CommandSchema;
  minLength?: number;
  enum?: string[];
}

export interface FeatureCommand {
  name: string;
  description: string;
  version: 1;
  effect: "read" | "write";
  inputSchema: CommandSchema;
  outputSchema: CommandSchema;
  examples: string[];
  available?: () => boolean;
  run: (args: Record<string, unknown>, caller: CommandCaller) => unknown | Promise<unknown>;
}

export interface CommandRequest {
  requestId: string;
  command: string;
  args?: Record<string, unknown>;
}

export type CommandResult = {
  version: 1;
  requestId: string;
  command: string;
} & ({ ok: true; data: unknown } | { ok: false; error: { code: string; message: string } });

export class CommandFailure extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const emptyArgs: CommandSchema = { type: "object", properties: {}, additionalProperties: false };
export const objectResult: CommandSchema = { type: "object", additionalProperties: true };

export function validateCommandValue(value: unknown, schema: CommandSchema, path = "args"): void {
  const fail = (message: string): never => { throw new CommandFailure("INVALID_ARGUMENTS", `${path}: ${message}`); };
  if (schema.type === "null") { if (value !== null) fail("expected null"); return; }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return fail("expected array");
    if (schema.items) value.forEach((item, i) => validateCommandValue(item, schema.items!, `${path}[${i}]`));
    return;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail("expected object");
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) fail(`missing ${key}`);
    }
    for (const [key, field] of Object.entries(obj)) {
      const property = Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (property) validateCommandValue(field, property, `${path}.${key}`);
      else if (schema.additionalProperties === false) fail(`unknown argument ${key}`);
    }
    return;
  }
  if (typeof value !== schema.type) fail(`expected ${schema.type}`);
  if (typeof value === "number" && !Number.isFinite(value)) fail("expected finite number");
  if (typeof value === "string") {
    if (value.length < (schema.minLength ?? 0)) fail("must not be empty");
    if (schema.enum && !schema.enum.includes(value)) fail(`expected one of ${schema.enum.join(", ")}`);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class FeatureCommands {
  private catalog = new Map<string, FeatureCommand>();
  private requests = new Map<string, { fingerprint: string; result: Promise<CommandResult>; finished: boolean }>();
  private queue: Promise<unknown> = Promise.resolve();
  private journal: Array<{ requestId: string; command: string; caller: CommandCaller; ok: boolean; code?: string }> = [];

  register(command: FeatureCommand): void {
    if (this.catalog.has(command.name)) throw new Error(`Duplicate command: ${command.name}`);
    this.catalog.set(command.name, command);
  }

  describe(name?: string) {
    const commands = name ? [this.catalog.get(name)].filter((c): c is FeatureCommand => !!c) : [...this.catalog.values()];
    return commands.map(({ run: _run, available, ...command }) => ({ ...command, available: available?.() ?? true }));
  }

  history() { return this.journal.map(entry => ({ ...entry })); }

  /** Serialize operations; retain the most recent 128 completed request IDs per app session. */
  dispatch(request: CommandRequest, caller: CommandCaller): Promise<CommandResult> {
    const base = { version: 1 as const, requestId: request?.requestId ?? "", command: request?.command ?? "" };
    const error = (code: string, message: string): CommandResult => ({ ...base, ok: false, error: { code, message } });
    if (!request || typeof request.requestId !== "string" || !request.requestId.trim() || request.requestId.length > 128 || typeof request.command !== "string") {
      return Promise.resolve(error("INVALID_REQUEST", "A command and requestId (1–128 characters) are required."));
    }
    let args: Record<string, unknown>;
    let fingerprint: string;
    try {
      // Snapshot serializable arguments before queued work begins.
      args = JSON.parse(JSON.stringify(request.args === undefined ? {} : request.args));
      fingerprint = canonical({ command: request.command, args });
    } catch {
      return Promise.resolve(error("INVALID_ARGUMENTS", "Arguments must be JSON serializable."));
    }
    const key = `${caller}:${request.requestId}`;
    const previous = this.requests.get(key);
    if (previous) return previous.fingerprint === fingerprint
      ? previous.result
      : Promise.resolve(error("REQUEST_ID_CONFLICT", "This requestId was already used for different arguments."));
    if ([...this.requests.values()].filter(entry => !entry.finished).length >= 64) {
      return Promise.resolve(error("BUSY", "Too many pending commands. Wait for completion and retry."));
    }
    const commandName = request.command;
    const result = this.queue.then(async (): Promise<CommandResult> => {
      try {
        const command = this.catalog.get(commandName);
        if (!command) throw new CommandFailure("UNKNOWN_COMMAND", "Unknown command. Use commands list.");
        validateCommandValue(args, command.inputSchema);
        if (command.available && !command.available()) throw new CommandFailure("UNAVAILABLE", "Command is currently unavailable.");
        const data = await command.run(args, caller);
        try { validateCommandValue(data, command.outputSchema, "result"); }
        catch { throw new CommandFailure("INVALID_RESULT", "The command returned an invalid result."); }
        return { ...base, ok: true, data };
      } catch (e) {
        return e instanceof CommandFailure
          ? error(e.code, e.message)
          : error("INTERNAL_ERROR", "The command failed. No result is available.");
      }
    });
    this.requests.set(key, { fingerprint, result, finished: false });
    this.queue = result.then(outcome => {
      this.requests.get(key)!.finished = true;
      this.journal.push({ requestId: base.requestId, command: commandName, caller, ok: outcome.ok, ...(!outcome.ok ? { code: outcome.error.code } : {}) });
      if (this.journal.length > 128) this.journal.shift();
      const finished = [...this.requests.entries()].filter(([, value]) => value.finished);
      for (const [oldKey] of finished.slice(0, Math.max(0, finished.length - 128))) this.requests.delete(oldKey);
    });
    return result;
  }

  /** Syntax: command words followed by an optional JSON object. No shell evaluation. */
  async executeLine(line: string, requestId: string): Promise<CommandResult> {
    let command = line.trim();
    let args: Record<string, unknown> = {};
    const start = command.indexOf("{");
    if (start >= 0) {
      try { args = JSON.parse(command.slice(start)); }
      catch { return { version: 1, requestId, command: command.slice(0, start).trim(), ok: false, error: { code: "INVALID_ARGUMENTS", message: "Use a JSON object after the command name." } }; }
      command = command.slice(0, start).trim();
    }
    if (command === "help") command = "commands list";
    return this.dispatch({ requestId, command, args }, "user");
  }
}
