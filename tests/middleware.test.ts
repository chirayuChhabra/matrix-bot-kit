import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../js/src/index";

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

describe("MatrixBot Middleware Resilience", () => {
	test("Stops chain execution if next() is not called", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		let middleware1Hit = false;
		let middleware2Hit = false;
		let handlerHit = false;

		bot.command(
			"!stop",
			async (_ctx, next) => {
				middleware1Hit = true;
				// Decides NOT to call next()
			},
			async (_ctx, next) => {
				middleware2Hit = true;
				await next();
			},
			async () => {
				handlerHit = true;
			},
		);

		await bot.dispatch(createMockContext({ body: "!stop" }));

		expect(middleware1Hit).toBe(true);
		expect(middleware2Hit).toBe(false); // Should never be reached
		expect(handlerHit).toBe(false); // Should never be reached
	});

	test("Shares and mutates session context safely across middlewares", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		let finalValue = 0;

		bot.command(
			"!mutate",
			async (ctx, next) => {
				ctx.session = ctx.session || {};
				ctx.session.value = 10;
				await next();
			},
			async (ctx, next) => {
				ctx.session.value *= 2;
				await next();
			},
			async (ctx) => {
				finalValue = ctx.session.value;
			},
		);

		await bot.dispatch(createMockContext({ body: "!mutate" }));
		expect(finalValue).toBe(20);
	});

	test("Middleware throwing an error triggers error handler and halts chain", async () => {
		let caughtError: unknown;
		let handlerHit = false;

		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
			onError: (ctx) => {
				caughtError = ctx.error;
			},
		});

		bot.command(
			"!throw",
			async () => {
				throw new Error("Middleware crash");
			},
			async () => {
				handlerHit = true;
			},
		);

		await bot.dispatch(createMockContext({ body: "!throw" }));

		expect(caughtError).toBeInstanceOf(Error);
		expect((caughtError as Error).message).toBe("Middleware crash");
		expect(handlerHit).toBe(false);
	});
});
