import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding } from "@open-wiki/access";
import { toneOfFindings } from "../src/renderer/ChecksPane.js";
import { checksSummary } from "../src/renderer/StatusBar.js";
import { pillClass } from "../src/renderer/ui/Pill.js";

/**
 * Two counts that overstate (`plans/desktop-ui-uxpass.md`, group 9).
 *
 * A wiki with five warnings and no errors showed a red **5** in the bar over a
 * pane that drew all five of them in amber; and the status bar said nothing at
 * all about the wiki's health until somebody went and looked.
 */

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8");
}

const css = source("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

const finding = (severity: Finding["severity"]): Finding => ({
  code: "wikilink.broken" as Finding["code"],
  severity,
  message: "something",
  fix: "do the thing",
});

describe("toneOfFindings (9.1)", () => {
  it("is the worst severity present, not the count", () => {
    // It was `findings.length > 0 ? "error" : "ok"`, so five warnings and no
    // errors showed a red 5 — the opposite of what the pane below it drew.
    expect(toneOfFindings([finding("warning"), finding("warning")])).toBe("warning");
  });

  it("is an error when there is one, whatever else there is", () => {
    expect(toneOfFindings([finding("warning"), finding("error"), finding("warning")])).toBe(
      "error",
    );
    expect(toneOfFindings([finding("error")])).toBe("error");
  });

  it("is ok when the checks found nothing", () => {
    expect(toneOfFindings([])).toBe("ok");
  });

  it("is what the bar actually draws", () => {
    const pane = source("ChecksPane.tsx");
    expect(pane).toContain("countTone={findings ? toneOfFindings(findings) : undefined}");
    // And the pill says what it is counting, so the number is not the only
    // thing carrying the meaning.
    expect(pane).toContain('noun="finding"');
  });

  it("tells a warning from an error by shape as well as by colour", () => {
    // The same argument that gave the pane two icons rather than one in two
    // colours — and what keeps this from reading as `cited`, whose amber means
    // something else entirely.
    expect(pillClass("warning")).toBe("pill pill--warning");
    expect(css).toMatch(/\.pill--warning::before\s*\{[^}]*border-bottom:\s*7px solid currentcolor/);
    expect(css).toMatch(/\.pill--warning\s*\{[^}]*color:\s*var\(--primary\)/);
  });
});

describe("checksSummary (9.2)", () => {
  it("says the checks are running before the first answer", () => {
    // It said *not checked yet* until somebody opened the pane, which left the
    // default state of the window silent about the wiki's health.
    expect(checksSummary(null, false)).toEqual({ text: "checking…", actionable: false });
  });

  it("reports the count once there is one", () => {
    expect(checksSummary(0, false)).toEqual({ text: "no findings", actionable: true });
    expect(checksSummary(1, false)).toEqual({ text: "1 finding", actionable: true });
    expect(checksSummary(5, false)).toEqual({ text: "5 findings", actionable: true });
  });

  it("says a failed run failed, ahead of any count it might still be holding", () => {
    // A stale number from before a failed re-run would be reported as though it
    // were current — which is a verdict the run never reached.
    expect(checksSummary(null, true).text).toBe("the checks could not run");
    expect(checksSummary(3, true).text).toBe("the checks could not run");
  });

  it("is still a way into the pane when it failed, because the reason is there", () => {
    expect(checksSummary(null, true).actionable).toBe(true);
  });

  it("offers nothing to click while it is still working", () => {
    // A button that explains nothing is the dead-button class group 1 removed.
    expect(checksSummary(null, false).actionable).toBe(false);
  });
});

describe("the check the window runs on its own (9.2)", () => {
  const app = source("App.tsx");

  it("asks once, and again after every write", () => {
    expect(app).toContain("}, [mayAsk, reloadKey]);");
  });

  it("does not run it a second time under the pane that is already running it", () => {
    expect(app).toContain('currentPane.current === "checks"');
  });

  it("reads the pane from a ref, so a pane switch is not another walk", () => {
    // `ow check` walks the whole project; in the dependency array it would run
    // on every trip to Sources and back.
    expect(app).toContain("const currentPane = useRef(location.pane);");
  });

  it("does not turn a failed walk into a count of zero", () => {
    // A count is a claim, and a walk that threw reached no verdict.
    expect(app).toContain("if (live) setChecksFailed(true);");
    expect(app).not.toContain("setFindings(0)");
  });

  it("clears the failure when a run comes back", () => {
    expect(app).toContain("setChecksFailed(false);");
  });
});
