import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { AskProductQuestionDto } from "./product.dto";

const toDto = (payload: Record<string, unknown>): AskProductQuestionDto =>
  plainToInstance(AskProductQuestionDto, payload);

const validate = (payload: Record<string, unknown>): string[] =>
  validateSync(
    toDto(payload) as object,
    // Same options as the gateway ValidationPipe.
    { whitelist: true, forbidNonWhitelisted: true },
  ).map((error) => error.property);

/** PRODUCT-QA-01 [TC-27] — the question is 3..300 characters AFTER trim. */
describe("[TC-27] AskProductQuestionDto", () => {
  it("trims the question", () => {
    expect(toDto({ question: "  có vừa không?  " }).question).toBe(
      "có vừa không?",
    );
  });

  it.each([
    ["missing", {}],
    ["null", { question: null }],
    ["whitespace-only", { question: "      " }],
    ["2 chars after trim", { question: "  ab  " }],
    ["301 chars", { question: "a".repeat(301) }],
  ])("rejects a %s question", (_label, payload) => {
    expect(validate(payload)).toEqual(["question"]);
  });

  it("rejects a non-string question as not a string", () => {
    const [error] = validateSync(toDto({ question: 12345 }) as object);

    expect(error?.property).toBe("question");
    expect(Object.keys(error?.constraints ?? {})).toContain("isString");
  });

  it.each([
    ["3 chars after trim", { question: "  abc  " }],
    ["300 chars after trim", { question: ` ${"a".repeat(300)} ` }],
  ])("accepts a %s question", (_label, payload) => {
    expect(validate(payload)).toEqual([]);
  });
});
