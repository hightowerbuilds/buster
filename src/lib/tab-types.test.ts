import { describe, it, expect } from "vitest";
import { isImageFile } from "./tab-types";

describe("isImageFile", () => {
  it("recognizes common image extensions", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.jpeg")).toBe(true);
    expect(isImageFile("icon.gif")).toBe(true);
    expect(isImageFile("banner.webp")).toBe(true);
    expect(isImageFile("logo.svg")).toBe(true);
    expect(isImageFile("img.bmp")).toBe(true);
    expect(isImageFile("favicon.ico")).toBe(true);
    expect(isImageFile("hero.avif")).toBe(true);
    expect(isImageFile("scan.tiff")).toBe(true);
    expect(isImageFile("scan.tif")).toBe(true);
  });

  it("rejects non-image extensions", () => {
    expect(isImageFile("main.ts")).toBe(false);
    expect(isImageFile("style.css")).toBe(false);
    expect(isImageFile("README.md")).toBe(false);
    expect(isImageFile("Cargo.toml")).toBe(false);
    expect(isImageFile("data.json")).toBe(false);
  });

  it("handles case insensitivity", () => {
    expect(isImageFile("PHOTO.PNG")).toBe(true);
    expect(isImageFile("Logo.SVG")).toBe(true);
    expect(isImageFile("image.JPG")).toBe(true);
  });

  it("handles files without extensions", () => {
    expect(isImageFile("Makefile")).toBe(false);
    expect(isImageFile("Dockerfile")).toBe(false);
  });

  it("handles paths with directories", () => {
    expect(isImageFile("/Users/luke/project/assets/logo.png")).toBe(true);
    expect(isImageFile("src/images/hero.webp")).toBe(true);
    expect(isImageFile("docs/README.md")).toBe(false);
  });

  it("handles dotfiles", () => {
    expect(isImageFile(".gitignore")).toBe(false);
    expect(isImageFile(".env")).toBe(false);
  });
});
