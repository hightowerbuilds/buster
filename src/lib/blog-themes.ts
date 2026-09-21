/**
 * Blog theme token resolver.
 *
 * Single source of truth for every visual attribute in blog mode.
 * Returns a flat Record<string, string> of CSS custom property values
 * computed from (blogTheme, themeMode, palette).
 *
 * The stylesheet only references var(--blog-*) — never hardcodes
 * colors, fonts, or spacing. Theme switching is just swapping values.
 */

import { UI_FONT_FAMILY } from "./fonts";

import type { ThemePalette } from "./theme";

export interface BlogTokens {
  // Typography
  fontFamily: string;
  h1FontFamily: string;
  headingFontFamily: string;
  lineHeight: string;
  textAlign: string;

  // Colors
  bg: string;
  text: string;
  textDim: string;
  textMuted: string;
  accent: string;
  surface: string;
  border: string;
  codeBg: string;

  // Heading decoration
  h1FontSize: string;
  h1LetterSpacing: string;
  h1BorderBottom: string;
  h1PaddingBottom: string;
  h1Color: string;
  h2FontSize: string;
  h2BorderBottom: string;
  h2PaddingBottom: string;
  h2Color: string;
  h3FontSize: string;
  h3FontStyle: string;
  h4FontSize: string;
  h4TextTransform: string;
  h4LetterSpacing: string;
  h4FontFamily: string;

  // Paragraph
  pTextAlign: string;
  pHyphens: string;

  // Drop cap
  dropCapFontSize: string;
  dropCapColor: string;
  dropCapEnabled: string;   // "block" or "none" for display trick

  // Link
  linkDecoration: string;
  linkDecorationThickness: string;
  linkUnderlineOffset: string;

  // Blockquote
  blockquoteBorderLeft: string;
  blockquoteBorderTop: string;
  blockquoteBorderBottom: string;
  blockquoteBg: string;
  blockquoteFontStyle: string;
  blockquoteFontSize: string;
  blockquoteTextColor: string;

  // Code
  codeFontFamily: string;
  codeRadius: string;
  preRadius: string;
  preBorder: string;

  // HR
  hrWidth: string;
  hrMargin: string;

  // Image
  imgRadius: string;
  imgBorder: string;

  // Table
  thBg: string;
  thColor: string;
  thTextTransform: string;
  thLetterSpacing: string;
  thFontFamily: string;
  thFontSize: string;
  thBorderBottom: string;
  tdBorder: string;
  cellBorder: string;

  // Strong/em
  strongFontStyle: string;
  strongColor: string;

  // Padding
  containerPadding: string;
}

/** All supported blog theme IDs. */
export const BLOG_THEMES = [
  { id: "normal", label: "Normal" },
  { id: "newspaper", label: "Newspaper" },
] as const;

export type BlogThemeId = (typeof BLOG_THEMES)[number]["id"];

// ── Normal theme ─────────────────────────────────────────────

