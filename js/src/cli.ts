#!/usr/bin/env node

import { intro, outro, text, spinner, isCancel, cancel } from "@clack/prompts";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import picocolors from "picocolors";
import {
	getBotTs,
	getDeployWorkflow,
	getDockerCompose,
	getDockerfile,
	getEchoHandlerTs,
	getEchoIndexTs,
	getEnvExample,
	getIndexTs,
	getLoggerMiddlewareTs,
	getPackageJson,
	getReadme,
	getTsConfig,
} from "./cli/templates.js";

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (command !== "init") {
		console.log(
			picocolors.yellow("Usage: matrix-bot-kit init [directory]"),
		);
		process.exit(1);
	}

	let targetDir = args[1] || ".";

	intro(picocolors.bgBlue(picocolors.white(" Matrix Bot Kit - Setup ")));

	if (targetDir === ".") {
		const dirName = await text({
			message: "What is your bot's name? (This will create a new folder)",
			placeholder: "my-matrix-bot",
			initialValue: "my-matrix-bot",
		});

		if (isCancel(dirName)) {
			cancel("Operation cancelled.");
			process.exit(0);
		}

		targetDir = dirName as string;
	}

	const botName = targetDir.split("/").pop() || "my-matrix-bot";

	const s = spinner();
	s.start("Generating files...");

	try {
		await mkdir(targetDir, { recursive: true });
		await mkdir(join(targetDir, "src"), { recursive: true });
		await mkdir(join(targetDir, "src", "middlewares"), { recursive: true });
		await mkdir(join(targetDir, "src", "modules", "echo"), { recursive: true });
		await mkdir(join(targetDir, ".github", "workflows"), { recursive: true });

		// Write files
		await writeFile(join(targetDir, "package.json"), getPackageJson(botName));
		await writeFile(join(targetDir, "tsconfig.json"), getTsConfig());
		await writeFile(join(targetDir, "src", "index.ts"), getIndexTs(botName));
		await writeFile(join(targetDir, "src", "bot.ts"), getBotTs());
		await writeFile(join(targetDir, "src", "middlewares", "logger.ts"), getLoggerMiddlewareTs());
		await writeFile(join(targetDir, "src", "modules", "echo", "handler.ts"), getEchoHandlerTs());
		await writeFile(join(targetDir, "src", "modules", "echo", "index.ts"), getEchoIndexTs());
		await writeFile(join(targetDir, "Dockerfile"), getDockerfile());
		await writeFile(join(targetDir, "docker-compose.yml"), getDockerCompose(botName));
		await writeFile(join(targetDir, ".env.example"), getEnvExample());
		await writeFile(join(targetDir, ".env"), getEnvExample());
		await writeFile(
			join(targetDir, ".github", "workflows", "deploy.yml"),
			getDeployWorkflow(),
		);
		await writeFile(join(targetDir, "README.md"), getReadme(botName));

		s.stop("Files generated!");

		outro(
			picocolors.green("Your Matrix bot has been successfully created!") +
				"\n\n" +
				picocolors.cyan("Next steps:") +
				"\n" +
				picocolors.dim(`1. cd ${targetDir}`) +
				"\n" +
				picocolors.dim("2. Fill out the .env file with your bot's credentials") +
				"\n" +
				picocolors.dim("3. bun install") +
				"\n" +
				picocolors.dim("4. bun run dev") +
				"\n\n" +
				picocolors.blue("Happy coding! 🤖"),
		);
	} catch (err) {
		s.stop("Failed to generate files");
		console.error(picocolors.red("Error:"), err);
		process.exit(1);
	}
}

main().catch(console.error);
