import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../src/index";

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
	} as any as Context;
}

describe("MatrixBot Utility Commands", () => {
	test("registers utility commands when utility is true", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://example.org",
			username: "bot",
			password: "123",
			recoveryKey: "abc",
			admin: ["@admin:example.org"],
			config: { utility: true },
		});

		// Check if !ping is registered
		const pingCtx = createMockContext({ body: "!ping" });
		let replied = "";
		pingCtx.reply.text = (async (text: string) => {
			replied = text;
		}) as any;

		await bot.dispatch(pingCtx);
		expect(replied).toBe("pong");
	});

	test("maintenance mode intercepts commands", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://example.org",
			username: "bot",
			password: "123",
			recoveryKey: "abc",
			admin: ["@admin:example.org"],
			config: { utility: true },
		});

		process.env.MAINTENANCE_PASSWORD = "secret_password";
		if (typeof Bun !== "undefined")
			Bun.env.MAINTENANCE_PASSWORD = "secret_password";

		const maintCtx = createMockContext({
			body: "!maintenance secret_password",
			room: { isDirect: true },
			sender: { isAdmin: () => true },
		});

		let replied = "";
		maintCtx.reply.text = (async (text: string) => {
			replied = text;
		}) as any;
		await bot.dispatch(maintCtx);
		expect(replied).toBe("Maintenance mode is now ON.");

		// Test intercept
		const pingCtx = createMockContext({ body: "!ping" });
		let pingReplied = "";
		pingCtx.reply.text = (async (text: string) => {
			pingReplied = text;
		}) as any;
		await bot.dispatch(pingCtx);
		expect(pingReplied).toBe("Bot is under maintenance");
	});
});