function normalTokens(palette: ThemePalette): BlogTokens {
  return {
    fontFamily: UI_FONT_FAMILY,
    h1FontFamily: UI_FONT_FAMILY,
    headingFontFamily: UI_FONT_FAMILY,
    lineHeight: "1.75",
    textAlign: "left",

    bg: palette.editorBg,
    text: palette.text,
    textDim: palette.textDim,
    textMuted: palette.textMuted,
    accent: palette.accent,
    surface: palette.surface0,
    border: palette.border,
    codeBg: palette.surface1,

    h1FontSize: "2em",
    h1LetterSpacing: "normal",
    h1BorderBottom: "none",
    h1PaddingBottom: "0",
    h1Color: palette.accent,
    h2FontSize: "1.6em",
    h2BorderBottom: "none",
    h2PaddingBottom: "0",
    h2Color: palette.accent,
    h3FontSize: "1.3em",
    h3FontStyle: "normal",
    h4FontSize: "1.1em",
    h4TextTransform: "none",
    h4LetterSpacing: "normal",
    h4FontFamily: UI_FONT_FAMILY,

    pTextAlign: "left",
    pHyphens: "none",

    dropCapFontSize: "1em",
    dropCapColor: palette.text,
    dropCapEnabled: "none",

    linkDecoration: "none",
    linkDecorationThickness: "auto",
    linkUnderlineOffset: "auto",

    blockquoteBorderLeft: `3px solid ${palette.accent}`,
    blockquoteBorderTop: "none",
    blockquoteBorderBottom: "none",
    blockquoteBg: palette.surface0,
    blockquoteFontStyle: "normal",
    blockquoteFontSize: "1em",
    blockquoteTextColor: palette.textDim,

    codeFontFamily: '"JetBrains Mono", monospace',
    codeRadius: "3px",
    preRadius: "4px",
    preBorder: "none",

    hrWidth: "100%",
    hrMargin: "2em 0",

    imgRadius: "4px",
    imgBorder: "none",

    thBg: palette.surface0,
    thColor: palette.textDim,
    thTextTransform: "none",
    thLetterSpacing: "normal",
    thFontFamily: UI_FONT_FAMILY,
    thFontSize: "1em",
    thBorderBottom: `1px solid ${palette.border}`,
    tdBorder: `1px solid ${palette.border}`,
    cellBorder: `1px solid ${palette.border}`,

    strongFontStyle: "normal",
    strongColor: palette.accent,

    containerPadding: "40px 48px",
  };
}

// ── Newspaper theme ──────────────────────────────────────────

function newspaperLightTokens(palette: ThemePalette): BlogTokens {
  const ink = "#121212";
  const inkDim = "#333";
  const rule = "#ccc";
  const ruleHeavy = "#333";
  const accent = "#567";
  const codeBg = "#ddd8cf";

  return {
    fontFamily: 'Georgia, "Times New Roman", Times, serif',
    h1FontFamily: '"UnifrakturMaguntia", Georgia, serif',
    headingFontFamily: 'Georgia, "Times New Roman", Times, serif',
    lineHeight: "1.7",
    textAlign: "justify",

    bg: palette.editorBg,
    text: ink,
    textDim: inkDim,
    textMuted: "#666",
    accent,
    surface: "transparent",
    border: rule,
    codeBg,

    h1FontSize: "2.8em",
    h1LetterSpacing: "0.01em",
    h1BorderBottom: `3px double ${ruleHeavy}`,
    h1PaddingBottom: "0.3em",
    h1Color: ink,
    h2FontSize: "1.8em",
    h2BorderBottom: `1px solid ${rule}`,
    h2PaddingBottom: "0.2em",
    h2Color: ink,
    h3FontSize: "1.4em",
    h3FontStyle: "italic",
    h4FontSize: "0.85em",
    h4TextTransform: "uppercase",
    h4LetterSpacing: "0.05em",
    h4FontFamily: UI_FONT_FAMILY,

    pTextAlign: "justify",
    pHyphens: "auto",

    dropCapFontSize: "3.2em",
    dropCapColor: ink,
    dropCapEnabled: "block",

    linkDecoration: "underline",
    linkDecorationThickness: "1px",
    linkUnderlineOffset: "2px",

    blockquoteBorderLeft: "none",
    blockquoteBorderTop: `2px solid ${ruleHeavy}`,
    blockquoteBorderBottom: `1px solid ${rule}`,
    blockquoteBg: "transparent",
    blockquoteFontStyle: "italic",
    blockquoteFontSize: "1.15em",
    blockquoteTextColor: inkDim,

    codeFontFamily: '"JetBrains Mono", monospace',
    codeRadius: "2px",
    preRadius: "0",
    preBorder: `1px solid ${rule}`,

    hrWidth: "40%",
    hrMargin: "2.5em auto",

    imgRadius: "0",
    imgBorder: `1px solid ${rule}`,

    thBg: "transparent",
    thColor: ink,
    thTextTransform: "uppercase",
    thLetterSpacing: "0.04em",
    thFontFamily: UI_FONT_FAMILY,
    thFontSize: "0.8em",
    thBorderBottom: `2px solid ${ruleHeavy}`,
    tdBorder: "none",
    cellBorder: `none none 1px solid ${rule} none`,

    strongFontStyle: "italic",
    strongColor: ink,

    containerPadding: "48px 56px",
  };
}

