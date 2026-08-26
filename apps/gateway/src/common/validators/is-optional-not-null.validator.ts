import { ValidateIf, ValidationOptions } from "class-validator";

/**
 * `@IsOptional()`, but only for `undefined`.
 *
 * class-validator's `@IsOptional()` skips every other validator on the property
 * when the value is `undefined` **or `null`**, so an explicit `null` reaches the
 * service untouched. On a field backed by a NOT NULL column that is not a
 * "clear it" instruction — it is a client mistake that used to surface as a 500
 * (a `TypeError` in the service, or a driver error at the INSERT) instead of a
 * 400 the caller can act on.
 *
 * Use this in place of `@IsOptional()` whenever the field may be omitted but may
 * never be `null`; the value then falls through to `@IsNumber()`/`@IsBoolean()`
 * /… as normal and produces a validation message. Keep `@IsOptional()` on the
 * genuinely nullable fields, where `null` really does mean "clear it".
 */
export function IsOptionalNotNull(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateIf(
    (_object: object, value: unknown) => value !== undefined,
    validationOptions,
  );
}
