import { describe, expect, test } from "bun:test";
import { type Context, MatrixBot } from "../js/src/index";

function createMockContext(
	overrides: Partial<Context> | Record<string, any> = {},
): Context {
	const body = (overrides as any).body ?? "!echo test";
	const msgOverrides = (overrides as any).message ?? {};

	const sendCalls: any[] = [];
	const replyCalls: any[] = [];

	const mockSender: any = {
		text: async (text: string) => {
			sendCalls.push({ type: "text", text });
			return {
				id: "$sent_1",
				roomId: "!room:example.com",
				react: async (emoji: string) => {},
				redact: async () => {},
				edit: async (newText: string) => {},
				reply: mockSender,
			};
		},
		markdown: async (text: string) => {
			sendCalls.push({ type: "markdown", text });
			return { id: "$sent_1", roomId: "!room:example.com", reply: mockSender };
		},
		poll: async (options: any) => {
			return {
				id: "$poll_1",
				roomId: "!room:example.com",
				tag: options.tag,
				close: async () => {},
				reply: mockSender,
			};
		},
	};

	const mockReply: any = {
		text: async (text: string) => {
			replyCalls.push({ type: "text", text });
			return { id: "$reply_1", roomId: "!room:example.com", reply: mockSender };
		},
		markdown: async (text: string) => {
			replyCalls.push({ type: "markdown", text });
			return { id: "$reply_1", roomId: "!room:example.com", reply: mockSender };
		},
	};

	const ctx: any = {
		message: {
			id: "$msg_1",
			type: "text",
			rawBody: body,
			body: body,
			react: async () => {},
			redact: async () => {},
			...msgOverrides,
		},
		room: {
			id: "!room:example.com",
			isDirect: false,
			...(overrides.room ?? {}),
		},
		sender: {
			id: "@user:example.com",
			userId: "@user:example.com",
			mention: "@user:example.com",
			isAdmin: () => false,
			isModerator: () => false,
			...(overrides.sender ?? {}),
		},
		send: mockSender,
		reply: mockReply,
		args: "",
		session: {},
		downloadMedia: async () => Buffer.from([]),
		state: {},
		_sendCalls: sendCalls,
		_replyCalls: replyCalls,
		...overrides,
	};

	return ctx as Context;
}

