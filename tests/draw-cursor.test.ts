import { describe, expect, it } from "vitest";
import { CURSOR_PX, toolCursor } from "@/lib/draw/cursor";
import { DRAW_ALL_TOOLS } from "@/lib/draw/model";
import type { DrawTool } from "@/lib/types";

/**
 * A cursor value the CSS parser refuses is dropped without a word, and the host
 * keeps whatever it had - the *previous* tool's cursor. Nothing on screen says
 * so, so the shape of the value is what these hold.
 */
const VALUE = /^url\("data:image\/svg\+xml,([^"\s\\]*)"\) (\d+) (\d+), ([a-z-]+)$/;

interface Parsed {
  svg: string;
  hotspot: { x: number; y: number };
  fallback: string;
}

function parse(tool: DrawTool): Parsed {
  const match = VALUE.exec(toolCursor(tool));
  expect(match, `${tool}: ${toolCursor(tool)}`).not.toBeNull();
  const [, encoded, x, y, fallback] = match!;
  return {
    svg: decodeURIComponent(encoded!),
    hotspot: { x: Number(x), y: Number(y) },
    fallback: fallback!,
  };
}

/** Every `<path ...>`'s attributes, in document order. */
function pathsOf(svg: string): Record<string, string>[] {
  return [...svg.matchAll(/<path ([^>]*)\/>/g)].map((m) =>
    Object.fromEntries([...m[1]!.matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])),
  );
}

const PENS: readonly DrawTool[] = ["pencil", "highlighter"];
const CORNER_TOOLS: readonly DrawTool[] = DRAW_ALL_TOOLS.filter((tool) => !PENS.includes(tool));

describe("toolCursor", () => {
  it("gives every tool a cursor of its own", () => {
    const values = DRAW_ALL_TOOLS.map(toolCursor);
    expect(new Set(values).size).toBe(DRAW_ALL_TOOLS.length);
  });

  it("is a quoted SVG data URL, a hotspot, and a keyword to fall back on", () => {
    // `VALUE` refuses a `"`, a backslash or whitespace inside the URL: any of
    // them ends the string early or breaks the declaration, and the cursor is
    // then silently the last tool's.
    for (const tool of DRAW_ALL_TOOLS) {
      const { svg, fallback } = parse(tool);
      expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), tool).toBe(true);
      expect(svg.endsWith("</svg>"), tool).toBe(true);
      // `#` starts a fragment in a URL, so an unescaped `#fff` would cut the
      // image off at the halo.
      expect(toolCursor(tool), tool).not.toMatch(/#/);
      // The keyword is what a page whose CSP refuses `data:` images gets.
      expect(["crosshair", "text"], tool).toContain(fallback);
    }
  });

  it("is small enough that Chrome draws it near its own toolbar", () => {
    // Chrome refuses a cursor image over 32x32 wherever it would overlap the
    // browser UI, so a bigger one stops working at the top of the page.
    expect(CURSOR_PX).toBeLessThanOrEqual(32);
    for (const tool of DRAW_ALL_TOOLS) {
      const { svg, hotspot } = parse(tool);
      expect(svg).toContain(`width="${CURSOR_PX}" height="${CURSOR_PX}"`);
      expect(svg).toContain(`viewBox="0 0 ${CURSOR_PX} ${CURSOR_PX}"`);
      // A hotspot outside the image is ignored and the browser uses 0 0.
      expect(hotspot.x, tool).toBeGreaterThanOrEqual(0);
      expect(hotspot.y, tool).toBeGreaterThanOrEqual(0);
      expect(hotspot.x, tool).toBeLessThan(CURSOR_PX);
      expect(hotspot.y, tool).toBeLessThan(CURSOR_PX);
    }
  });

  it("puts a white halo under black ink, so it reads on any page", () => {
    for (const tool of DRAW_ALL_TOOLS) {
      const paths = pathsOf(parse(tool).svg);
      expect(paths, tool).toHaveLength(2);
      const [halo, ink] = paths as [Record<string, string>, Record<string, string>];
      // Halo first: SVG paints in document order.
      expect(halo.stroke, tool).toBe("#fff");
      expect(ink.stroke, tool).toBe("#000");
      expect(halo.d, tool).toBe(ink.d);
      expect(Number(halo["stroke-width"]), tool).toBeGreaterThan(Number(ink["stroke-width"]));
      expect(ink.fill, tool).toBe("none");
    }
  });

  it("fills the pens' bodies and leaves every badge hollow", () => {
    // A solid white square in the corner of the rectangle's cursor would read
    // as the fill menu's cover, which is armed on the bar and not here.
    for (const tool of PENS) expect(pathsOf(parse(tool).svg)[0]!.fill, tool).toBe("#fff");
    for (const tool of CORNER_TOOLS) expect(pathsOf(parse(tool).svg)[0]!.fill, tool).toBe("none");
  });

  it("aims every corner tool from one crosshair centre", () => {
    // A line, a box, a symbol and a label all start at the press point, so
    // switching between them must not move the point being aimed with.
    const hotspots = CORNER_TOOLS.map((tool) => parse(tool).hotspot);
    for (const hotspot of hotspots) expect(hotspot).toEqual(hotspots[0]);
  });

  it("draws the pens from their nibs, at the bottom-left like the bar's icons", () => {
    for (const tool of PENS) {
      const { hotspot } = parse(tool);
      expect(hotspot.x, tool).toBeLessThan(CURSOR_PX / 4);
      expect(hotspot.y, tool).toBeGreaterThan((CURSOR_PX * 3) / 4);
    }
  });

  it("falls back to the I-beam for text and the crosshair for the rest", () => {
    expect(parse("text").fallback).toBe("text");
    for (const tool of DRAW_ALL_TOOLS.filter((t) => t !== "text")) {
      expect(parse(tool).fallback, tool).toBe("crosshair");
    }
  });
});
