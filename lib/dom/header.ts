/**
 * Optional title / URL / date block at the top of the export (project.md §4.1).
 *
 * Built with textContent throughout: the title and URL come from the page, and
 * this element is inserted into that same page.
 */

import type { Undo } from "./style";

export const HEADER_ATTR = "data-pagepdf-header";

export interface HeaderMeta {
  title: string;
  url: string;
  /** ISO timestamp; rendered in the visitor's locale. */
  now: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function addHeaderBlock(meta: HeaderMeta): Undo {
  const host = document.body;
  if (!host) return () => {};

  const block = document.createElement("div");
  block.setAttribute(HEADER_ATTR, "");
  block.style.cssText = [
    "all: initial",
    "display: block",
    "box-sizing: border-box",
    "width: 100%",
    "padding: 0 0 10px",
    "margin: 0 0 16px",
    "border-bottom: 1px solid #c8c8c8",
    "font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "color: #111",
    "background: #fff",
    "break-after: avoid",
    "page-break-after: avoid",
  ].join(";");

  const title = document.createElement("div");
  title.style.cssText = "font-size:15px;font-weight:600;margin:0 0 3px;color:#111";
  title.textContent = meta.title || "Untitled page";

  const meta2 = document.createElement("div");
  meta2.style.cssText = "font-size:11px;color:#555;word-break:break-all";
  const when = formatWhen(meta.now);
  meta2.textContent = when ? `${meta.url} - saved ${when}` : meta.url;

  block.append(title, meta2);
  host.insertBefore(block, host.firstChild);

  return () => block.remove();
}
