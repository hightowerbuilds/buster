import { marked } from "marked";

const TAGS = new Set(["P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "EM", "DEL", "BLOCKQUOTE", "UL", "OL", "LI", "PRE", "CODE", "HR", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "LINK", "META", "BASE"]);
export const MAX_PRINT_TEXT = 2 * 1024 * 1024;

/** Print the draft, never the application chrome. Remote content cannot load. */
export function printableBody(title: string, text: string, markdown: boolean): string {
  const doc = new DOMParser().parseFromString("<!doctype html><html><body></body></html>", "text/html");
  const header = doc.createElement("header"); header.textContent = title;
  doc.body.append(header);
  const article = doc.createElement("article");
  if (!markdown) {
    const pre = doc.createElement("pre"); pre.className = "plain-text"; pre.textContent = text; article.append(pre);
  } else {
    const source = new DOMParser().parseFromString(marked.parse(text, { async: false }) as string, "text/html");
    const copy = (node: Node, parent: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(doc.createTextNode(node.textContent ?? "")); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;
      if (DROP.has(element.tagName)) return;
      // Print the image description without loading external or local resources.
      if (element.tagName === "IMG") { parent.appendChild(doc.createTextNode(element.getAttribute("alt") ?? "")); return; }
      const safe = TAGS.has(element.tagName) ? doc.createElement(element.tagName.toLowerCase()) : parent;
      if (safe !== parent) {
        if (element.tagName === "A") {
          const href = element.getAttribute("href") ?? "";
          if (/^(https?:\/\/|mailto:)/i.test(href)) (safe as Element).setAttribute("href", href);
        }
        if (element.tagName === "OL" && /^\d{1,6}$/.test(element.getAttribute("start") ?? "")) (safe as Element).setAttribute("start", element.getAttribute("start")!);
        parent.appendChild(safe);
      }
      for (const child of element.childNodes) copy(child, safe);
    };
    for (const child of source.body.childNodes) copy(child, article);
  }
  doc.body.append(article);
  return doc.body.innerHTML;
}
