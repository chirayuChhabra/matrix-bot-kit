import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: ["src/index.ts"],
		format: ["cjs", "esm"],
		dts: true,
		splitting: false,
		sourcemap: true,
		clean: true,
	},
	{
		entry: ["src/cli.ts"],
		format: ["esm"],
		dts: false,
		splitting: false,
		sourcemap: true,
		clean: false,
	}
]);
