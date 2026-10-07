import { describe, expect, it } from "vitest";
import {
  cssPackageImports,
  findPackage,
  packageRoot,
  readNotice,
  renderNotices,
  type Notice,
} from "@/scripts/third-party-licenses";

const PNPM = "/repo/node_modules/.pnpm";

describe("packageRoot", () => {
  it("names the package by the last node_modules segment, which is pnpm's real one", () => {
    expect(packageRoot(`${PNPM}/preact@10.29.8/node_modules/preact/hooks/dist/hooks.module.js`)).toBe(
      `${PNPM}/preact@10.29.8/node_modules/preact`,
    );
  });

  it("keeps a scope with its name", () => {
    expect(
      packageRoot(`${PNPM}/@radix-ui+react-slot@1.2.3/node_modules/@radix-ui/react-slot/dist/index.mjs`),
    ).toBe(`${PNPM}/@radix-ui+react-slot@1.2.3/node_modules/@radix-ui/react-slot`);
  });

  it("ignores our own code and Rollup's virtual modules", () => {
    expect(packageRoot("/repo/lib/settings.ts")).toBeNull();
    expect(packageRoot("\0vite/preload-helper.js")).toBeNull();
    expect(packageRoot("\0virtual:wxt-background-entrypoint")).toBeNull();
  });

  it("strips Vite's query suffixes and the virtual-module marker", () => {
    expect(packageRoot(`\0/repo/node_modules/clsx/dist/clsx.mjs?commonjs-proxy`)).toBe(
      "/repo/node_modules/clsx",
    );
  });

  it("reads Windows paths", () => {
    expect(packageRoot("C:\\repo\\node_modules\\cn\\index.js")).toBe("C:/repo/node_modules/cn");
  });

  it("does not mistake pnpm's own bookkeeping for a package", () => {
    expect(packageRoot("/repo/node_modules/.pnpm/lock.yaml")).toBeNull();
    expect(packageRoot("/repo/node_modules/@scope")).toBeNull();
  });
});

describe("cssPackageImports", () => {
  it("finds the bare imports Tailwind resolves itself", () => {
    expect(cssPackageImports('@import "tailwindcss";\n@import "tw-animate-css";')).toEqual([
      "tailwindcss",
      "tw-animate-css",
    ]);
  });

  it("reduces a subpath import to its package, scope included", () => {
    expect(cssPackageImports("@import 'pkg/dist/a.css'; @import \"@scope/ui/theme.css\";")).toEqual([
      "pkg",
      "@scope/ui",
    ]);
  });

  it("skips our own files and URLs", () => {
    const css = `@import "./local.css"; @import "/abs.css"; @import url("https://fonts.example/x.css");`;
    expect(cssPackageImports(css)).toEqual([]);
  });
});

describe("renderNotices", () => {
  const preact: Notice = { name: "preact", version: "10.29.8", license: "MIT", text: "MIT text" };
  const clsx: Notice = { name: "clsx", version: "2.1.1", license: "MIT", text: "clsx text" };

  it("sorts by name and lists every package once", () => {
    const out = renderNotices([preact, clsx, { ...preact }]);
    expect(out).toContain("2 packages: clsx@2.1.1, preact@10.29.8");
    expect(out.indexOf("clsx 2.1.1 - MIT")).toBeLessThan(out.indexOf("preact 10.29.8 - MIT"));
    expect(out.match(/preact 10\.29\.8 - MIT/g)).toHaveLength(1);
  });

  it("keeps two versions of one package apart - each ships its own notice", () => {
    const out = renderNotices([
      { name: "a", version: "1.0.0", license: "MIT", text: "one" },
      { name: "a", version: "2.0.0", license: "MIT", text: "two" },
    ]);
    expect(out).toContain("a 1.0.0 - MIT");
    expect(out).toContain("a 2.0.0 - MIT");
  });

  it("quotes the licence text, and says where it came from when it is upstream's", () => {
    const out = renderNotices([
      { ...clsx, url: "https://github.com/lukeed/clsx" },
      { name: "wxt", version: "0.20.27", license: "MIT", text: "wxt text", textFrom: "https://x/LICENSE" },
    ]);
    expect(out).toContain("https://github.com/lukeed/clsx\n\nclsx text");
    expect(out).toContain("this is https://x/LICENSE.)\n\nwxt text");
  });

  it("names the licence when there is no text to quote", () => {
    expect(renderNotices([{ name: "bare", version: "1.0.0", license: "MIT" }])).toContain(
      "This package ships no licence file. Its package.json declares: MIT.",
    );
  });

  it("points at the extension's own licence", () => {
    expect(renderNotices([])).toContain("FSL-1.1-MIT (see LICENSE.md)");
  });
});

/**
 * Against the real node_modules, because the licence-file lookup is the part a
 * synthetic path cannot exercise: whether `readNotice` finds what a package
 * actually publishes.
 */
describe("readNotice", () => {
  it("reads a published package's own licence file", () => {
    const root = findPackage(process.cwd(), "preact");
    expect(root).not.toBeNull();
    const notice = readNotice(root as string);
    expect(notice).toMatchObject({ name: "preact", license: "MIT" });
    expect(notice?.text).toMatch(/Permission is hereby granted/);
    expect(notice?.textFrom).toBeUndefined();
  });

  it("falls back to the upstream licence for a package that ships none", () => {
    const root = findPackage(process.cwd(), "wxt");
    expect(root).not.toBeNull();
    const notice = readNotice(root as string);
    expect(notice?.text).toMatch(/Copyright \(c\) 2023 Aaron/);
    expect(notice?.textFrom).toBe("https://github.com/wxt-dev/wxt/blob/main/LICENSE");
  });

  it("returns null for a directory that is not a package", () => {
    expect(readNotice(process.cwd() + "/tests")).toBeNull();
  });
});
