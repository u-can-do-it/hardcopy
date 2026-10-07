import { describe, expect, it } from "vitest";

import {
  usesViewportHeight,
  viewportHeightProps,
  type DeclarationLike,
} from "@/lib/dom/viewport-units";

/** Enough of a CSSStyleDeclaration for the pure helpers, without a DOM. */
function declaration(decls: Record<string, string>): DeclarationLike {
  const props = Object.keys(decls);
  return {
    length: props.length,
    item: (i) => props[i] ?? "",
    getPropertyValue: (prop) => decls[prop] ?? "",
  };
}

describe("usesViewportHeight", () => {
  it("catches the units that follow the page box", () => {
    for (const value of [
      "100vh",
      "50svh",
      "100lvh",
      "100dvh",
      "10vmin",
      "80vmax",
      "100vb",
      "calc(100vh - 60px)",
      "min(100vh, 900px)",
      "0 0 20vh 0",
      "100VH",
    ]) {
      expect(usesViewportHeight(value), value).toBe(true);
    }
  });

  it("leaves horizontal and ordinary units alone", () => {
    // The paper is as wide as the content, so `vw` already resolves to what it
    // did on screen - pinning it would freeze layout that is not broken.
    for (const value of ["100vw", "50%", "16px", "2rem", "auto", "none", "1.5em", "10ch"]) {
      expect(usesViewportHeight(value), value).toBe(false);
    }
  });

  it("does not fire on a bare unit name inside another word", () => {
    expect(usesViewportHeight("archive")).toBe(false);
    expect(usesViewportHeight("var(--vh-fallback)")).toBe(false);
  });
});

describe("viewportHeightProps", () => {
  it("returns only the declarations written against the viewport height", () => {
    const props = viewportHeightProps(
      declaration({
        "min-height": "100vh",
        "padding-bottom": "20vh",
        width: "100vw",
        color: "red",
        height: "400px",
      }),
    );
    expect(props).toEqual(["min-height", "padding-bottom"]);
  });

  it("finds nothing in a page that does not use them", () => {
    expect(viewportHeightProps(declaration({ margin: "0", height: "auto" }))).toEqual([]);
  });
});
