import { spawn } from "bun";

async function runTests() {
	const showLogs = process.argv.includes("--log");

	const steps = [
		{ name: "Rust Native Core", command: ["devbox", "run", "test"], cwd: ".", parser: parseCargoSummary },
		{ name: "JS SDK Integration", command: ["bun", "test", "tests"], cwd: "./js", parser: parseBunSummary },
		{ name: "Root E2E & Stress", command: ["bun", "test", "tests"], cwd: ".", parser: parseBunSummary },
	];

	let passed = 0;
	let totalStepSummaries: string[] = [];

	for (const step of steps) {
		process.stdout.write(`Running ${step.name}... `);
		if (showLogs) process.stdout.write("\n");
		
		const proc = spawn(step.command, {
			cwd: step.cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, FORCE_COLOR: "1" }
		});
		
		const exitCode = await proc.exited;
		const outText = await new Response(proc.stdout).text();
		const errText = await new Response(proc.stderr).text();

		let summary = step.parser(outText + "\n" + errText);
		if (exitCode !== 0) {
			summary += " (FAILED)";
		}
		totalStepSummaries.push(`${step.name}: ${summary}`);

		if (showLogs) {
			if (outText.trim()) process.stdout.write(outText + "\n");
			// Cargo prints build info to stderr. Don't use console.error to avoid red coloring in Bun
			if (errText.trim()) process.stdout.write(errText + "\n");
		}

		if (exitCode === 0) {
			if (showLogs) {
				console.log(`Result: ${summary}\n`);
			} else {
				console.log(summary);
			}
			passed++;
		} else {
			if (!showLogs) {
				console.log("FAILED");
				console.log("\n--- ERROR LOG ---");
				if (outText.trim()) console.log(outText);
				if (errText.trim()) console.log(errText);
				console.log("-----------------\n");
			} else {
				console.log("Result: FAILED\n");
			}
		}
	}

	console.log("\nTEST SUMMARY");
	console.log("--------------------------------");
	console.log(totalStepSummaries.join("\n"));
	console.log("--------------------------------");

	if (passed === steps.length) {
		console.log("Status: All test suites passed.");
		process.exit(0);
	} else {
		console.log(`Status: ${steps.length - passed} test suite(s) failed.`);
		process.exit(1);
	}
}

function parseCargoSummary(output: string): string {
	const regex = /test result: .*? (\d+) passed; (\d+) failed;/g;
	let totalPassed = 0;
	let totalFailed = 0;
	let found = false;
	let match;
	while ((match = regex.exec(output)) !== null) {
		totalPassed += parseInt(match[1], 10);
		totalFailed += parseInt(match[2], 10);
		found = true;
	}
	if (found) {
		return `${totalPassed}/${totalPassed + totalFailed} tests passed`;
	}
	return "Summary unavailable";
}

function parseBunSummary(output: string): string {
	const passedMatch = output.match(/(\d+)\s+pass/);
	const failedMatch = output.match(/(\d+)\s+fail/);
	if (passedMatch && failedMatch) {
		const passed = parseInt(passedMatch[1], 10);
		const failed = parseInt(failedMatch[1], 10);
		return `${passed}/${passed + failed} tests passed`;
	}
	return "Summary unavailable";
}

runTests();
