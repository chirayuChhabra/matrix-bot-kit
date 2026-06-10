#!/usr/bin/env node

import { intro, outro, text, spinner, isCancel, cancel, confirm } from "@clack/prompts";
import { join } from "node:path";
import { mkdir, writeFile, readFile, stat, appendFile } from "node:fs/promises";
import picocolors from "picocolors";
import { createRequire } from "node:module";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const sdkVersion = pkg.version;

import {
	getBotTs,
	getDeployWorkflow,
	getDockerCompose,
	getDockerfile,
	getEnvExample,
	getIndexTs,
	getLoggerMiddlewareTs,
	getPackageJson,
	getReadme,
	getTsConfig,
	getModuleTs,
} from "./cli/templates.js";

async function fileExists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function safeWriteFile(path: string, content: string, force = false) {
	if (!force && await fileExists(path)) {
		console.log(picocolors.dim(`Skipped ${path} (already exists)`));
		return;
	}
	await writeFile(path, content);
}

function showHelp() {
	console.log(`
${picocolors.bold(picocolors.blue("Matrix Bot Kit CLI"))} v${sdkVersion}

${picocolors.bold("Usage:")}
  mb <command> [options]

${picocolors.bold("Commands:")}
  init [directory]              Initialize a new Matrix bot project.
  generate module <name>        Generate a new bot module. (Aliases: g mo, g module)

${picocolors.bold("Options:")}
  -h, --help                    Show this help message.
  -v, --version                 Show the version number.
`);
}