function newspaperDarkTokens(palette: ThemePalette): BlogTokens {
  const ink = "#e0ddd5";
  const inkDim = "#b8b4ab";
  const rule = "#3a3835";
  const ruleHeavy = "#9a9690";
  const accent = "#8eaab8";
  const codeBg = "#2a2825";

  return {
    fontFamily: 'Georgia, "Times New Roman", Times, serif',
    h1FontFamily: '"UnifrakturMaguntia", Georgia, serif',
    headingFontFamily: 'Georgia, "Times New Roman", Times, serif',
    lineHeight: "1.7",
    textAlign: "justify",

    bg: palette.editorBg,
    text: ink,
    textDim: inkDim,
    textMuted: "#8a8680",
    accent,
    surface: "transparent",
    border: rule,
    codeBg,

    h1FontSize: "2.8em",
    h1LetterSpacing: "0.01em",
    h1BorderBottom: `3px double ${ruleHeavy}`,
    h1PaddingBottom: "0.3em",
    h1Color: ink,
    h2FontSize: "1.8em",
    h2BorderBottom: `1px solid ${rule}`,
    h2PaddingBottom: "0.2em",
    h2Color: ink,
    h3FontSize: "1.3em",
    h3FontStyle: "italic",
    h4FontSize: "0.85em",
    h4TextTransform: "uppercase",
    h4LetterSpacing: "0.05em",
    h4FontFamily: UI_FONT_FAMILY,

    pTextAlign: "justify",
    pHyphens: "auto",

    dropCapFontSize: "3.2em",
    dropCapColor: ink,
    dropCapEnabled: "block",

    linkDecoration: "underline",
    linkDecorationThickness: "1px",
    linkUnderlineOffset: "2px",

    blockquoteBorderLeft: "none",
    blockquoteBorderTop: `2px solid ${ruleHeavy}`,
    blockquoteBorderBottom: `1px solid ${rule}`,
    blockquoteBg: "transparent",
    blockquoteFontStyle: "italic",
    blockquoteFontSize: "1.15em",
    blockquoteTextColor: inkDim,

    codeFontFamily: '"JetBrains Mono", monospace',
    codeRadius: "2px",
    preRadius: "0",
    preBorder: `1px solid ${rule}`,

    hrWidth: "40%",
    hrMargin: "2.5em auto",

    imgRadius: "0",
    imgBorder: `1px solid ${rule}`,

    thBg: "transparent",
    thColor: ink,
    thTextTransform: "uppercase",
    thLetterSpacing: "0.04em",
    thFontFamily: UI_FONT_FAMILY,
    thFontSize: "0.8em",
    thBorderBottom: `2px solid ${ruleHeavy}`,
    tdBorder: "none",
    cellBorder: `none none 1px solid ${rule} none`,

    strongFontStyle: "italic",
    strongColor: ink,

    containerPadding: "48px 56px",
  };
}

// ── Resolver ─────────────────────────────────────────────────

/**
 * Resolve all blog tokens for the given combination.
 * Returns a flat CSS custom-property map ready to spread as inline style.
 */
export function resolveBlogTokens(
  blogTheme: string,
  themeMode: string,
  palette: ThemePalette,
): Record<string, string> {
  const isDark = themeMode !== "light";

  let tokens: BlogTokens;
  switch (blogTheme) {
    case "newspaper":
      tokens = isDark ? newspaperDarkTokens(palette) : newspaperLightTokens(palette);
      break;
    default:
      tokens = normalTokens(palette);
      break;
  }

  return tokensToVars(tokens);
}

