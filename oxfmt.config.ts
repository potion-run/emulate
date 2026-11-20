import { defineConfig, type OxfmtConfig } from "oxfmt";

export default defineConfig({
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  endOfLine: "lf",
  trailingComma: "all",
  ternaries: true,
  sortPackageJson: true,
  insertFinalNewline: true,
  embeddedLanguageFormatting: "auto",
  sortImports: {
    newlinesBetween: false,
  },
  ignorePatterns: [
    "lib/**",
    "dist/**",
    "coverage/**",
    ".agent_sources/**",
    "tools/oxlint/anti-slop/**",
    "*.tgz",
  ],
} satisfies OxfmtConfig);
