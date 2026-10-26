import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
	globalIgnores(["node_modules", "main.js"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs", "scripts/*.mjs"],
				},
			},
		},
	},
	{
		files: ["tests/**/*.ts", "scripts/**/*.mjs", "vitest.config.ts", "esbuild.config.mjs"],
		languageOptions: { globals: globals.node },
		rules: {
			"import/no-nodejs-modules": "off",
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	{
		files: ["scripts/**/*.mjs"],
		rules: {
			"obsidianmd/hardcoded-config-path": "off",
			"obsidianmd/rule-custom-message": "off",
		},
	},
]);
