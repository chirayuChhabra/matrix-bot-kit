import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../src/index";

import { createMockContext } from "./mock_context";

describe("MatrixBot Utility Commands", () => {
	test("registers utility commands when utility is true", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://example.org",
			username: "bot",
			password: "123",
			recoveryKey: "abc",
			admin: ["@admin:example.org"],
			config: { utility: { maintenancePassword: "secret_password" } },
		});

		// Check if !ping is registered
		const pingCtx = createMockContext({ body: "!ping" });
		let replied = "";
		pingCtx.reply.text = (async (text: string) => {
			replied = text;
			// biome-ignore lint/suspicious/noExplicitAny: testing mocks
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
			config: { utility: { maintenancePassword: "secret_password" } },
		});

		const maintCtx = createMockContext({
			body: "!maintenance",
			room: { isDirect: true },
			sender: { isAdmin: () => true },
		});

		let redacted = false;
		maintCtx.prompt = async (text: string) => {
			const replyCtx = createMockContext({
				body: "secret_password",
				room: { isDirect: true },
				sender: { isAdmin: () => true },
			});
			replyCtx.message.redact = async () => {
				redacted = true;
			};
			return replyCtx;
		};

		let replied = "";
		maintCtx.reply.text = (async (text: string) => {
			replied = text;
			// biome-ignore lint/suspicious/noExplicitAny: testing mocks
		}) as any;
		await bot.dispatch(maintCtx);
		expect(replied).toBe("Maintenance mode is now ON.");
		expect(redacted).toBe(true);

		// Test intercept
		const pingCtx = createMockContext({ body: "!ping" });
		let pingReplied = "";
		pingCtx.reply.text = (async (text: string) => {
			pingReplied = text;
			// biome-ignore lint/suspicious/noExplicitAny: testing mocks
		}) as any;
		await bot.dispatch(pingCtx);
		expect(pingReplied).toBe("Bot is under maintenance");
	});
});
