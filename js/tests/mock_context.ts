import type { Context } from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: dynamic types
export function createMockContext(overrides: any = {}): Context {
	const { message, ...otherOverrides } = overrides;
	const body = overrides.body ?? "hello";
	const msgOverrides = message ?? {};
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
			mention: "[@user:example.com](https://matrix.to/#/@user:example.com)",
			isAdmin: () => false,
			isModerator: () => false,
			...(overrides.sender ?? {}),
		},
		send: {
			message: async () => undefined as any,
			text: async () => undefined as any,
			markdown: async () => undefined as any,
			media: async () => undefined as any,
			image: async () => undefined as any,
			file: async () => undefined as any,
			video: async () => undefined as any,
			poll: async () => undefined as any,
			catch: async () => undefined as any,
			finally: async () => undefined as any,
			then: async () => undefined as any,
		} as any,
		reply: {
			message: async () => undefined as any,
			text: async () => undefined as any,
			markdown: async () => undefined as any,
			catch: async () => undefined as any,
			finally: async () => undefined as any,
			then: async () => undefined as any,
		} as any,
		session: overrides.session ?? {},
		downloadMedia: async () => Buffer.from([]),
		closePoll: async () => undefined as any,
		prompt: async () => overrides.promptCtx ?? createMockContext(),
		...otherOverrides,
	} as Context;
}
