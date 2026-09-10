// @ts-check
import eslint from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output and coverage are generated, never authored. Without this,
    // a bare `npx eslint .` tries to type-check `dist/**/main.js` against the
    // tsconfig that produced it and reports "not found by the project service"
    // — 10 parse errors that look like a broken checkout and are not.
    ignores: ["eslint.config.mjs", "dist/**", "coverage/**", ".temp/**"],
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
      // "Explicit return types on all methods." The 142-violation backlog was
      // swept on 2026-09-10, so this is an error now: a warn nobody has to fix
      // is a rule that decays back into a backlog.
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "error",
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
  {
    // Plain-JS tooling: the pm2 process file, the postman generators, and the
    // scripts/ helpers. These are real source and worth linting, but they are
    // deliberately outside every tsconfig, so the type-aware rules cannot
    // resolve them and fail with a parse error instead of a lint message.
    // Lint them with the syntactic rules only.
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    rules: {
      // These are CLI tools; stdout IS their output channel, so the NestJS
      // Logger rule does not apply.
      "no-console": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    // pm2 reads this with require(), so it stays CommonJS.
    files: ["ecosystem.config.js"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
);
