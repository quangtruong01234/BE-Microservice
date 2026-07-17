import { isPublicId } from "@app/common";
import {
  PublicIdPrefix,
  PUBLIC_ID_RANDOM_LENGTH,
} from "libs/constant/public-id.constant";
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";

export function IsPublicId(
  prefix: PublicIdPrefix,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: "isPublicId",
      target: target.constructor,
      propertyName: propertyKey.toString(),
      constraints: [prefix],
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isPublicId(prefix, value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must match ${prefix}_<${PUBLIC_ID_RANDOM_LENGTH} alphanumeric characters>`;
        },
      },
    });
  };
}
