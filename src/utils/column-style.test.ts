import { describe, expect, it } from "vitest";
import { buildColumnMaxWidthStyle } from "./column-style";

describe("column max-width style", () => {
  it("passes a configured width through for scrolling columns", () => {
    expect(buildColumnMaxWidthStyle("140px", undefined)).toBe("max-width:140px;");
    expect(buildColumnMaxWidthStyle(" 35% ", undefined)).toBe("max-width:35%;");
  });

  it("emits nothing when no width is configured so the stylesheet cap applies", () => {
    expect(buildColumnMaxWidthStyle(undefined, undefined)).toBe("");
    expect(buildColumnMaxWidthStyle("", "start")).toBe("");
    expect(buildColumnMaxWidthStyle(undefined, "end")).toBe("");
  });

  it("clamps sticky column widths to half of the table viewport", () => {
    expect(buildColumnMaxWidthStyle("400px", "start")).toBe(
      "max-width:min(400px,50vw);max-width:min(400px,50cqw);",
    );
    expect(buildColumnMaxWidthStyle("clamp(180px, 30vw, 420px)", "end")).toBe(
      "max-width:min(clamp(180px, 30vw, 420px),50vw);max-width:min(clamp(180px, 30vw, 420px),50cqw);",
    );
  });
});
