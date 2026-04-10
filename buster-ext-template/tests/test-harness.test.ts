import { test, expect, describe, beforeEach } from "bun:test";
import { MockHostEnvironment } from "../src/test-harness.ts";

describe("MockHostEnvironment", () => {
  let env: MockHostEnvironment;

  beforeEach(() => {
    env = new MockHostEnvironment();
  });

  // ---------- Filesystem ----------

  describe("filesystem", () => {
    test("registerFile and readFile round-trip", () => {
      env.registerFile("/src/main.rs", "fn main() {}");
      expect(env.readFile("/src/main.rs")).toBe("fn main() {}");
    });

    test("readFile throws for missing file", () => {
      expect(() => env.readFile("/missing.txt")).toThrow("ENOENT");
    });

    test("writeFile creates a new file", () => {
      env.writeFile("/new.txt", "hello");
      expect(env.readFile("/new.txt")).toBe("hello");
    });

    test("writeFile overwrites existing file", () => {
      env.registerFile("/data.txt", "old");
      env.writeFile("/data.txt", "new");
      expect(env.readFile("/data.txt")).toBe("new");
    });

    test("fs map tracks all files", () => {
      env.registerFile("/a.txt", "a");
      env.registerFile("/b.txt", "b");
      expect(env.fs.size).toBe(2);
    });
  });

  // ---------- Commands ----------

  describe("commands", () => {
    test("registerCommand and executeCommand", () => {
      env.registerCommand("greet", (args) => `Hello, ${args[0]}!`);
      const result = env.executeCommand("greet", ["World"]);
      expect(result).toBe("Hello, World!");
    });

    test("executeCommand logs the invocation", () => {
      env.registerCommand("test-cmd", () => {});
      env.executeCommand("test-cmd", ["arg1", "arg2"]);
      expect(env.commands).toEqual(["test-cmd arg1 arg2"]);
    });

    test("executeCommand throws for unknown command", () => {
      expect(() => env.executeCommand("unknown")).toThrow("Unknown command");
    });

    test("multiple commands are logged in order", () => {
      env.registerCommand("a", () => {});
      env.registerCommand("b", () => {});
      env.executeCommand("a", []);
      env.executeCommand("b", ["x"]);
      expect(env.commands).toEqual(["a", "b x"]);
    });
  });

  // ---------- Notifications ----------

  describe("notifications", () => {
    test("notify captures notifications", () => {
      env.notify("info", "Build started");
      env.notify("error", "Build failed");

      const notifs = env.getNotifications();
      expect(notifs).toHaveLength(2);
      expect(notifs[0]).toEqual({ type: "info", message: "Build started" });
      expect(notifs[1]).toEqual({ type: "error", message: "Build failed" });
    });

    test("getNotifications returns a copy", () => {
      env.notify("info", "test");
      const copy = env.getNotifications();
      env.notify("warn", "another");
      // The copy should not include the new notification
      expect(copy).toHaveLength(1);
      expect(env.getNotifications()).toHaveLength(2);
    });
  });

  // ---------- Reset ----------

  describe("reset", () => {
    test("clears all state", () => {
      env.registerFile("/file.txt", "content");
      env.registerCommand("cmd", () => {});
      env.executeCommand("cmd", []);
      env.notify("info", "test");

      env.reset();

      expect(env.fs.size).toBe(0);
      expect(env.commands).toEqual([]);
      expect(env.notifications).toEqual([]);
      expect(() => env.executeCommand("cmd")).toThrow("Unknown command");
    });
  });
});
