import { MatrixBot } from "./js/src/index.js";

const bot = new MatrixBot({
	homeserverUrl: "https://example.org",
	username: "bot",
	password: "123",
	recoveryKey: "abc",
	admin: ["@admin:example.org"],
	config: { utility: true },
});

const ctx = {
	message: { id: "1", type: "text", rawBody: "!ping", body: "!ping" },
	room: { id: "1", isDirect: false },
	sender: {
		id: "@user:example.org",
		isAdmin: () => false,
		isModerator: () => false,
	},
	send: {},
	reply: {
		text: async (t) => console.log("reply.text:", t),
		markdown: async (t) => console.log("reply.markdown:", t),
	},
};

bot
	// biome-ignore lint/suspicious/noExplicitAny: testing mocks
	.dispatch(ctx as any)
	.then((res) => console.log("handled:", res))
	.catch(console.error);

const helpCtx = {
	...ctx,
	message: { ...ctx.message, rawBody: "!help", body: "!help" },
};
bot
	// biome-ignore lint/suspicious/noExplicitAny: testing mocks
	.dispatch(helpCtx as any)
	.then((res) => console.log("help handled:", res))
	.catch(console.error);

const uptimeCtx = {
	...ctx,
	message: { ...ctx.message, rawBody: "!uptime", body: "!uptime" },
	room: { id: "1", isDirect: true },
	sender: { ...ctx.sender, isAdmin: () => true },
};
bot
	// biome-ignore lint/suspicious/noExplicitAny: testing mocks
	.dispatch(uptimeCtx as any)
	.then((res) => console.log("uptime handled:", res))
	.catch(console.error);