describe("Simplified API & Developer Experience", () => {
	test("Minimal bot initialization with zero boilerplate", () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "simplebot",
			password: "secretpassword",
		});

		expect(bot).toBeDefined();
		expect(bot.admins).toEqual([]);
		expect(bot.moderators).toEqual([]);
		expect(bot.status).toBe("idle");
	});

	test("Command aliases and case-insensitivity", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let executedCount = 0;
		bot.command(
			["!echo", "!say", "!repeat"],
			{ description: "Repeats input" },
			async (ctx) => {
				executedCount++;
				expect(ctx.args).toBe("hello world");
			},
		);

		// 1. Lowercase primary name
		await bot.dispatch(createMockContext({ body: "!echo hello world" }));
		// 2. Uppercase primary name
		await bot.dispatch(createMockContext({ body: "!ECHO hello world" }));
		// 3. Lowercase alias
		await bot.dispatch(createMockContext({ body: "!say hello world" }));
		// 4. Mixed case alias
		await bot.dispatch(createMockContext({ body: "!RePeAt hello world" }));

		expect(executedCount).toBe(4);
	});

	test("Message immutability and ctx.args separation", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let checked = false;
		bot.command("!greet", async (ctx) => {
			// Message body is NOT mutated (fixes API-11)
			expect(ctx.message.body).toBe("!greet Alice Bob");
			expect(ctx.message.rawBody).toBe("!greet Alice Bob");
			// Unconsumed args are cleanly isolated
			expect(ctx.args).toBe("Alice Bob");
			// Command metadata is structured
			expect(ctx.command).toEqual({
				name: "!greet",
				alias: "!greet",
				input: "Alice Bob",
			});
			checked = true;
		});

		await bot.dispatch(createMockContext({ body: "!greet Alice Bob" }));
		expect(checked).toBe(true);
	});

	test("Typed arguments parsing via options.args", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let parsedResult: any;
		bot.command(
			"!add",
			{
				description: "Adds two numbers",
				args: (input: string) => {
					const [a, b] = input.split(/\s+/).map(Number);
					if (isNaN(a) || isNaN(b)) throw new Error("Must provide two numbers");
					return { a, b, sum: a + b };
				},
			},
			async (ctx) => {
				parsedResult = ctx.input;
			},
		);

		await bot.dispatch(createMockContext({ body: "!add 15 27" }));
		expect(parsedResult).toEqual({ a: 15, b: 27, sum: 42 });
	});

	test("Group middleware wraps all child commands and group default", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		const trail: string[] = [];

		const admin = bot.group("!admin", { description: "Admin tools" });
		admin.use(async (ctx, next) => {
			trail.push("group-mw-enter");
			await next();
			trail.push("group-mw-exit");
		});

		admin.command("status", async (ctx) => {
			trail.push("child-command");
		});

		admin.default(async (ctx) => {
			trail.push("group-default");
		});

		// 1. Dispatch child command
		await bot.dispatch(createMockContext({ body: "!admin status" }));
		expect(trail).toEqual(["group-mw-enter", "child-command", "group-mw-exit"]);

		trail.length = 0;

		// 2. Dispatch unmatched sub-command -> group default runs with middleware!
		await bot.dispatch(createMockContext({ body: "!admin unknown_action" }));
		expect(trail).toEqual(["group-mw-enter", "group-default", "group-mw-exit"]);
	});

	test("Nested command groups inherit prefixes and middleware", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let reached = false;
		const rootGroup = bot.group("!manage");
		const userSubGroup = rootGroup.group("users");

		userSubGroup.command("ban", async (ctx) => {
			reached = true;
			expect(ctx.args).toBe("@spammer:matrix.org spam");
		});

		await bot.dispatch(
			createMockContext({ body: "!manage users ban @spammer:matrix.org spam" }),
		);
		expect(reached).toBe(true);
	});

	test("Interactive prompts with pre-registered waiters", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let conversationCompleted = false;

		bot.command("!wizard", async (ctx) => {
			const q1 = await ctx.prompt.text!("What is your username?");
			if (q1.status !== "answered") return;
			expect(q1.text).toBe("alice");

			conversationCompleted = true;
		});

		const firstCtx = createMockContext({ body: "!wizard" });
		// Dispatch starts the command and registers prompt
		const dispatchPromise = bot.dispatch(firstCtx);

		// Yield event loop tick so command handler reaches ctx.prompt.text
		await new Promise((r) => setTimeout(r, 10));

		// Answer prompt immediately
		const answerCtx = createMockContext({ body: "alice" });
		await bot.dispatch(answerCtx);

		await dispatchPromise;
		expect(conversationCompleted).toBe(true);
	});

	test("Room sender works outside handlers for scheduled/external sends", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		const room = bot.room("!general:example.com");
		expect(room.roomId).toBe("!general:example.com");

		const sent = await room.send.text("System alert");
		expect(sent.id).toBeDefined();
		expect(sent.roomId).toBe("!general:example.com");
	});

	test("Poll resources with close() capability", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		const poll = await bot.room("!polls:example.com").send.poll({
			question: "Favorite language?",
			answers: ["TypeScript", "Rust", "Python"],
			tag: "lang-poll",
		});

		expect(poll.id).toBeDefined();
		expect(poll.tag).toBe("lang-poll");
		expect(typeof poll.close).toBe("function");
	});

	test("Background schedules with isolated execution", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let jobExecuted = false;
		const job = bot.schedule(
			"test-interval",
			{ everySec: 100 },
			async (ctx) => {
				jobExecuted = true;
			},
		);

		expect(job.name).toBe("test-interval");
		expect(typeof job.dispose).toBe("function");
		job.dispose();
	});

	test("External event dispatching via on.external and emitExternal", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let receivedPayload: any;
		bot.on.external<{ pr: number }>(async (ctx) => {
			receivedPayload = ctx.payload;
		});

		await bot.emitExternal("github", "pull_request", { pr: 42 });
		expect(receivedPayload).toEqual({ pr: 42 });
	});

	test("Modular bot extension installation with lifecycle setup and cleanup", async () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		let setupDone = false;
		let cleanupDone = false;

		bot.install({
			name: "metrics-plugin",
			setup: async (b) => {
				setupDone = true;
				b.command("!metrics", async () => {});
				return async () => {
					cleanupDone = true;
				};
			},
		});

		expect(setupDone).toBe(false);
		await bot.start();
		expect(setupDone).toBe(true);
		expect(bot.status).toBe("running");

		await bot.stop();
		expect(cleanupDone).toBe(true);
		expect(bot.status).toBe("stopped");
	});

	test("Automatic help generation describes commands clearly", () => {
		const bot = new MatrixBot({
			homeserverUrl: "https://matrix.org",
			username: "bot",
			password: "password",
		});

		bot.command(
			"!ping",
			{ description: "Health check ping", category: "General" },
			async () => {},
		);
		bot.command(
			"!echo",
			{ description: "Echo message back", category: "Utilities" },
			async () => {},
		);

		const helpMarkdown = bot.help();
		expect(helpMarkdown).toContain("!ping");
		expect(helpMarkdown).toContain("Health check ping");
		expect(helpMarkdown).toContain("!echo");
		expect(helpMarkdown).toContain("Echo message back");
	});
});
