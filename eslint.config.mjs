// @ts-check
import eslint from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["eslint.config.mjs"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      ecmaVersion: 5,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Rules below were prose in ai-docs/agent-context/conventions.md until
    // 2026-09-10. A rule a linter can check does not belong in a file an agent
    // has to read and remember. If you are tempted to re-document one of these
    // in markdown, don't — it is enforced here and in CI.
    rules: {
      // "No `any` — use proper types or generics; `unknown` + narrowing for
      // genuinely unknown shapes."
      "@typescript-eslint/no-explicit-any": "error",
      // "No `!` non-null assertion" — the entity exception is below.
      "@typescript-eslint/no-non-null-assertion": "error",
      // "ES modules only — never use require()."
      "@typescript-eslint/no-require-imports": "error",
      // "console.log() is banned in production code — use NestJS Logger."
      // Bootstrap in apps/*/src/main.ts is exempted below: it runs before a
      // Logger context is meaningful and its output is the startup banner.
      "no-console": "error",
      // "Never use relative imports deeper than 2 levels" — reaching `../../../`
      // means crossing a service or app boundary; use a path alias instead.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../../*"],
              message:
                "Relative import crosses too many levels — use a path alias (@app/common, @app/cached, @app/database) or libs/constant/...",
            },
          ],
        },
      ],
      // "Explicit return types on all methods." 144 pre-existing violations as
      // of 2026-09-10, so this cannot be an error yet without a sweep. Kept at
      // warn so new code is nudged and the backlog stays visible.
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
    },
  },
  {
    // TypeORM hydrates columns at runtime, so `!` there is a definite-assignment
    // assertion, not a non-null assertion. This is the one documented exception.
    files: ["**/entity/**/*.ts", "**/*.entity.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Startup banner — see no-console above.
    files: ["apps/*/src/main.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Cross-service RBAC grants import. Owed: move libs-worthy shared RBAC out
    // of apps/user/src/rbac so the gateway can reach it through an alias.
    files: [
      "apps/gateway/src/common/guards/role-auth.guard.ts",
      "apps/gateway/src/common/rbac/has-permission.util.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
