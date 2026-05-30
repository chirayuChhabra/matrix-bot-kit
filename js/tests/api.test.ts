import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: dynamic types
function createMockContext(overrides: any = {}): Context {
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
		// biome-ignore lint/suspicious/noExplicitAny: testing mocks
	} as any as Context;
}

describe("MatrixBot Fluent API", () => {
	test("bot.command handles commands", async () => {
		let called = false;
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.command("!ping", async (_ctx) => {
			called = true;
		});

		await bot.dispatch(createMockContext({ body: "!ping" }));
		expect(called).toBe(true);
	});

	test("bot.group handles prefixed commands", async () => {
		let called = false;
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		const group = bot.group("!admin");
		group.command("status", async (_ctx) => {
			called = true;
		});

		await bot.dispatch(createMockContext({ body: "!admin status" }));
		expect(called).toBe(true);
	});

	test("bot.on handles matrix events", async () => {
		let called = false;
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.on.message(async (_ctx) => {
			called = true;
		});

		await bot.dispatchListeners(
			{
				id: "test-1",
				kind: "matrix.message",
				source: "matrix",
				request: createMockContext(),
				timestamp: new Date(),
			},
			{ matrix: undefined },
		);
		expect(called).toBe(true);
	});

	test("middleware execution order", async () => {
		const order: number[] = [];
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.command(
			"!test",
			async (_ctx, next) => {
				order.push(1);
				await next();
				order.push(4);
			},
			async (_ctx, next) => {
				order.push(2);
				await next();
				order.push(3);
			},
			async (_ctx) => {
				order.push(5);
			},
		);

		await bot.dispatch(createMockContext({ body: "!test" }));
		expect(order).toEqual([1, 2, 5, 3, 4]);
	});
});
