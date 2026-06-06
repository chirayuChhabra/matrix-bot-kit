import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../js/src/index";

// Helper to create mock contexts easily
function createMockContext(overrides: Partial<Context> | Record<string, unknown> = {}): Context {
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

describe("MatrixBot Edge Cases", () => {
	test("Initializes correctly and throws on missing required options", () => {
		expect(
			() =>
				new MatrixBot({
					homeserverUrl: "http://localhost",
					username: "user",
					password: "password",
					// @ts-expect-error Missing admin and recoveryKey
				}),
		).toThrow();

		expect(
			() =>
				new MatrixBot({
					homeserverUrl: "http://localhost",
					username: "user",
					password: "password",
					recoveryKey: "key",
					// @ts-expect-error Missing admin
				}),
		).toThrow();
	});

	test("Handles duplicate command group registration by throwing", () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		const group1 = bot.group("!test");
		expect(() => {
			bot.useCommandGroup(group1);
		}).toThrow("already registered");

		expect(() => {
			bot.group("!test");
		}).toThrow("already registered");
	});

	test("Catches and forwards command exceptions to error handler", async () => {
		let caughtError: unknown;
		let phase: string | undefined;

		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
			onError: (ctx) => {
				caughtError = ctx.error;
				phase = ctx.phase;
			},
		});

		bot.command("!crash", async () => {
			throw new Error("Simulated Crash");
		});

		await bot.dispatch(createMockContext({ body: "!crash" }));
		expect(caughtError).toBeInstanceOf(Error);
		expect((caughtError as Error).message).toBe("Simulated Crash");
		expect(phase).toBe("dispatch");
	});

	test("Throws an error when trying to register empty or whitespace command names", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		expect(() => {
			bot.command(" ", async () => {});
		}).toThrow("name is required");

		expect(() => {
			bot.command("", async () => {});
		}).toThrow("name is required");
	});

	test("Handles incredibly large payloads without crashing", async () => {
		let executed = false;
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.command("!large", async (ctx) => {
			executed = true;
			expect(ctx.message.body.length).toBeGreaterThan(10000);
		});

		const hugeBody = "!large " + "A".repeat(50000);
		await bot.dispatch(createMockContext({ body: hugeBody }));
		
		expect(executed).toBe(true);
	});

	test("Ignores partial matches that don't match the command fully", async () => {
		let executed = false;
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.command("!ping", async () => {
			executed = true;
		});

		await bot.dispatch(createMockContext({ body: "!pingy" }));
		await bot.dispatch(createMockContext({ body: "!pin" }));
		
		expect(executed).toBe(false);
	});
});
