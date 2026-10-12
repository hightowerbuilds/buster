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

import { MONO_FONT_FAMILY, UI_FONT_FAMILY } from "./fonts";

import type { ThemePalette } from "./theme";

export interface BlogTokens {
  // Typography
  fontFamily: string;
  h1FontFamily: string;
  headingFontFamily: string;
  headingFontWeight: string;
  h1FontWeight: string;
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

/** All supported writing styles. */
export const BLOG_THEMES = [
  { id: "none", label: "None" },
  { id: "courier", label: "Courier" },
] as const;

export type BlogThemeId = (typeof BLOG_THEMES)[number]["id"];

/** Earlier styles (Normal, Newspaper, Technical, Business) fall back to None. */
export const writingStyle = (id: string | undefined): BlogThemeId => id === "courier" ? "courier" : "none";

const COURIER_FONT_FAMILY = '"Courier New", Courier, "Nimbus Mono PS", monospace';

// ── None ─────────────────────────────────────────────────────
// No particular style: the note's text color throughout, headings set apart by
// size and weight alone, and no rules, tints, or ornaments.

function noneTokens(palette: ThemePalette): BlogTokens {
  return {
    fontFamily: UI_FONT_FAMILY,
    h1FontFamily: UI_FONT_FAMILY,
    headingFontFamily: UI_FONT_FAMILY,
    headingFontWeight: "700",
    h1FontWeight: "700",
    lineHeight: "1.7",
    textAlign: "left",

    bg: palette.editorBg,
    text: palette.text,
    textDim: palette.textDim,
    textMuted: palette.textMuted,
    accent: palette.accent,
    surface: "transparent",
    border: palette.border,
    codeBg: palette.surface0,

    h1FontSize: "1.9em",
    h1LetterSpacing: "normal",
    h1BorderBottom: "none",
    h1PaddingBottom: "0",
    h1Color: palette.text,
    h2FontSize: "1.45em",
    h2BorderBottom: "none",
    h2PaddingBottom: "0",
    h2Color: palette.text,
    h3FontSize: "1.2em",
    h3FontStyle: "normal",
    h4FontSize: "1em",
    h4TextTransform: "none",
    h4LetterSpacing: "normal",
    h4FontFamily: UI_FONT_FAMILY,

    pTextAlign: "left",
    pHyphens: "none",

    linkDecoration: "underline",
    linkDecorationThickness: "1px",
    linkUnderlineOffset: "2px",

    blockquoteBorderLeft: `2px solid ${palette.border}`,
    blockquoteBorderTop: "none",
    blockquoteBorderBottom: "none",
    blockquoteBg: "transparent",
    blockquoteFontStyle: "normal",
    blockquoteFontSize: "1em",
    blockquoteTextColor: palette.textDim,

    codeFontFamily: MONO_FONT_FAMILY,
    codeRadius: "3px",
    preRadius: "4px",
    preBorder: "none",

    hrWidth: "100%",
    hrMargin: "2em 0",

    imgRadius: "0",
    imgBorder: "none",

    thBg: "transparent",
    thColor: palette.text,
    thTextTransform: "none",
    thLetterSpacing: "normal",
    thFontFamily: UI_FONT_FAMILY,
    thFontSize: "1em",
    thBorderBottom: `1px solid ${palette.border}`,
    tdBorder: `1px solid ${palette.border}`,
    cellBorder: `1px solid ${palette.border}`,

    strongFontStyle: "normal",
    strongColor: palette.text,

    containerPadding: "40px 48px",
  };
}

// ── Courier ──────────────────────────────────────────────────
// A typewritten page: Courier throughout, dashed rules, Heading 1 and 2 drawn
// in ASCII characters, and each paragraph opening on a large ASCII-drawn letter
// (src/editor/ascii-art.ts; the text itself stays plain in the Markdown).

function courierTokens(palette: ThemePalette): BlogTokens {
  return {
    fontFamily: COURIER_FONT_FAMILY,
    h1FontFamily: COURIER_FONT_FAMILY,
    headingFontFamily: COURIER_FONT_FAMILY,
    headingFontWeight: "700",
    h1FontWeight: "700",
    lineHeight: "1.65",
    textAlign: "left",

    bg: palette.editorBg,
    text: palette.text,
    textDim: palette.textDim,
    textMuted: palette.textMuted,
    accent: palette.accent,
    surface: "transparent",
    border: palette.border,
    codeBg: "transparent",

    // ASCII lettering needs size to read: about six character rows per capital.
    h1FontSize: "3em",
    h1LetterSpacing: "0.04em",
    h1BorderBottom: `1px dashed ${palette.textDim}`,
    h1PaddingBottom: "0.3em",
    h1Color: palette.text,
    h2FontSize: "2.2em",
    h2BorderBottom: `1px dashed ${palette.border}`,
    h2PaddingBottom: "0.2em",
    h2Color: palette.text,
    h3FontSize: "1.1em",
    h3FontStyle: "normal",
    h4FontSize: "1em",
    h4TextTransform: "uppercase",
    h4LetterSpacing: "0.12em",
    h4FontFamily: COURIER_FONT_FAMILY,

    pTextAlign: "left",
    pHyphens: "none",

    linkDecoration: "underline",
    linkDecorationThickness: "1px",
    linkUnderlineOffset: "3px",

    blockquoteBorderLeft: `1px dashed ${palette.textDim}`,
    blockquoteBorderTop: "none",
    blockquoteBorderBottom: "none",
    blockquoteBg: "transparent",
    blockquoteFontStyle: "normal",
    blockquoteFontSize: "1em",
    blockquoteTextColor: palette.textDim,

    codeFontFamily: COURIER_FONT_FAMILY,
    codeRadius: "0",
    preRadius: "0",
    preBorder: `1px dashed ${palette.border}`,

    hrWidth: "100%",
    hrMargin: "2em 0",

    imgRadius: "0",
    imgBorder: `1px dashed ${palette.border}`,

    thBg: "transparent",
    thColor: palette.text,
    thTextTransform: "uppercase",
    thLetterSpacing: "0.08em",
    thFontFamily: COURIER_FONT_FAMILY,
    thFontSize: "0.9em",
    thBorderBottom: `1px dashed ${palette.textDim}`,
    tdBorder: `1px dashed ${palette.border}`,
    cellBorder: `1px dashed ${palette.border}`,

    strongFontStyle: "normal",
    strongColor: palette.text,

    containerPadding: "40px 48px",
  };
}

// ── Resolver ─────────────────────────────────────────────────

/**
 * Resolve all blog tokens for the given writing style.
 * Returns a flat CSS custom-property map ready to spread as inline style.
 */
export function resolveBlogTokens(blogTheme: string, palette: ThemePalette): Record<string, string> {
  return tokensToVars(writingStyle(blogTheme) === "courier" ? courierTokens(palette) : noneTokens(palette));
}

/** Convert a BlogTokens object to a --blog-* CSS variable map. */
function tokensToVars(t: BlogTokens): Record<string, string> {
  return {
    "--blog-font-family": t.fontFamily,
    "--blog-h1-font-family": t.h1FontFamily,
    "--blog-heading-font-family": t.headingFontFamily,
    "--blog-heading-font-weight": t.headingFontWeight,
    "--blog-h1-font-weight": t.h1FontWeight,
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
