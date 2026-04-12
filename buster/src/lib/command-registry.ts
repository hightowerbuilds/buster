export interface Command {
  id: string;
  label: string;
  category?: string;
  keybinding?: string;
  when?: () => boolean;
  execute: () => void;
}

class CommandRegistry {
  private commands = new Map<string, Command>();

  register(cmd: Command): void {
    this.commands.set(cmd.id, cmd);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  getAll(): Command[] {
    return Array.from(this.commands.values()).filter(c => !c.when || c.when());
  }

  getAllUnfiltered(): Command[] {
    return Array.from(this.commands.values());
  }

  search(query: string): Command[] {
    const all = this.getAll();
    if (!query) return all;
    const lower = query.toLowerCase();
    return all
      .map(cmd => {
        const target = `${cmd.category ?? ""} ${cmd.label}`.toLowerCase();
        let score = 0;
        let qi = 0;
        for (let ti = 0; ti < target.length && qi < lower.length; ti++) {
          if (target[ti] === lower[qi]) {
            score += 1;
            if (ti === 0 || " :".includes(target[ti - 1])) score += 3;
            qi++;
          }
        }
        return { cmd, matched: qi === lower.length, score };
      })
      .filter(r => r.matched)
      .sort((a, b) => b.score - a.score)
      .map(r => r.cmd);
  }

  execute(id: string): void {
    const cmd = this.commands.get(id);
    if (cmd && (!cmd.when || cmd.when())) cmd.execute();
  }
}

export const registry = new CommandRegistry();
