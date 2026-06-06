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
			react: async () => {},
			redact: async () => {},
			...msgOverrides,
		},
		room: {
			id: "1",
			isDirect: false,
			...(overrides.room ?? {}),
		},
		sender: {
			id: "@user:example.com",
			mention: "<a href='https://matrix.to/#/@user:example.com'>user</a>",
			isAdmin: () => false,
			isModerator: () => false,
			...(overrides.sender ?? {}),
		},
		send: {
			text: async () => {},
			message: async () => {},
			markdown: async () => {},
			media: async () => {},
			image: async () => {},
			file: async () => {},
			video: async () => {},
			poll: async () => {},
		},
		reply: {
			text: async () => {},
			message: async () => {},
			markdown: async () => {},
		},
		downloadMedia: async () => Buffer.from([]),
		...overrides,
	} as unknown as Context;
}

describe("Advanced API Behaviors", () => {
	test("Event listener filtering - skips non-matching rooms", async () => {
		let executed = false;
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.on.message({ rooms: ["!allowed:example.com"] }, async () => {
			executed = true;
		});

		await bot.dispatchListeners(
			{
				id: "test-1",
				kind: "matrix.message",
				source: "matrix",
				request: createMockContext({ room: { id: "!disallowed:example.com" } }),
				timestamp: new Date(),
			},
			{
				matrix: createMockContext({ room: { id: "!disallowed:example.com" } }),
			},
		);

		expect(executed).toBe(false);

		await bot.dispatchListeners(
			{
				id: "test-2",
				kind: "matrix.message",
				source: "matrix",
				request: createMockContext({ room: { id: "!allowed:example.com" } }),
				timestamp: new Date(),
			},
			{ matrix: createMockContext({ room: { id: "!allowed:example.com" } }) },
		);

		expect(executed).toBe(true);
	});

	test("Multiple listeners for the same event execute independently", async () => {
		const order: number[] = [];
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.on.message(async () => {
			order.push(1);
		});

		bot.on.message(async () => {
			order.push(2);
		});

		await bot.dispatchListeners(
			{
				id: "test-img",
				kind: "matrix.message",
				source: "matrix",
				request: createMockContext(),
				timestamp: new Date(),
			},
			{ matrix: createMockContext() },
		);

		// Currently, in index.ts listeners are just pushed to a list and evaluated
		// The exact execution order relies on how inner_on processes them
		// But both should definitely execute.
		expect(order.length).toBe(2);
		expect(order).toContain(1);
		expect(order).toContain(2);
	});

	test("Context gracefully handles nested polling structures without breaking", async () => {
		let executed = false;
		const bot = new MatrixBot({
			homeserverUrl: "http://localhost",
			username: "user",
			password: "password",
			recoveryKey: "key",
			admin: ["@admin:example.com"],
		});

		bot.on.pollVote({ actionId: "my-poll" }, async (event, actions) => {
			expect(actions.matrix?.message.pollResponse?.selections).toEqual([
				"answer-1",
			]);
			executed = true;
		});

		const mockCtx = createMockContext({
			message: {
				id: "2",
				type: "poll_response",
				rawBody: "vote",
				body: "vote",
				pollResponse: {
					pollEventId: "123",
					actionId: "my-poll",
					selections: ["answer-1"],
				},
			},
		});

		// Trigger inner poll response logic through matrix event abstraction
		await bot.dispatchListeners(
			{
				id: "poll-event",
				kind: "matrix.message",
				source: "matrix",
				request: mockCtx,
				timestamp: new Date(),
			},
			{ matrix: mockCtx },
		);

		expect(executed).toBe(true);
	});
});
