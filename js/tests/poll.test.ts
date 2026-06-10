import { describe, expect, test } from "bun:test";
import { MatrixBot } from "../src/index";
import { createMockContext } from "./mock_context";

describe("MatrixBot Polls", () => {
	test("handles incoming polls and poll responses", async () => {
		const bot = new MatrixBot({ homeserverUrl: "https://example.com", username: "@bot:example.com", password: "password", recoveryKey: "123", admin: ["@user:example.com"] });

		let pollQuestion = "";
		let pollResponseSelections: string[] = [];

		bot.on.poll(async (_event, actions) => {
			pollQuestion = actions.matrix?.message.poll?.question ?? "";
		});

		bot.on.pollVote(async (_event, actions) => {
			pollResponseSelections = actions.matrix?.message.pollResponse?.selections ?? [];
		});

		await bot.dispatchListeners(
			{
				kind: "matrix.message",
				id: "1",
				source: "matrix",
				timestamp: new Date(),
				request: createMockContext({
					message: {
						type: "poll",
						poll: { question: "What is your favorite color?", answers: [], kind: "disclosed", maxSelections: 1 },
					},
				}),
			},
			{
				matrix: createMockContext({
					message: {
						type: "poll",
						poll: { question: "What is your favorite color?", answers: [], kind: "disclosed", maxSelections: 1 },
					},
				}),
			}
		);

		// Simulate poll response
		await bot.dispatchListeners(
			{
				kind: "matrix.message",
				id: "2",
				source: "matrix",
				timestamp: new Date(),
				request: createMockContext({
					message: {
						type: "poll_response",
						pollResponse: { pollEventId: "123", selections: ["red"] },
					},
				}),
			},
			{
				matrix: createMockContext({
					message: {
						type: "poll_response",
						pollResponse: { pollEventId: "123", selections: ["red"] },
					},
				}),
			}
		);

		expect(pollQuestion).toBe("What is your favorite color?");
		expect(pollResponseSelections).toEqual(["red"]);
	});
});