async function handleInit(args: string[]) {
	let targetDir = args[0];

	intro(picocolors.bgBlue(picocolors.white(" Matrix Bot Kit - Setup ")));

	if (!targetDir) {
		const dirName = await text({
			message: "Where would you like to initialize the bot?",
			placeholder: "./my-matrix-bot",
			initialValue: "./my-matrix-bot",
		});

		if (isCancel(dirName)) {
			cancel("Operation cancelled.");
			process.exit(0);
		}

		targetDir = dirName as string;
	}

	targetDir = targetDir.trim();
	if (!targetDir || targetDir.includes("..")) {
		cancel("Invalid target directory.");
		process.exit(1);
	}

	const wantsDocker = await confirm({
		message: "Do you want to generate Dockerfiles for deployment?",
		initialValue: true,
	});
	if (isCancel(wantsDocker)) { cancel("Operation cancelled."); process.exit(0); }

	const wantsCI = await confirm({
		message: "Do you want to generate GitHub Actions for CI/CD?",
		initialValue: true,
	});
	if (isCancel(wantsCI)) { cancel("Operation cancelled."); process.exit(0); }

	let botName = targetDir === "." || targetDir === "./"
		? process.cwd().split(/[/\\]/).pop() || "my-matrix-bot"
		: targetDir.split(/[/\\]/).pop() || "my-matrix-bot";

	const pkgName = botName.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/^-+|-+$/g, "") || "my-matrix-bot";

	const s = spinner();
	s.start("Generating files...");

	try {
		await mkdir(targetDir, { recursive: true });
		await mkdir(join(targetDir, "src"), { recursive: true });
		await mkdir(join(targetDir, "src", "middlewares"), { recursive: true });
		await mkdir(join(targetDir, "src", "modules"), { recursive: true });

		if (wantsCI) {
			await mkdir(join(targetDir, ".github", "workflows"), { recursive: true });
		}

		// Handle package.json safely
		const packageJsonPath = join(targetDir, "package.json");
		let mergedPackageJsonStr = getPackageJson(pkgName, sdkVersion);
		try {
			const existingStr = await readFile(packageJsonPath, "utf-8");
			const existing = JSON.parse(existingStr);
			const generated = JSON.parse(mergedPackageJsonStr);
			existing.name = existing.name || generated.name;
			existing.type = "module";
			existing.scripts = { ...(existing.scripts || {}), ...generated.scripts };
			existing.dependencies = { ...(existing.dependencies || {}), ...generated.dependencies };
			existing.devDependencies = { ...(existing.devDependencies || {}), ...generated.devDependencies };
			mergedPackageJsonStr = JSON.stringify(existing, null, 2) + "\n";
		} catch (e) {
			console.log(picocolors.yellow("Warning: Failed to merge package.json, using default."));
		}
		await writeFile(packageJsonPath, mergedPackageJsonStr);

		// Handle tsconfig.json safely
		const tsconfigPath = join(targetDir, "tsconfig.json");
		let mergedTsConfigStr = getTsConfig();
		try {
			const existingStr = await readFile(tsconfigPath, "utf-8");
			const existing = JSON.parse(existingStr);
			const generated = JSON.parse(mergedTsConfigStr);
			existing.compilerOptions = { ...(existing.compilerOptions || {}), ...generated.compilerOptions };
			if (!existing.include) existing.include = [];
			if (!existing.include.includes("src/**/*")) existing.include.push("src/**/*");
			mergedTsConfigStr = JSON.stringify(existing, null, 2) + "\n";
		} catch (e) {
			console.log(picocolors.yellow("Warning: Failed to merge tsconfig.json, using default."));
		}
		await writeFile(tsconfigPath, mergedTsConfigStr);

		await safeWriteFile(join(targetDir, "src", "index.ts"), getIndexTs(botName));
		await safeWriteFile(join(targetDir, "src", "bot.ts"), getBotTs());
		await safeWriteFile(join(targetDir, "src", "middlewares", "logger.ts"), getLoggerMiddlewareTs());
		await safeWriteFile(join(targetDir, "src", "modules", "example.ts"), getModuleTs("example"));

		if (wantsDocker) {
			await safeWriteFile(join(targetDir, "Dockerfile"), getDockerfile());
			await safeWriteFile(join(targetDir, "docker-compose.yaml"), getDockerCompose(pkgName));
		}
		
		await safeWriteFile(join(targetDir, ".env.example"), getEnvExample());

		if (wantsCI) {
			await safeWriteFile(
				join(targetDir, ".github", "workflows", "deploy.yml"),
				getDeployWorkflow(),
			);
		}
		
		await safeWriteFile(join(targetDir, "README.md"), getReadme(botName));

		// Gitignore
		const gitignoreContent = `node_modules/
dist/
.env
data/
`;
		await safeWriteFile(join(targetDir, ".gitignore"), gitignoreContent);

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

async function handleGenerateModule(args: string[]) {
	intro(picocolors.bgBlue(picocolors.white(" Matrix Bot Kit - Generator ")));
	
	let moduleName = args[0];
	if (!moduleName) {
		const namePrompt = await text({
			message: "What is the name of the module?",
			placeholder: "weather",
		});
		if (isCancel(namePrompt)) { cancel("Operation cancelled."); process.exit(0); }
		moduleName = namePrompt as string;
	}

	// Basic validation
	if (!/^[a-zA-Z0-9_]+$/.test(moduleName)) {
		cancel("Invalid module name. Use alphanumeric characters and underscores only.");
		process.exit(1);
	}

	const s = spinner();
	s.start(`Generating module ${moduleName}...`);

	const modulePath = join(process.cwd(), "src", "modules", `${moduleName}.ts`);
	if (await fileExists(modulePath)) {
		s.stop("Failed");
		cancel(`Module ${moduleName} already exists at src/modules/${moduleName}.ts`);
		process.exit(1);
	}

	try {
		await mkdir(join(process.cwd(), "src", "modules"), { recursive: true });
		await writeFile(modulePath, getModuleTs(moduleName));

		// Inject into bot.ts
		const botTsPath = join(process.cwd(), "src", "bot.ts");
		if (await fileExists(botTsPath)) {
			let botTsContent = await readFile(botTsPath, "utf-8");
			
			const importStatement = `import { ${moduleName}Module } from "./modules/${moduleName}.js";\n`;
			if (!botTsContent.includes(importStatement.trim())) {
				const lastImportIndex = botTsContent.lastIndexOf("import ");
				if (lastImportIndex !== -1) {
					const endOfLastImport = botTsContent.indexOf("\n", lastImportIndex);
					botTsContent = botTsContent.slice(0, endOfLastImport + 1) + importStatement + botTsContent.slice(endOfLastImport + 1);
				} else {
					botTsContent = importStatement + botTsContent;
				}
			}

			const useStatement = `\nbot.use(${moduleName}Module);\n`;
			if (!botTsContent.includes(`bot.use(${moduleName}Module)`)) {
				botTsContent += useStatement;
			}

			await writeFile(botTsPath, botTsContent);
		} else {
			console.log(picocolors.yellow(`\nWarning: src/bot.ts not found. Module ${moduleName} was generated but not automatically registered.`));
		}

		s.stop("Module generated!");
		outro(picocolors.green(`Successfully generated module ${moduleName}!`));
	} catch (e) {
		s.stop("Failed");
		console.error(picocolors.red("Error:"), e);
		process.exit(1);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "-h" || command === "--help") {
		showHelp();
		process.exit(0);
	}

	if (command === "-v" || command === "--version") {
		console.log(sdkVersion);
		process.exit(0);
	}

	if (command === "init") {
		await handleInit(args.slice(1));
	} else if (command === "generate" || command === "g") {
		const subCommand = args[1];
		if (subCommand === "module" || subCommand === "mo") {
			await handleGenerateModule(args.slice(2));
		} else {
			console.log(picocolors.yellow(`Unknown generate command: ${subCommand}`));
			showHelp();
			process.exit(1);
		}
	} else {
		console.log(picocolors.yellow(`Unknown command: ${command}`));
		showHelp();
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
