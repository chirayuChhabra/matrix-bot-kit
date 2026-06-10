import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../src/index";

import { createMockContext } from "./mock_context";

describe("JS SDK Hammering & Scale Tests", () => {
	test("Hammering massive wildcard listener evaluations", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		// Add 100 listeners that match all messages
		let totalHits = 0;
		for (let i = 0; i < 100; i++) {
			bot.on.message(async () => {
				totalHits++;
			});
		}

		const ITERATIONS = 1000;
		const promises: Promise<number>[] = [];
		const start = performance.now();

		for (let i = 0; i < ITERATIONS; i++) {
			const ctx = createMockContext();
			promises.push(
				bot.dispatchListeners(
					{
						id: `evt-${i}`,
						kind: "matrix.message",
						source: "matrix",
						request: ctx,
						timestamp: new Date(),
					},
					{ matrix: ctx },
				),
			);
		}

		await Promise.all(promises);
		const end = performance.now();

		// 1000 iterations * 100 listeners = 100,000 listener executions
		expect(totalHits).toBe(100000);
		console.log(
			`[JS Hammer Test] 100,000 listener executions took ${(end - start).toFixed(2)}ms`,
		);
	});
});
