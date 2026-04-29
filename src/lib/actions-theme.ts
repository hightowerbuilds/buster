import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { AppSettings } from "./ipc";
import type { ThemePalette } from "./theme";
import { setTerminalTheme as setTerminalThemeIpc } from "./ipc";
import {
  CATPPUCCIN, LIGHT_THEME, generatePalette, importVSCodeTheme,
  applyPaletteToCss, clearCssOverrides, paletteToTerminalColors, withSyntaxOverrides,
} from "./theme";

export function createThemeActions(setStore: SetStoreFunction<BusterStoreState>) {
  function rebuildPalette(s: AppSettings) {
    const fx = {
      bgGlow: 0,
      cursorGlow: s.effect_cursor_glow ?? 0,
      vignette: s.effect_vignette ?? 0,
      grain: s.effect_grain ?? 0,
    };
    const mode = s.theme_mode || "dark";
    let p: ThemePalette;

    if (mode === "imported") {
      try {
        const raw = localStorage.getItem("buster-imported-theme");
        if (raw) {
          p = withSyntaxOverrides(importVSCodeTheme(JSON.parse(raw), fx), s.syntax_colors);
          setStore("palette", p);
          applyPaletteToCss(p);
        } else {
          p = withSyntaxOverrides({ ...CATPPUCCIN, ...fx }, s.syntax_colors);
          setStore("palette", p);
          clearCssOverrides();
        }
      } catch {
        p = withSyntaxOverrides({ ...CATPPUCCIN, ...fx }, s.syntax_colors);
        setStore("palette", p);
        clearCssOverrides();
      }
    } else if (mode === "custom" && s.theme_hue >= 0) {
      p = withSyntaxOverrides(generatePalette(s.theme_hue, fx), s.syntax_colors);
      setStore("palette", p);
      applyPaletteToCss(p);
    } else if (mode === "light") {
      p = withSyntaxOverrides({ ...LIGHT_THEME, ...fx }, s.syntax_colors);
      setStore("palette", p);
      applyPaletteToCss(p);
    } else {
      p = withSyntaxOverrides({ ...CATPPUCCIN, ...fx }, s.syntax_colors);
      setStore("palette", p);
      clearCssOverrides();
    }

    setTerminalThemeIpc(paletteToTerminalColors(p!)).catch((e) =>
      console.warn("Failed to sync terminal theme:", e),
    );
  }

  return { rebuildPalette };
}
