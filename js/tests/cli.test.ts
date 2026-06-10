import { describe, expect, test } from "bun:test";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
	getBotTs,
	getDeployWorkflow,
	getDockerCompose,
	getDockerfile,
	getEnvExample,
	getIndexTs,
	getLoggerMiddlewareTs,
	getModuleTs,
	getPackageJson,
	getReadme,
	getTsConfig,
} from "../src/cli/templates.js";

const execAsync = promisify(exec);

describe("CLI Tests", () => {
	test("returns version", async () => {
		const cliPath = Bun.fileURLToPath(new URL("../src/cli.ts", import.meta.url));
		const { stdout } = await execAsync(`bun run ${cliPath} --version`);
		expect(stdout.trim().length).toBeGreaterThan(0);
	});

	describe("Template Generation Snapshots", () => {
		test("getPackageJson", () => {
			expect(getPackageJson("my-bot", "1.0.0")).toMatchSnapshot();
		});

		test("getTsConfig", () => {
			expect(getTsConfig()).toMatchSnapshot();
		});

		test("getBotTs", () => {
			expect(getBotTs()).toMatchSnapshot();
		});

		test("getLoggerMiddlewareTs", () => {
			expect(getLoggerMiddlewareTs()).toMatchSnapshot();
		});

		test("getModuleTs", () => {
			expect(getModuleTs("example")).toMatchSnapshot();
		});

		test("getIndexTs", () => {
			expect(getIndexTs("MyCoolBot")).toMatchSnapshot();
		});

		test("getDockerfile", () => {
			expect(getDockerfile()).toMatchSnapshot();
		});

		test("getDockerCompose", () => {
			expect(getDockerCompose("my-bot")).toMatchSnapshot();
		});

		test("getEnvExample", () => {
			expect(getEnvExample()).toMatchSnapshot();
		});

		test("getDeployWorkflow", () => {
			expect(getDeployWorkflow()).toMatchSnapshot();
		});

		test("getReadme", () => {
			expect(getReadme("MyCoolBot")).toMatchSnapshot();
		});
	});
});