/** Convert a BlogTokens object to a --blog-* CSS variable map. */
function tokensToVars(t: BlogTokens): Record<string, string> {
  return {
    "--blog-font-family": t.fontFamily,
    "--blog-h1-font-family": t.h1FontFamily,
    "--blog-heading-font-family": t.headingFontFamily,
    "--blog-line-height": t.lineHeight,
    "--blog-text-align": t.textAlign,

    "--blog-bg": t.bg,
    "--blog-text": t.text,
    "--blog-text-dim": t.textDim,
    "--blog-text-muted": t.textMuted,
    "--blog-accent": t.accent,
    "--blog-surface": t.surface,
    "--blog-border": t.border,
    "--blog-code-bg": t.codeBg,

    "--blog-h1-font-size": t.h1FontSize,
    "--blog-h1-letter-spacing": t.h1LetterSpacing,
    "--blog-h1-border-bottom": t.h1BorderBottom,
    "--blog-h1-padding-bottom": t.h1PaddingBottom,
    "--blog-h1-color": t.h1Color,
    "--blog-h2-font-size": t.h2FontSize,
    "--blog-h2-border-bottom": t.h2BorderBottom,
    "--blog-h2-padding-bottom": t.h2PaddingBottom,
    "--blog-h2-color": t.h2Color,
    "--blog-h3-font-size": t.h3FontSize,
    "--blog-h3-font-style": t.h3FontStyle,
    "--blog-h4-font-size": t.h4FontSize,
    "--blog-h4-text-transform": t.h4TextTransform,
    "--blog-h4-letter-spacing": t.h4LetterSpacing,
    "--blog-h4-font-family": t.h4FontFamily,

    "--blog-p-text-align": t.pTextAlign,
    "--blog-p-hyphens": t.pHyphens,

    "--blog-drop-cap-font-size": t.dropCapFontSize,
    "--blog-drop-cap-color": t.dropCapColor,
    "--blog-drop-cap-enabled": t.dropCapEnabled,

    "--blog-link-decoration": t.linkDecoration,
    "--blog-link-decoration-thickness": t.linkDecorationThickness,
    "--blog-link-underline-offset": t.linkUnderlineOffset,

    "--blog-bq-border-left": t.blockquoteBorderLeft,
    "--blog-bq-border-top": t.blockquoteBorderTop,
    "--blog-bq-border-bottom": t.blockquoteBorderBottom,
    "--blog-bq-bg": t.blockquoteBg,
    "--blog-bq-font-style": t.blockquoteFontStyle,
    "--blog-bq-font-size": t.blockquoteFontSize,
    "--blog-bq-text-color": t.blockquoteTextColor,

    "--blog-code-font-family": t.codeFontFamily,
    "--blog-code-radius": t.codeRadius,
    "--blog-pre-radius": t.preRadius,
    "--blog-pre-border": t.preBorder,

    "--blog-hr-width": t.hrWidth,
    "--blog-hr-margin": t.hrMargin,

    "--blog-img-radius": t.imgRadius,
    "--blog-img-border": t.imgBorder,

    "--blog-th-bg": t.thBg,
    "--blog-th-color": t.thColor,
    "--blog-th-text-transform": t.thTextTransform,
    "--blog-th-letter-spacing": t.thLetterSpacing,
    "--blog-th-font-family": t.thFontFamily,
    "--blog-th-font-size": t.thFontSize,
    "--blog-th-border-bottom": t.thBorderBottom,
    "--blog-td-border": t.tdBorder,
    "--blog-cell-border": t.cellBorder,

    "--blog-strong-font-style": t.strongFontStyle,
    "--blog-strong-color": t.strongColor,

    "--blog-container-padding": t.containerPadding,
  };
}
