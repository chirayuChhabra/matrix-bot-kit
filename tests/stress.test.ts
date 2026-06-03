import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../js/src/index";

// Mock Context factory
function createMockContext(
	overrides: Partial<Context> | Record<string, unknown> = {},
): Context {
	const body = overrides.body ?? "hello";
	const msgOverrides = overrides.message ?? {};
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

describe("Aggressive Stress Tests", () => {
	test("High Concurrency Command Dispatch", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		let counter = 0;
		bot.command("!increment", async (_ctx) => {
			counter++;
		});

		const ITERATIONS = 10000;
		const promises = [];
		const startTime = performance.now();

		for (let i = 0; i < ITERATIONS; i++) {
			promises.push(bot.dispatch(createMockContext({ body: "!increment" })));
		}

		await Promise.all(promises);
		const endTime = performance.now();

		expect(counter).toBe(ITERATIONS);
		const durationMs = endTime - startTime;
		console.log(
			`[Stress Test] Dispatching ${ITERATIONS} commands took ${durationMs.toFixed(2)}ms`,
		);
		console.log(
			`[Stress Test] Throughput: ${((ITERATIONS / durationMs) * 1000).toFixed(2)} ops/sec`,
		);
	});

	test("Deep Middleware Chain", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		const middlewareCount = 100;
		const pipeline = Array.from({ length: middlewareCount }, (_, _i) => {
			return async (ctx: Context, next: () => Promise<void>) => {
				ctx.session = ctx.session || {};
				ctx.session.chain = (ctx.session.chain || 0) + 1;
				await next();
			};
		});

		bot.command("!chain", ...pipeline, async (ctx) => {
			ctx.session.done = true;
		});

		const ITERATIONS = 1000;
		const promises = [];
		const startTime = performance.now();

		for (let i = 0; i < ITERATIONS; i++) {
			promises.push(bot.dispatch(createMockContext({ body: "!chain" })));
		}

		await Promise.all(promises);
		const endTime = performance.now();
		const durationMs = endTime - startTime;
		console.log(
			`[Stress Test] ${ITERATIONS} commands with ${middlewareCount} middlewares took ${durationMs.toFixed(2)}ms`,
		);
		console.log(
			`[Stress Test] Throughput: ${((ITERATIONS / durationMs) * 1000).toFixed(2)} ops/sec`,
		);
	});

	test("Mixed Command Group Routing", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		const hitCounts: Record<string, number> = {};

		for (let i = 0; i < 50; i++) {
			const group = bot.group(`!group${i}`);
			group.command("action", async () => {
				hitCounts[`group${i}`] = (hitCounts[`group${i}`] || 0) + 1;
			});
		}

		const ITERATIONS = 10000;
		const promises = [];
		const startTime = performance.now();

		for (let i = 0; i < ITERATIONS; i++) {
			const groupId = Math.floor(Math.random() * 50);
			promises.push(
				bot.dispatch(createMockContext({ body: `!group${groupId} action` })),
			);
		}

		await Promise.all(promises);
		const endTime = performance.now();

		const durationMs = endTime - startTime;
		console.log(
			`[Stress Test] Routing ${ITERATIONS} mixed commands across 50 groups took ${durationMs.toFixed(2)}ms`,
		);
		console.log(
			`[Stress Test] Throughput: ${((ITERATIONS / durationMs) * 1000).toFixed(2)} ops/sec`,
		);

		const totalHits = Object.values(hitCounts).reduce(
			(acc, count) => acc + count,
			0,
		);
		expect(totalHits).toBe(ITERATIONS);
	});
});
