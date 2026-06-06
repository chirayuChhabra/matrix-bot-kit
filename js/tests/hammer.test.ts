import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../src/index";

function createMockContext(
	overrides: Partial<Context> | Record<string, any> = {},
): Context {
	const body = (overrides as any).body ?? "hello";
	const msgOverrides = (overrides as any).message ?? {};
	return {
		message: {
			id: "1",
			type: "text",
			rawBody: body,
			body: body,
			...msgOverrides,
		},
		room: {
			id: "1",
			isDirect: false,
			...(overrides.room ?? {}),
		},
		sender: {
			id: "@user:example.com",
			isAdmin: () => false,
			isModerator: () => false,
			...(overrides.sender ?? {}),
		},
		send: {
			text: async () => {},
			markdown: async () => {},
			media: async () => {},
			image: async () => {},
			file: async () => {},
			video: async () => {},
			poll: async () => {},
		},
		reply: {
			text: async () => {},
			markdown: async () => {},
		},
		downloadMedia: async () => Buffer.from([]),
		...overrides,
	} as unknown as Context;
}

import { CommandGroup } from "../src/index";

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
