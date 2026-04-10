/**
 * Mock host environment for testing Buster IDE extensions.
 *
 * Provides an in-memory filesystem, command execution log,
 * and notification capture so extension authors can test
 * their WASM extensions against mock host functions.
 */

export interface Notification {
  type: string;
  message: string;
}

export type CommandHandler = (args: string[]) => string | void;

export class MockHostEnvironment {
  /** In-memory filesystem: path -> content */
  fs: Map<string, string> = new Map();

  /** Log of executed commands */
  commands: string[] = [];

  /** Captured notifications */
  notifications: Array<Notification> = [];

  /** Registered command handlers */
  private commandHandlers: Map<string, CommandHandler> = new Map();

  // ---------- Filesystem ----------

  /** Register a file with the given content. */
  registerFile(path: string, content: string): void {
    this.fs.set(path, content);
  }

  /** Read a file from the mock filesystem. Throws if the file does not exist. */
  readFile(path: string): string {
    const content = this.fs.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: file not found: ${path}`);
    }
    return content;
  }

  /** Write a file to the mock filesystem (creates or overwrites). */
  writeFile(path: string, content: string): void {
    this.fs.set(path, content);
  }

  // ---------- Commands ----------

  /** Register a named command with a handler function. */
  registerCommand(name: string, handler: CommandHandler): void {
    this.commandHandlers.set(name, handler);
  }

  /**
   * Execute a registered command by name.
   * Logs the invocation and delegates to the handler.
   * Throws if the command is not registered.
   */
  executeCommand(name: string, args: string[] = []): string | void {
    this.commands.push(`${name} ${args.join(" ")}`.trim());

    const handler = this.commandHandlers.get(name);
    if (!handler) {
      throw new Error(`Unknown command: ${name}`);
    }
    return handler(args);
  }

  // ---------- Notifications ----------

  /** Send a notification (captured for later assertions). */
  notify(type: string, message: string): void {
    this.notifications.push({ type, message });
  }

  /** Return all captured notifications. */
  getNotifications(): Array<Notification> {
    return [...this.notifications];
  }

  // ---------- Lifecycle ----------

  /** Clear all state — filesystem, commands, notifications, handlers. */
  reset(): void {
    this.fs.clear();
    this.commands = [];
    this.notifications = [];
    this.commandHandlers.clear();
  }
}
