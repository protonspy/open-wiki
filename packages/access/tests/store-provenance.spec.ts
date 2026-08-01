import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProvenance } from "../src/store/provenance.js";
import { registerSource } from "../src/sources/register.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-prov-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("resolveProvenance (5.4)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    registerSource(root, {
      name: "Arquitetura Fenix.pdf",
      kind: "file",
      content: Buffer.from("a"),
    });
    registerSource(root, { name: "Fenix weekly 2026-07-31", kind: "recording", content: null });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a citation whose id climbs out of raw/ — an id is not a path", () => {
    // `parseLink` takes everything before the `#` as the id, so a page can put
    // a traversal there. Answering it against the filesystem outside `raw/`
    // would make an accepted page an existence oracle for the machine.
    const issues = resolveProvenance(root, [
      "src://../../etc#p1",
      "src://..#p1",
      "rec://../../..#14:32",
    ]);
    expect(issues).toHaveLength(3);
    for (const issue of issues) expect(issue.reason).toContain("points at no source");
  });

  it("reports nothing when every citation points at an existing source", () => {
    const sources = ["src://arquitetura-fenix.pdf#p12", "rec://fenix-weekly-2026-07-31#14:32"];
    expect(resolveProvenance(root, sources)).toEqual([]);
  });

  it("refuses a file citation whose source does not exist, naming the link", () => {
    const issues = resolveProvenance(root, ["src://ghost.pdf#p1"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("provenance");
    expect(issues[0]!.reason).toContain("src://ghost.pdf#p1");
    expect(issues[0]!.reason).toMatch(/no source/i);
  });

  it("refuses a recording citation whose source does not exist", () => {
    const issues = resolveProvenance(root, ["rec://missing-2026-01-01#00:00"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toContain("rec://missing-2026-01-01#00:00");
  });

  it("refuses a recording citation with a malformed instant, even when the source exists", () => {
    const issues = resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#noon"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/instant/i);
  });

  it("refuses a file citation with a non-page fragment", () => {
    const issues = resolveProvenance(root, ["src://arquitetura-fenix.pdf#page12"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/page/i);
  });

  it("reports each broken citation separately", () => {
    const issues = resolveProvenance(root, ["src://ghost.pdf#p1", "src://phantom.pdf#p2"]);
    expect(issues).toHaveLength(2);
  });

  it("refuses an instant that reads as a time but is not one", () => {
    // `14:75` passes any regex that merely counts digits. It is not a time, and
    // accepting it would let a citation name a minute arithmetic then rolls
    // into a different one.
    const issues = resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#14:75"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toMatch(/instant/i);
  });

  describe("in range, once the recording has a time map (4.7)", () => {
    /** A map for a recording that runs to exactly 20 minutes. */
    function writeTimeMap(id: string, durationNs: number) {
      writeFileSync(
        join(root, "raw", id, "timemap.json"),
        JSON.stringify({
          version: 1,
          compressedDurationNs: durationNs,
          segments: [
            {
              compressedStartNs: 0,
              durationNs,
              recordedStartNs: 0,
              wallStartMs: 1_000_000,
            },
          ],
          chunks: [],
        }),
        "utf8",
      );
    }

    const TWENTY_MINUTES_NS = 20 * 60 * 1_000_000_000;

    it("accepts an instant inside the recording", () => {
      writeTimeMap("fenix-weekly-2026-07-31", TWENTY_MINUTES_NS);
      expect(resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#14:32"])).toEqual([]);
    });

    it("refuses an instant past the end, and says how long the recording is", () => {
      writeTimeMap("fenix-weekly-2026-07-31", TWENTY_MINUTES_NS);
      const issues = resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#44:32"]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.reason).toContain("20:00");
    });

    it("accepts the very last instant of the recording", () => {
      writeTimeMap("fenix-weekly-2026-07-31", TWENTY_MINUTES_NS);
      expect(resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#20:00"])).toEqual([]);
    });

    it("stays dormant for a recording that has not been encoded yet", () => {
      // Captured but not through 4.6. There is no length to measure against,
      // and an absent map cannot make a citation resolve falsely.
      expect(resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#99:59"])).toEqual([]);
    });

    it("falls back to the weaker check when the map will not parse", () => {
      writeFileSync(
        join(root, "raw", "fenix-weekly-2026-07-31", "timemap.json"),
        "{ truncated",
        "utf8",
      );
      expect(resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#99:59"])).toEqual([]);
    });

    it("falls back on a map that parses into something that is not one", () => {
      // The failure a cast misses. `{}` casts to TimeMap as happily as a real
      // map does and then throws inside the reader — and this runs per page in
      // `ow check` and on every write in the gate, so one corrupt file in one
      // recording directory would take down the whole project's check.
      for (const content of ["{}", "[]", '"a map"', "null", '{"version":2,"segments":[]}']) {
        writeFileSync(
          join(root, "raw", "fenix-weekly-2026-07-31", "timemap.json"),
          content,
          "utf8",
        );
        expect(resolveProvenance(root, ["rec://fenix-weekly-2026-07-31#99:59"])).toEqual([]);
      }
    });
  });
});
