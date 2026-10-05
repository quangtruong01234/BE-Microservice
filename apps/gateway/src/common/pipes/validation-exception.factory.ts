import { BadRequestException } from "@nestjs/common";
import { ValidationError } from "class-validator";

/**
 * The global `ValidationPipe`'s `exceptionFactory`: one 400 listing every
 * failing constraint message.
 *
 * A DTO rule can also tag itself with a stable `errorCode`
 * (`libs/constant/error-code.constant.ts`) through class-validator's
 * `context` option — `@ArrayMaxSize(5, { context: { errorCode } })`. The 400
 * carries that code only when EVERY failing constraint carries the same one,
 * so a code is never attached to a failure it does not describe (a body that
 * also fails an untagged field gets no code). Untagged DTOs are unaffected:
 * their 400 keeps its exact key set.
 */
export function createValidationException(
  errors: ValidationError[],
): BadRequestException {
  const errorCode = resolveSharedErrorCode(errors);
  return new BadRequestException({
    message: collectValidationMessages(errors),
    error: "Bad Request",
    ...(errorCode ? { errorCode } : {}),
  });
}

function collectValidationMessages(errors: ValidationError[]): string[] {
  const messages = errors.flatMap((error) => {
    const constraintMessages = Object.values(error.constraints ?? {});
    const childMessages = error.children?.length
      ? collectValidationMessages(error.children)
      : [];
    return [...constraintMessages, ...childMessages];
  });

  return messages.length > 0 ? messages : ["Validation failed"];
}

/** One `errorCode` (or `null`) per failing constraint, depth-first. */
function collectConstraintErrorCodes(
  errors: ValidationError[],
): (string | null)[] {
  return errors.flatMap((error) => {
    const ownCodes = Object.keys(error.constraints ?? {}).map(
      (constraintName) => {
        const context: unknown = error.contexts?.[constraintName];
        const errorCode =
          typeof context === "object" && context !== null
            ? (context as { errorCode?: unknown }).errorCode
            : undefined;
        return typeof errorCode === "string" ? errorCode : null;
      },
    );
    const childCodes = error.children?.length
      ? collectConstraintErrorCodes(error.children)
      : [];
    return [...ownCodes, ...childCodes];
  });
}

function resolveSharedErrorCode(errors: ValidationError[]): string | null {
  const errorCodes = collectConstraintErrorCodes(errors);
  const [firstCode] = errorCodes;
  if (!firstCode) return null;
  return errorCodes.every((code) => code === firstCode) ? firstCode : null;
}
