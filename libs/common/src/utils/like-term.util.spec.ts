import { escapeLikeTerm, toContainsLikePattern } from "./like-term.util";

describe("like-term util (LIST-SEARCH-01)", () => {
  it("escapes the LIKE wildcards and the escape character itself", () => {
    expect(escapeLikeTerm("50%_off\\x")).toBe("50\\%\\_off\\\\x");
  });

  it("wraps a trimmed term in a contains pattern", () => {
    expect(toContainsLikePattern("  ord_ab  ")).toBe("%ord\\_ab%");
  });

  it.each([undefined, null, "", "   "])(
    "treats %p as no filter",
    (term: string | null | undefined) => {
      expect(toContainsLikePattern(term)).toBeNull();
    },
  );
});
