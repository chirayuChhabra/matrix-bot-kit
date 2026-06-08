import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import log from "loglevel";
import {
	loadNativeBinding,
	type MatrixMessageType,
	type NativeIncomingMessage,
	type NativeListenerMatrixMessageTrigger,
	type NativeMediaAttachment,
} from "./native";

/**
 * Configuration options for creating a MatrixBot instance.
 */
export type MatrixBotOptions = {
	/** The URL of the Matrix homeserver to connect to. */
	homeserverUrl: string;
	/** The bot's username on the homeserver. */
	username: string;
	/** The bot's password on the homeserver. */
	password: string;
	/** The recovery key for encryption. */
	recoveryKey: string;
	/** The local directory to store persistent data (e.g., sqlite DBs for session info). */
	dataDir?: string;
	/** Additional runtime configuration for the bot. */
	config?: MatrixBotRuntimeConfig;
	/** A custom logger function. Overrides the default logger if provided. */
	logger?: MatrixLogger;
	/** A custom error handler. */
	onError?: MatrixErrorHandler;
	/** A list of user IDs who have admin privileges. */
	admin: string[];
	/** A list of user IDs who have moderator privileges. */
	moderator?: string[];
	/** The number of messages to fetch from the timeline on startup. */
	timelineLimit?: number;
	/** The version string of your bot (e.g., from package.json). Shown in the !version command. */
	version?: string;
};

export type MatrixBotRuntimeConfig = {
	announceCommandGroupUsage?: boolean;
	selfDocumentation?: boolean;
	documentationPath?: string;
	utility?: boolean;
};

type ResolvedMatrixBotRuntimeConfig = {
	announceCommandGroupUsage: boolean;
	selfDocumentation: boolean;
	documentationPath: string;
	utility: boolean;
};

/**
 * Context for sending a new message to the room.
 * Supports chaining methods to send different types of media or formatting.
 * The promise resolves with the event ID of the last sent message (e.g. useful for tracking polls).
 */
export interface SendContext extends Promise<string | undefined> {
	/** Sends a plain text message to the room. */
	message: (body: string) => SendContext;
	/** Sends a plain text message to the room. Alias for `message`. */
	text: (body: string) => SendContext;
	/** Sends a markdown-formatted message to the room. */
	markdown: (body: string) => SendContext;
	/** Sends a media file (image, file, or video) to the room. */
	media: (kind: MediaKind, attachment: MediaAttachment) => SendContext;
	/** Sends an image attachment to the room. */
	image: (attachment: MediaAttachment) => SendContext;
	/** Sends a file attachment to the room. */
	file: (attachment: MediaAttachment) => SendContext;
	/** Sends a video attachment to the room. */
	video: (attachment: MediaAttachment) => SendContext;
	/** Sends a poll to the room. */
	poll: (poll: OutboundPoll) => SendContext;
}

/**
 * Context for replying to the current message in the room.
 * Supports chaining methods to send formatted replies.
 */
export interface ReplyContext extends Promise<void> {
	/** Replies to the current message with plain text. */
	message: (body: string) => ReplyContext;
	/** Replies to the current message with plain text. Alias for `message`. */
	text: (body: string) => ReplyContext;
	/** Replies to the current message with a markdown-formatted string. */
	markdown: (body: string) => ReplyContext;
}

/**
 * Context provided to command and listener handlers, containing the message event,
 * sender information, room details, and utility functions to reply or react.
 */
export type Context = {
	/** Information about the incoming message that triggered this handler. */
	message: {
		/** The Matrix event ID of the message. */
		id: string;
		/** The type of message (e.g., text, image, poll). */
		type: MatrixMessageType;
		/** The raw, unparsed body of the message. */
		rawBody: string;
		/** The body of the message, with any command prefix stripped if applicable. */
		body: string;
		/** Media attachment information, if the message contains media. */
		media?: MediaMessage;
		/** Poll information, if the message is a poll. */
		poll?: PollMessage;
		/** Poll response (vote) information, if the message is a poll vote. */
		pollResponse?: PollResponseMessage;
		/** Poll end information, if the message is a poll close event. */
		pollEnd?: PollEndMessage;
		/** Information about the message this message is replying to, if any. */
		reply?: {
			target?: RepliedMessage;
			isUnsupported: boolean;
		};
		/** Reacts to the current message with the given emoji. */
		react: (emoji: string) => Promise<void>;
		/** Redacts (deletes) the current message. */
		redact: (reason?: string) => Promise<void>;
	};
	/** Information about the room where the message was sent. */
	room: {
		/** The Matrix room ID. */
		id: string;
		/** True if the room is a direct (1:1) chat. */
		isDirect: boolean;
	};
	/** Information about the sender of the message. */
	sender: {
		/** The Matrix user ID of the sender. */
		id: string;
		/** A markdown-formatted mention for the sender. */
		mention: string;
		/** Returns true if the sender (or the specified user ID) is an admin. */
		isAdmin: (userId?: string) => boolean;
		/** Returns true if the sender (or the specified user ID) is a moderator. */
		isModerator: (userId?: string) => boolean;
	};
	/** Sends a new message to the room. Chainable methods allow sending different content types. */
	send: SendContext;
	/** Replies to the current message. Chainable methods allow formatted replies. */
	reply: ReplyContext;
	/** A persistent key-value store for session data specific to this user in this room. */
	// biome-ignore lint/suspicious/noExplicitAny: sessions can contain any dynamic data
	session: Record<string, any>;
	/** Sends a prompt to the user and waits for their next reply in the room. */
	prompt: (body: string, options?: { timeoutMs?: number }) => Promise<Context>;

	/** Closes an active poll in this room. */
	closePoll: (pollEventId: string, fallbackText?: string) => Promise<void>;

	/** Downloads media from the given target or the current message if none provided. */
	downloadMedia: (target?: MediaDownloadTarget) => Promise<Buffer>;
};

export type EventFilterOptions = {
	rooms?: string | string[];
	actionId?: string;
};

export type WebhookOptions = {
	source: string;
	event?: string;
};

export type ScheduleOptions = {
	everyMs: number;
};

export type MediaMessage = {
	kind: MediaKind;
	filename: string;
	caption?: string;
	mxcUri?: string;
	mimetype?: string;
	size?: number;
	width?: number;
	height?: number;
	durationMs?: number;
	encrypted: boolean;
};

export type MediaDownloadTarget =
	| string
	| {
			roomId?: string;
			eventId?: string;
	  };

export type MediaKind = "image" | "file" | "video";

export type MediaAttachment =
	| string
	| MediaPathAttachment
	| MediaDataAttachment;

export type MediaPathAttachment = {
	path: string;
	filename?: string;
	contentType?: string;
};

export type MediaDataAttachment = {
	filename: string;
	contentType: string;
	data: Buffer | Uint8Array;
};

export type PollMessage = {
	question: string;
	kind: string;
	maxSelections: number;
	answers: PollAnswer[];
};

export type OutboundPoll = {
	question: string;
	answers: PollAnswer[];
	/** Poll disclosure kind. Use "undisclosed" to hide votes until the poll ends. Defaults to "disclosed". */
	kind?: "disclosed" | "undisclosed";
	/** Maximum number of answers a user can select. Defaults to 1. */
	maxSelections?: number;
	/** An action ID (tag) to uniquely identify this poll for `bot.on.pollVote({ actionId })`. */
	actionId?: string;
};

export type PollAnswer = {
	id: string;
	text: string;
};

export type PollResponseMessage = {
	/** The event ID of the poll this vote is for. */
	pollEventId: string;
	/** The answer IDs the user selected. */
	selections: string[];
	/** The action ID if the original poll was tagged. */
	actionId?: string;
};

export type PollEndMessage = {
	/** The event ID of the poll that was ended. */
	pollEventId: string;
	/** The fallback text provided when ending the poll. */
	text: string;
};

export type RepliedMessage = {
	eventId: string;
	sender: string;
	messageType: MatrixMessageType;
	body: string;
	media?: MediaMessage;
};

export type MatrixLogLevel = "debug" | "info" | "warn" | "error";

export type MatrixLogEvent = {
	level: MatrixLogLevel;
	message: string;
	component: "sdk" | "runtime" | "dispatch";
	eventId?: string;
	roomId?: string;
	sender?: string;
	commandGroup?: string;
	documentationPath?: string;
	handled?: number;
	durationMs?: number;
	error?: string;
};

export type MatrixLogger = (event: MatrixLogEvent) => void;

export type MatrixErrorContext = {
	error: unknown;
	phase: "dispatch" | "runtime";
	request?: Context;
};

export type MatrixErrorHandler = (
	context: MatrixErrorContext,
) => Promise<void> | void;

export type Next = () => Promise<void>;
export type Middleware = (ctx: Context, next: Next) => Promise<void> | void;
export type Handler = (ctx: Context) => Promise<void> | void;

export type ListenerEventKind = "matrix.message" | "schedule" | "external";

export type ListenerEvent = {
	id: string;
	kind: ListenerEventKind;
	source: string;
	timestamp: Date;
	name?: string;
	request?: Context;
	payload?: unknown;
};

export type ListenerActions = {
	matrix?: Context;
};

export type ListenerMiddleware = (
	event: ListenerEvent,
	actions: ListenerActions,
	next: Next,
) => Promise<void> | void;

export type ListenerHandler = (
	event: ListenerEvent,
	actions: ListenerActions,
) => Promise<void> | void;

export type ListenerMatrixMessageTrigger = {
	kind: "matrix.message";
	messageTypes?: MatrixMessageType[];
	rooms?: string[];
	senders?: string[];
};

export type ListenerExternalTrigger = {
	kind: "external";
	source?: string | string[];
	event?: string | string[];
};

export type ListenerScheduleTrigger = {
	kind: "schedule";
	everyMs?: number;
	at?: Date | string;
	source?: string;
};

export type ListenerTrigger =
	| "matrix.message"
	| ListenerMatrixMessageTrigger
	| ListenerExternalTrigger
	| ListenerScheduleTrigger;

export type ListenerConfig = Record<string, unknown>;

export type ListenerOptions<TConfig extends ListenerConfig = ListenerConfig> = {
	name: string;
	description?: string;
	triggers?: ListenerTrigger[];
	config?: TConfig;
};

export type CommandGroupConfig = Record<string, unknown>;

export type CommandGroupOptions<
	TConfig extends CommandGroupConfig = CommandGroupConfig,
> = {
	name: string;
	command: string | string[];
	commands?: string | string[];
	description?: string;
	category?: string;
	adminOnly?: boolean;
	moderatorOnly?: boolean;
	roomType?: "direct" | "any";
	config?: TConfig;
};

export type CommandConfig = Record<string, unknown>;

export type CommandOptions<TConfig extends CommandConfig = CommandConfig> = {
	name: string;
	command: string | string[];
	commands?: string | string[];
	description?: string;
	adminOnly?: boolean;
	moderatorOnly?: boolean;
	roomType?: "direct" | "any";
	config?: TConfig;
};

/**
 * The main entrypoint for the Matrix Bot SDK.
 * Use this class to configure the bot, register commands and listeners, and start the runtime.
 */
export class MatrixBot {
	readonly options: MatrixBotOptions;
	readonly commandGroups: CommandGroup[] = [];
	readonly listeners: Listener[] = [];
	private readonly native;
	private readonly logger: MatrixLogger;
	private readonly errorHandler: MatrixErrorHandler;
	private readonly config: ResolvedMatrixBotRuntimeConfig;
	private scheduleTimers: Array<
		ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>
	> = [];
	private stopResolve?: () => void;
	private onListenerCount = 0;
	private scheduleListenerCount = 0;
	private isUnderMaintenance = false;
	private pendingPrompts = new Map<
		string,
		{
			resolve: (ctx: Context) => void;
			reject: (err: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	// biome-ignore lint/suspicious/noExplicitAny: sessions can contain any dynamic data
	private sessions = new Map<
		string,
		{ data: Record<string, any>; lastAccessed: number }
	>();

	constructor(options: MatrixBotOptions) {
		assertPresent("homeserverUrl", options.homeserverUrl);
		assertPresent("username", options.username);
		assertPresent("password", options.password);
		assertPresent("recoveryKey", options.recoveryKey);
		assertPresent("admin", options.admin);
		this.options = { ...options };
		this.logger = options.logger ?? defaultLogger;
		this.errorHandler = options.onError ?? this.defaultErrorHandler.bind(this);
		this.config = resolveMatrixBotConfig(options.config);
		this.native = nativeBinding
			? new nativeBinding.MatrixBot(toNativeOptions(this.options))
			: undefined;

		if (this.config.utility) {
			this.setupUtilityCommands();
		}
	}

	private setupUtilityCommands() {
		const pingGroup = new CommandGroup({
			name: "!ping",
			command: "!ping",
			description: "Replies with pong.",
			category: "System",
		});
		pingGroup.use(async (ctx) => {
			await ctx.reply.text("pong");
		});
		this.useCommandGroup(pingGroup);

		const registerUtility = (
			name: string,
			description: string,
			handler: Handler,
		) => {
			const group = new CommandGroup({
				name,
				command: name,
				description,
				category: "System",
				adminOnly: true,
				roomType: "direct",
			});
			group.use(handler);
			this.useCommandGroup(group);
		};

		registerUtility("!version", "Shows the bot version.", async (ctx) => {
			try {
				const sdkPkg = require("../../package.json");
				const botVersion = this.options.version
					? `Bot Version: ${this.options.version}\n`
					: "";
				await ctx.reply.text(`${botVersion}SDK Version: ${sdkPkg.version}`);
			} catch (_e) {
				await ctx.reply.text("Version: unknown");
			}
		});

		registerUtility("!uptime", "Shows the bot uptime.", async (ctx) => {
			const uptime = process.uptime();
			const hours = Math.floor(uptime / 3600);
			const minutes = Math.floor((uptime % 3600) / 60);
			const seconds = Math.floor(uptime % 60);
			await ctx.reply.text(`Total uptime: ${hours}h ${minutes}m ${seconds}s`);
		});

		registerUtility(
			"!status",
			"Shows the bot status and memory usage.",
			async (ctx) => {
				const memUsage = process.memoryUsage();
				const memMB = Math.round(memUsage.rss / 1024 / 1024);
				await ctx.reply.text(
					`Status:\n- Uptime: ${Math.floor(process.uptime())}s\n- Memory RSS: ${memMB}MB\n- Command Groups: ${this.commandGroups.length}\n- Listeners: ${this.listeners.length}\n- Maintenance: ${this.isUnderMaintenance}`,
				);
			},
		);

		registerUtility(
			"!maintenance",
			"Toggles maintenance mode.",
			async (ctx) => {
				const expectedPassword =
					typeof Bun !== "undefined"
						? Bun.env.MAINTENANCE_PASSWORD
						: process.env.MAINTENANCE_PASSWORD;
				if (!expectedPassword) {
					await ctx.reply.text("Maintenance password not configured.");
					return;
				}

				const promptCtx = await ctx.prompt(
					"Please enter the maintenance password:",
				);
				const password = promptCtx.message.body.trim();

				const passwordBuf = Buffer.from(password);
				const expectedPasswordBuf = Buffer.from(expectedPassword);
				const isPasswordValid =
					passwordBuf.length === expectedPasswordBuf.length &&
					crypto.timingSafeEqual(passwordBuf, expectedPasswordBuf);

				if (!isPasswordValid) {
					await ctx.reply.text("Invalid password.");
					await promptCtx.message.redact("Hide password");
					return;
				}

				this.isUnderMaintenance = !this.isUnderMaintenance;
				await ctx.reply.text(
					`Maintenance mode is now ${this.isUnderMaintenance ? "ON" : "OFF"}.`,
				);
				await promptCtx.message.redact("Hide password");
			},
		);

		registerUtility(
			"!shutdown",
			"Shuts down the bot gracefully.",
			async (ctx) => {
				const expectedPassword =
					typeof Bun !== "undefined"
						? Bun.env.MAINTENANCE_PASSWORD
						: process.env.MAINTENANCE_PASSWORD;
				if (!expectedPassword) {
					await ctx.reply.text("Maintenance password not configured.");
					return;
				}

				const promptCtx = await ctx.prompt(
					"Please enter the maintenance password:",
				);
				const password = promptCtx.message.body.trim();

				const passwordBuf = Buffer.from(password);
				const expectedPasswordBuf = Buffer.from(expectedPassword);
				const isPasswordValid =
					passwordBuf.length === expectedPasswordBuf.length &&
					crypto.timingSafeEqual(passwordBuf, expectedPasswordBuf);

				if (!isPasswordValid) {
					await ctx.reply.text("Invalid password.");
					await promptCtx.message.redact("Hide password");
					return;
				}

				await ctx.reply.text("Shutting down gracefully...");
				await promptCtx.message.redact("Hide password");
				await this.stop();
				process.exit(0);
			},
		);

		const helpGroup = new CommandGroup({
			name: "!help",
			command: "!help",
			description: "Shows this help message.",
			category: "System",
		});
		helpGroup.use(async (ctx) => {
			let doc = "# 🤖 Bot Commands\n\n";
			doc += "Here is a list of all available commands:\n\n";

			const categories = new Map<string, CommandGroup[]>();
			for (const group of this.commandGroups) {
				const category = group.category || "General";
				if (!categories.has(category)) {
					categories.set(category, []);
				}
				categories.get(category)?.push(group);
			}

			const sortedCategories = Array.from(categories.keys()).sort((a, b) => {
				if (a === "General") return -1;
				if (b === "General") return 1;
				return a.localeCompare(b);
			});

			for (const category of sortedCategories) {
				// biome-ignore lint/style/noNonNullAssertion: guaranteed by Map traversal
				const groups = categories.get(category)!;
				doc += `## ${category}\n\n`;
				doc += "| Command | Description | Badges |\n";
				doc += "| :--- | :--- | :--- |\n";
				for (const group of groups) {
					const groupCmds = group.commands
						.map((c) => `**\`${c}\`**`)
						.join(", ");

					const badges: string[] = [];
					if (group.adminOnly) badges.push("🛡️");
					if (group.moderatorOnly) badges.push("👮");
					if (group.roomType === "direct") badges.push("💬");

					const groupDesc =
						group.description ||
						(group.childCommands.length > 0
							? "Command group"
							: "No description provided.");
					doc += `| ${groupCmds} | ${groupDesc} | ${badges.join(" ")} |\n`;

					for (const child of group.childCommands) {
						const baseCmd = group.commands[0] || "";
						const childCmds = child.commands
							.map((c) => `**\`${(`${baseCmd} ${c}`).trim()}\`**`)
							.join(", ");

						const childBadges: string[] = [];
						if (child.adminOnly) childBadges.push("🛡️");
						if (child.moderatorOnly) childBadges.push("👮");
						if (child.roomType === "direct") childBadges.push("💬");

						const childDesc = child.description || "No description provided.";
						doc += `| &nbsp;&nbsp;&nbsp;&nbsp;↳ ${childCmds} | ${childDesc} | ${childBadges.join(" ")} |\n`;
					}
				}
				doc += "\n";
			}

			doc += "---\n";
			doc += "🛡️ Admin Only | 👮 Moderator Only | 💬 DM Only\n";

			await ctx.reply.markdown(doc);
		});
		this.useCommandGroup(helpGroup);
	}

	/**
	 * Registers a sub-bot (CommandGroup) or a Listener with the main bot.
	 * @param component The CommandGroup or Listener to register.
	 * @returns This MatrixBot instance for chaining.
	 */
	use(component: CommandGroup | Listener): this {
		if (component instanceof Listener) {
			return this.useListener(component);
		}

		return this.useCommandGroup(component);
	}

	useCommandGroup(commandGroup: CommandGroup): this {
		if (
			this.commandGroups.some((existing) => existing.name === commandGroup.name)
		) {
			throw new Error(
				`a sub-bot named \`${commandGroup.name}\` is already registered`,
			);
		}

		const duplicateCommand = firstSharedValue(
			this.commandGroups.flatMap((existing) => existing.commands),
			commandGroup.commands,
		);
		if (duplicateCommand) {
			throw new Error(
				`command \`${duplicateCommand}\` is already registered by another sub-bot`,
			);
		}

		this.commandGroups.push(commandGroup);
		if (this.native && commandGroup.native) {
			this.native.registerCommandGroup(commandGroup.native);
		}
		return this;
	}

	useListener(listener: Listener): this {
		if (this.listeners.some((existing) => existing.name === listener.name)) {
			throw new Error(
				`a listener named \`${listener.name}\` is already registered`,
			);
		}

		this.listeners.push(listener);
		if (this.native?.registerListener && listener.native) {
			this.native.registerListener(listener.native);
		}
		return this;
	}

	get nativeAvailable(): boolean {
		return this.native !== undefined;
	}

	get commandGroupCount(): number {
		return this.native?.commandGroupCount ?? this.commandGroups.length;
	}

	get listenerCount(): number {
		return this.native?.listenerCount ?? this.listeners.length;
	}

	/**
	 * Registers a command handler.
	 * @param match The command string or array of command strings to trigger this handler.
	 * @param pipeline The middleware and handler to execute when the command is triggered.
	 * @returns This MatrixBot instance for chaining.
	 */
	command(
		match: string | string[],
		...pipeline: [...Middleware[], Handler]
	): this {
		const group = new CommandGroup({
			name: Array.isArray(match) ? match[0] : match,
			command: match,
		});
		group.use(...pipeline);
		this.useCommandGroup(group);
		return this;
	}

	group(match: string | string[]): CommandGroup {
		const group = new CommandGroup({
			name: Array.isArray(match) ? match[0] : match,
			command: match,
		});
		this.useCommandGroup(group);
		return group;
	}

	/**
	 * The event listener namespace. Contains specialized methods for responding to Matrix events, schedules, and webhooks.
	 * All methods support chaining infinite middleware before the final handler.
	 *
	 * @example
	 * ```ts
	 * // Global message listener
	 * bot.on.message(async (ctx) => { ... })
	 *
	 * // Scoped listener using options
	 * bot.on.message({ rooms: ["!myRoom:matrix.org"] }, async (ctx) => { ... })
	 *
	 * // Tagged poll vote listener
	 * bot.on.pollVote({ actionId: "my_poll_tag" }, async (ctx) => { ... })
	 * ```
	 */
	public get on() {
		const registerEvent = (
			eventType: string,
			optionsOrMiddleware:
				| EventFilterOptions
				| ListenerMiddleware
				| ListenerHandler,
			// biome-ignore lint/suspicious/noExplicitAny: dynamic types
			...args: any[]
		) => {
			let options: EventFilterOptions = {};
			// biome-ignore lint/suspicious/noExplicitAny: dynamic types
			let pipeline: any[] = [];

			if (typeof optionsOrMiddleware === "function") {
				pipeline = [optionsOrMiddleware, ...args];
			} else {
				options = optionsOrMiddleware as EventFilterOptions;
				pipeline = args;
			}

			// biome-ignore lint/suspicious/noExplicitAny: dynamic types
			const finalPipeline: any[] = [];

			if (options.rooms) {
				const roomsArr = Array.isArray(options.rooms)
					? options.rooms
					: [options.rooms];
				finalPipeline.push(
					async (
						_event: ListenerEvent,
						actions: ListenerActions,
						next: Next,
					) => {
						if (!actions.matrix) return;
						if (!roomsArr.includes(actions.matrix.room.id)) return;
						await next();
					},
				);
			}

			if (options.actionId) {
				finalPipeline.push(
					async (
						_event: ListenerEvent,
						actions: ListenerActions,
						next: Next,
					) => {
						const ctx = actions.matrix;
						if (eventType === "poll_response" && ctx?.message.pollResponse) {
							if (ctx.message.pollResponse.actionId !== options.actionId)
								return;
						}
						await next();
					},
				);
			}

			finalPipeline.push(...pipeline);

			// biome-ignore lint/suspicious/noExplicitAny: testing mocks
			this.inner_on(eventType, ...(finalPipeline as any));
		};

		return {
			message: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("message", opts, ...args),
			image: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("image", opts, ...args),
			file: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("file", opts, ...args),
			video: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("video", opts, ...args),
			audio: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("audio", opts, ...args),
			notice: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("notice", opts, ...args),
			server_notice: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("server_notice", opts, ...args),
			poll: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("poll", opts, ...args),
			pollVote: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("poll_response", opts, ...args),
			pollEnd: (
				opts: EventFilterOptions | ListenerMiddleware | ListenerHandler,
				// biome-ignore lint/suspicious/noExplicitAny: dynamic types
				...args: any[]
			) => registerEvent("poll_end", opts, ...args),
			// biome-ignore lint/suspicious/noExplicitAny: dynamic types
			webhook: (opts: WebhookOptions, ...args: any[]) => {
				// biome-ignore lint/suspicious/noExplicitAny: testing mocks
				this.webhook(opts.source, opts.event, ...(args as any));
			},
			// biome-ignore lint/suspicious/noExplicitAny: dynamic types
			schedule: (opts: ScheduleOptions, ...args: any[]) => {
				// biome-ignore lint/suspicious/noExplicitAny: testing mocks
				this.schedule(opts, ...(args as any));
			},
		};
	}

	// biome-ignore lint/suspicious/noExplicitAny: dynamic types
	private inner_on(event: string, ...args: any[]): this {
		const isRooms =
			typeof args[0] === "string" ||
			(Array.isArray(args[0]) && typeof args[0][0] === "string");
		const rooms = isRooms ? (args[0] as string | string[]) : undefined;
		const pipeline = isRooms ? args.slice(1) : args;

		const roomsArray = rooms
			? Array.isArray(rooms)
				? rooms
				: [rooms]
			: undefined;

		const name = `on-${event}-${++this.onListenerCount}`;
		const triggers: ListenerTrigger[] =
			event === "message"
				? [{ kind: "matrix.message", rooms: roomsArray }]
				: [
						{
							kind: "matrix.message",
							messageTypes: [event as MatrixMessageType],
							rooms: roomsArray,
						},
					];
		const listener = new Listener({ name, triggers });
		listener.use(...(pipeline as [...ListenerMiddleware[], ListenerHandler]));
		this.useListener(listener);
		return this;
	}

	schedule(
		options: { everyMs?: number; at?: string | Date },
		...pipeline: [...ListenerMiddleware[], ListenerHandler]
	): this {
		const name = `schedule-${++this.scheduleListenerCount}`;
		const listener = new Listener({
			name,
			triggers: [{ kind: "schedule", ...options, source: "schedule" }],
		});
		listener.use(...pipeline);
		this.useListener(listener);
		return this;
	}

	webhook(
		source: string,
		event: string | undefined,
		...pipeline: [...ListenerMiddleware[], ListenerHandler]
	): this {
		const listener = new Listener({
			name: `webhook-${source}-${event}`,
			triggers: [{ kind: "external", source, event }],
		});
		listener.use(...pipeline);
		this.useListener(listener);
		return this;
	}

	/**
	 * Closes an active poll in a room.
	 * @param roomId The room ID where the poll was created.
	 * @param pollEventId The event ID of the poll start event.
	 * @param fallbackText Optional custom fallback text for clients that don't support poll end events.
	 */
	async closePoll(
		roomId: string,
		pollEventId: string,
		fallbackText?: string,
	): Promise<void> {
		if (!this.native) {
			throw new Error("native Matrix runtime binding is missing");
		}

		return this.native.closePoll(roomId, pollEventId, fallbackText);
	}

	async dispatch(ctx: Context): Promise<number> {
		const started = Date.now();

		const bodyLower = ctx.message.body.toLowerCase().trim();
		if (this.isUnderMaintenance) {
			if (
				!bodyLower.startsWith("!maintenance") &&
				!bodyLower.startsWith("!shutdown") &&
				!bodyLower.startsWith("!reload")
			) {
				// Find if it would match a command
				let wouldHandle = false;
				for (const commandGroup of this.commandGroups) {
					if (commandGroup.willHandle(ctx)) {
						wouldHandle = true;
						break;
					}
				}
				if (wouldHandle) {
					await ctx.reply.text("Bot is under maintenance");
					return 1;
				}
				return 0;
			}
		}

		let handled = 0;
		for (const commandGroup of this.commandGroups) {
			try {
				if (commandGroup.willHandle(ctx)) {
					await this.sendCommandGroupUsageNotice(commandGroup, ctx);
				}
				handled += await commandGroup.dispatch(ctx);
			} catch (error) {
				await this.handleError({ error, phase: "dispatch", request: ctx });
			}
		}

		if (handled === 0 && ctx.message.type === "text") {
			this.log("debug", "No command handlers matched", {
				component: "sdk",
				eventId: ctx.message.id,
				roomId: ctx.room.id,
				sender: ctx.sender.id,
			});
		}

		this.log(handled > 0 ? "info" : "debug", "Matrix message dispatched", {
			eventId: ctx.message.id,
			roomId: ctx.room.id,
			sender: ctx.sender.id,
			handled,
			durationMs: Date.now() - started,
			component: "dispatch",
		});
		return handled;
	}

	async dispatchListeners(
		event: ListenerEvent,
		actions: ListenerActions = {},
	): Promise<number> {
		const started = Date.now();
		let handled = 0;
		for (const listener of this.listeners) {
			try {
				handled += await listener.dispatch(event, actions);
			} catch (error) {
				await this.handleError({
					error,
					phase: "dispatch",
					request: event.request,
				});
			}
		}

		this.log(handled > 0 ? "info" : "debug", "Listener event dispatched", {
			eventId: event.request?.message.id ?? event.id,
			roomId: event.request?.room.id,
			sender: event.request?.sender.id,
			handled,
			durationMs: Date.now() - started,
			component: "dispatch",
		});
		return handled;
	}

	async emitExternal(
		source: string,
		name: string,
		payload?: unknown,
	): Promise<number> {
		return this.dispatchListeners({
			id: `${source}:${name}:${Date.now()}`,
			kind: "external",
			source,
			name,
			payload,
			timestamp: new Date(),
		});
	}

	private async sendCommandGroupUsageNotice(
		commandGroup: CommandGroup,
		ctx: Context,
	): Promise<void> {
		if (!this.config.announceCommandGroupUsage) {
			return;
		}

		try {
			await ctx.reply.markdown(`> using ${commandGroup.name}...`);
		} catch (error) {
			this.log("warn", "Failed to send command group usage notice", {
				component: "sdk",
				eventId: ctx.message.id,
				roomId: ctx.room.id,
				sender: ctx.sender.id,
				error: errorToString(error),
			});
		}
	}

	/**
	 * Starts the bot runtime, connecting it to the Matrix homeserver and listening for events.
	 * @param callback An optional callback function executed when the bot successfully starts.
	 * @returns A promise that resolves when the bot stops.
	 */
	async start(callback?: () => void): Promise<void> {
		if (!this.native) {
			const error = new Error(
				"native Matrix runtime binding is missing; run `devbox run build-native` first",
			);
			await this.handleError({ error, phase: "runtime" });
			throw error;
		}

		this.log("info", "Starting Matrix bot runtime", {
			component: "runtime",
		});

		await this.writeConfiguredSelfDocumentation();

		const readyPromise = new Promise<void>((resolveReady) => {
			// biome-ignore lint/style/noNonNullAssertion: guaranteed below
			this.native!.start(
				(message) => {
					this.contextFromNative(message)
						.then((ctx) => {
							const promptKey = `${message.roomId}:${message.sender}`;
							const pendingPrompt = this.pendingPrompts.get(promptKey);
							if (pendingPrompt) {
								clearTimeout(pendingPrompt.timer);
								this.pendingPrompts.delete(promptKey);
								pendingPrompt.resolve(ctx);
								return;
							}

							this.dispatch(ctx).catch((error) => {
								void this.handleError({
									error,
									phase: "dispatch",
									request: ctx,
								});
							});
							this.dispatchListeners(matrixMessageListenerEvent(ctx), {
								matrix: ctx,
							}).catch((error) => {
								void this.handleError({
									error,
									phase: "dispatch",
									request: ctx,
								});
							});
						})
						.catch((error) => {
							void this.handleError({ error, phase: "runtime" });
						});
				},
				(event) => {
					this.log(event.level, event.message, {
						component: "runtime",
					});
				},
				() => resolveReady(),
			);
		});

		await readyPromise;

		this.log("info", "Matrix bot runtime started", {
			component: "runtime",
		});

		this.startListenerSchedules();

		const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
		const sessionCleanupTimer = setInterval(
			() => {
				const now = Date.now();
				for (const [key, session] of this.sessions.entries()) {
					if (now - session.lastAccessed > SESSION_TTL_MS) {
						this.sessions.delete(key);
					}
				}
			},
			60 * 60 * 1000,
		);
		this.scheduleTimers.push(sessionCleanupTimer);

		if (callback) {
			callback();
		}

		await new Promise<void>((resolve) => {
			this.stopResolve = resolve;
		});
	}

	private createPrompt(
		roomId: string,
		userId: string,
		timeoutMs: number = 60000,
	): Promise<Context> {
		const key = `${roomId}:${userId}`;
		const existing = this.pendingPrompts.get(key);
		if (existing) {
			clearTimeout(existing.timer);
			existing.reject(new Error("Prompt superseded"));
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingPrompts.delete(key);
				reject(new Error("Prompt timeout"));
			}, timeoutMs);
			this.pendingPrompts.set(key, { resolve, reject, timer });
		});
	}

	stop(): void {
		for (const timer of this.scheduleTimers) {
			clearInterval(timer);
		}
		this.scheduleTimers = [];
		for (const prompt of this.pendingPrompts.values()) {
			clearTimeout(prompt.timer);
			prompt.reject(new Error("Bot stopped"));
		}
		this.pendingPrompts.clear();
		this.stopResolve?.();
		this.stopResolve = undefined;
	}

	async downloadMedia(roomId: string, eventId: string): Promise<Buffer> {
		if (!this.native) {
			throw new Error("native Matrix runtime binding is missing");
		}

		return this.native.downloadMedia(roomId, eventId);
	}

	generateSelfDocumentation(): string {
		return generateBotDocumentation(this);
	}

	async writeSelfDocumentation(
		path = this.config.documentationPath,
	): Promise<string> {
		await writeFile(path, this.generateSelfDocumentation(), "utf8");
		this.log("info", "Matrix bot self-documentation written", {
			component: "sdk",
			documentationPath: path,
		});
		return path;
	}

	private async writeConfiguredSelfDocumentation(): Promise<void> {
		if (!this.config.selfDocumentation) {
			return;
		}

		await this.writeSelfDocumentation();
	}

	private startListenerSchedules(): void {
		if (this.scheduleTimers.length > 0) {
			return;
		}

		for (const listener of this.listeners) {
			for (const trigger of listener.scheduleTriggers()) {
				if (trigger.everyMs !== undefined) {
					const timer = setInterval(() => {
						void this.dispatchListeners(scheduleListenerEvent(trigger));
					}, trigger.everyMs);
					this.scheduleTimers.push(timer);
				}

				if (trigger.at !== undefined) {
					const delayMs = Math.max(
						0,
						new Date(trigger.at).getTime() - Date.now(),
					);
					const timer = setTimeout(() => {
						void this.dispatchListeners(scheduleListenerEvent(trigger));
					}, delayMs);
					this.scheduleTimers.push(timer);
				}
			}
		}
	}

	private async contextFromNative(
		message: NativeIncomingMessage,
	): Promise<Context> {
		const native = this.native;
		if (!native) throw new Error("native Matrix runtime binding is missing");

		const sessionKey = `${message.roomId}:${message.sender}`;
		if (!this.sessions.has(sessionKey)) {
			this.sessions.set(sessionKey, { data: {}, lastAccessed: Date.now() });
		}
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by set above if missing
		const session = this.sessions.get(sessionKey)!;
		session.lastAccessed = Date.now();

		let actionId: string | undefined;
		if (message.pollResponse) {
			try {
				const rawJson = await native.getEvent(
					message.roomId,
					message.pollResponse.pollEventId,
				);
				if (rawJson) {
					const parsed = JSON.parse(rawJson);
					actionId = parsed?.content?.["org.matrix.custom.action_id"];
				}
			} catch (e) {
				this.log(
					"debug",
					`Failed to resolve actionId for poll ${message.pollResponse.pollEventId}: ${e}`,
					{ component: "runtime" },
				);
			}
		}

		return {
			message: {
				id: message.eventId,
				type: message.messageType,
				rawBody: message.body,
				body: message.body,
				media: message.media
					? {
							...message.media,
							size:
								message.media.size != null
									? Number(message.media.size)
									: undefined,
							width:
								message.media.width != null
									? Number(message.media.width)
									: undefined,
							height:
								message.media.height != null
									? Number(message.media.height)
									: undefined,
							durationMs:
								message.media.durationMs != null
									? Number(message.media.durationMs)
									: undefined,
						}
					: undefined,
				poll: message.poll
					? {
							...message.poll,
							maxSelections: Number(message.poll.maxSelections ?? 1),
						}
					: undefined,
				pollResponse: message.pollResponse
					? {
							pollEventId: message.pollResponse.pollEventId,
							selections: message.pollResponse.selections,
							actionId,
						}
					: undefined,
				pollEnd: message.pollEnd
					? {
							pollEventId: message.pollEnd.pollEventId,
							text: message.pollEnd.text,
						}
					: undefined,
				reply:
					message.repliedMessage || message.replyUnsupported
						? {
								target: message.repliedMessage,
								isUnsupported: message.replyUnsupported,
							}
						: undefined,
				react: async (emoji: string) =>
					native.react(message.roomId, message.eventId, emoji),
				redact: async (reason?: string) =>
					native.redact(message.roomId, message.eventId, reason),
			},
			room: {
				id: message.roomId,
				isDirect: message.isDirect,
			},
			sender: {
				id: message.sender,
				mention: `[${message.sender}](https://matrix.to/#/${message.sender})`,
				isAdmin: (userId?: string) => {
					const target = userId ?? message.sender;
					return this.options.admin?.includes(target) ?? false;
				},
				isModerator: (userId?: string) => {
					const target = userId ?? message.sender;
					if (this.options.admin?.includes(target)) return true;
					return this.options.moderator?.includes(target) ?? false;
				},
			},
			send: createSendContext(native, message.roomId, Promise.resolve()),
			reply: createReplyContext(
				native,
				message.roomId,
				message.eventId,
				Promise.resolve(),
			),
			downloadMedia: (target?: MediaDownloadTarget) => {
				const resolvedTarget = resolveMediaDownloadTarget(target, message);
				return native.downloadMedia(
					resolvedTarget.roomId,
					resolvedTarget.eventId,
				);
			},
			closePoll: async (pollEventId: string, fallbackText?: string) => {
				return native.closePoll(message.roomId, pollEventId, fallbackText);
			},
			session: session.data,
			prompt: async (body: string, options?: { timeoutMs?: number }) => {
				await native.sendText(message.roomId, body);
				return this.createPrompt(
					message.roomId,
					message.sender,
					options?.timeoutMs,
				);
			},
		};
	}

	private async handleError(context: MatrixErrorContext): Promise<void> {
		try {
			await this.errorHandler(context);
		} catch (error) {
			this.log("error", "Matrix bot error handler failed", {
				component: "sdk",
				error: errorToString(error),
			});
		}
	}

	private defaultErrorHandler(context: MatrixErrorContext): void {
		this.log("error", "Matrix bot error", {
			component: context.phase === "dispatch" ? "dispatch" : "runtime",
			eventId: context.request?.message.id,
			roomId: context.request?.room.id,
			sender: context.request?.sender.id,
			error: errorToString(context.error),
		});
	}

	private log(
		level: MatrixLogLevel,
		message: string,
		fields: Omit<MatrixLogEvent, "level" | "message">,
	): void {
		this.logger({ level, message, ...fields });
	}
}

/**
 * Represents a listener that responds to specific events, such as incoming messages,
 * scheduled triggers, or external webhooks.
 */
export class Listener<TConfig extends ListenerConfig = ListenerConfig> {
	readonly name: string;
	readonly description?: string;
	readonly triggers: NormalizedListenerTrigger[];
	readonly config: TConfig;
	readonly native;
	private pipeline?: {
		middleware: ListenerMiddleware[];
		handler: ListenerHandler;
	};

	constructor(options: ListenerOptions<TConfig>) {
		assertPresent("name", options.name);
		this.name = options.name;
		this.description = options.description;
		this.triggers = normalizeListenerTriggers(options.triggers);
		this.config = (options.config ?? {}) as TConfig;
		this.native = nativeBinding?.Listener
			? new nativeBinding.Listener(
					this.name,
					nativeListenerMatrixMessageTriggers(this.triggers),
				)
			: undefined;
	}

	use(...pipeline: [...ListenerMiddleware[], ListenerHandler]): this {
		this.pipeline = createListenerPipeline(pipeline);
		return this;
	}

	async dispatch(
		event: ListenerEvent,
		actions: ListenerActions,
	): Promise<number> {
		if (!this.pipeline || !this.matches(event)) {
			return 0;
		}

		await runListenerPipeline(
			event,
			actions,
			this.pipeline.middleware,
			this.pipeline.handler,
		);
		return 1;
	}

	matches(event: ListenerEvent): boolean {
		return this.triggers.some((trigger) =>
			listenerTriggerMatches(trigger, event),
		);
	}

	scheduleTriggers(): NormalizedListenerScheduleTrigger[] {
		return this.triggers.filter(
			(trigger): trigger is NormalizedListenerScheduleTrigger =>
				trigger.kind === "schedule",
		);
	}
}

/**
 * Represents a group of commands. Command groups can have their own middleware
 * and can act as sub-bots by mounting child commands.
 */
export class CommandGroup<
	TConfig extends CommandGroupConfig = CommandGroupConfig,
> {
	readonly name: string;
	readonly commands: string[];
	readonly description?: string;
	readonly category?: string;
	readonly adminOnly: boolean;
	readonly moderatorOnly: boolean;
	readonly roomType: "direct" | "any";
	readonly config: TConfig;
	readonly childCommands: Command[] = [];
	readonly native;
	private pipeline?: {
		middleware: Middleware[];
		handler: Handler;
	};

	constructor(options: CommandGroupOptions<TConfig>) {
		assertPresent("name", options.name);
		this.name = options.name;
		this.commands = normalizeCommands(options.command, options.commands);
		assertCommands("sub-bot", this.name, this.commands);
		this.description = options.description;
		this.category = options.category;
		this.adminOnly = options.adminOnly ?? false;
		this.moderatorOnly = options.moderatorOnly ?? false;
		this.roomType = options.roomType ?? "any";
		this.config = (options.config ?? {}) as TConfig;
		this.native = nativeBinding
			? new nativeBinding.CommandGroup(this.name, this.commands)
			: undefined;
	}

	use(...args: [Command] | [...Middleware[], Handler]): this {
		const [commandOrMiddleware, ...pipeline] = args;

		if (commandOrMiddleware instanceof Command) {
			this.mountCommand(commandOrMiddleware);
			return this;
		}

		this.pipeline = createPipeline([commandOrMiddleware, ...pipeline]);
		return this;
	}

	private mountCommand(command: Command): void {
		if (this.childCommands.some((existing) => existing.name === command.name)) {
			throw new Error(
				`a micro-bot named \`${command.name}\` is already registered in \`${this.name}\``,
			);
		}

		const duplicateCommand = firstSharedValue(
			this.childCommands.flatMap((existing) => existing.commands),
			command.commands,
		);
		if (duplicateCommand) {
			throw new Error(
				`micro-bot command \`${duplicateCommand}\` is already registered in \`${this.name}\``,
			);
		}

		this.childCommands.push(command);
	}

	async dispatch(ctx: Context): Promise<number> {
		const scopedCtx = scopeByCommand(ctx, this.commands);
		if (!scopedCtx) {
			return 0;
		}

		if (this.adminOnly && !ctx.sender.isAdmin()) return 0;
		if (this.moderatorOnly && !ctx.sender.isModerator()) return 0;
		if (this.roomType === "direct" && !ctx.room.isDirect) return 0;

		let handled = 0;
		for (const command of this.childCommands) {
			handled += await command.dispatch(scopedCtx);
		}

		if (handled > 0) {
			return handled;
		}

		if (this.pipeline) {
			await runPipeline(
				scopedCtx,
				this.pipeline.middleware,
				this.pipeline.handler,
			);
			handled = 1;
		}

		return handled;
	}

	matches(ctx: Context): boolean {
		return commandRemainder(ctx.message.body, this.commands) !== undefined;
	}

	willHandle(ctx: Context): boolean {
		const scopedCtx = scopeByCommand(ctx, this.commands);
		if (!scopedCtx) {
			return false;
		}

		if (this.adminOnly && !ctx.sender.isAdmin(ctx.sender.id)) return false;
		if (this.moderatorOnly && !ctx.sender.isModerator(ctx.sender.id))
			return false;
		if (this.roomType === "direct" && !ctx.room.isDirect) return false;

		return (
			this.childCommands.some((command) => command.willHandle(scopedCtx)) ||
			this.pipeline !== undefined
		);
	}

	command(
		match: string | string[],
		...pipeline: [...Middleware[], Handler]
	): this {
		const cmd = new Command({
			name: Array.isArray(match) ? match[0] : match,
			command: match,
		});
		cmd.use(...pipeline);
		this.use(cmd);
		return this;
	}

	default(...pipeline: [...Middleware[], Handler]): this {
		this.use(...pipeline);
		return this;
	}
}

/**
 * Represents a single command or micro-bot that can be triggered by specific chat messages.
 */
export class Command<TConfig extends CommandConfig = CommandConfig> {
	readonly name: string;
	readonly commands: string[];
	readonly description?: string;
	readonly adminOnly: boolean;
	readonly moderatorOnly: boolean;
	readonly roomType: "direct" | "any";
	readonly config: TConfig;
	private pipeline?: {
		middleware: Middleware[];
		handler: Handler;
	};

	constructor(options: CommandOptions<TConfig>) {
		assertPresent("name", options.name);
		this.name = options.name;
		this.commands = normalizeCommands(options.command, options.commands);
		assertCommands("micro-bot", this.name, this.commands);
		this.description = options.description;
		this.adminOnly = options.adminOnly ?? false;
		this.moderatorOnly = options.moderatorOnly ?? false;
		this.roomType = options.roomType ?? "any";
		this.config = (options.config ?? {}) as TConfig;
	}

	use(...pipeline: [...Middleware[], Handler]): this {
		this.pipeline = createPipeline(pipeline);
		return this;
	}

	async dispatch(ctx: Context): Promise<number> {
		const scopedCtx = scopeByCommand(ctx, this.commands);
		if (!scopedCtx || !this.pipeline) {
			return 0;
		}

		if (this.adminOnly && !scopedCtx.sender.isAdmin()) return 0;
		if (this.moderatorOnly && !scopedCtx.sender.isModerator()) return 0;
		if (this.roomType === "direct" && !scopedCtx.room.isDirect) return 0;

		await runPipeline(
			scopedCtx,
			this.pipeline.middleware,
			this.pipeline.handler,
		);
		return 1;
	}

	willHandle(ctx: Context): boolean {
		const scopedCtx = scopeByCommand(ctx, this.commands);
		if (!scopedCtx) return false;

		if (this.adminOnly && !ctx.sender.isAdmin(ctx.sender.id)) return false;
		if (this.moderatorOnly && !ctx.sender.isModerator(ctx.sender.id))
			return false;
		if (this.roomType === "direct" && !ctx.room.isDirect) return false;

		return this.pipeline !== undefined;
	}
}

type NormalizedListenerMatrixMessageTrigger = {
	kind: "matrix.message";
	messageTypes?: MatrixMessageType[];
	rooms?: string[];
	senders?: string[];
};

type NormalizedListenerExternalTrigger = {
	kind: "external";
	source?: string[];
	event?: string[];
};

type NormalizedListenerScheduleTrigger = {
	kind: "schedule";
	everyMs?: number;
	at?: Date | string;
	source: string;
};

type NormalizedListenerTrigger =
	| NormalizedListenerMatrixMessageTrigger
	| NormalizedListenerExternalTrigger
	| NormalizedListenerScheduleTrigger;

function normalizeListenerTriggers(
	triggers: ListenerTrigger[] = ["matrix.message"],
): NormalizedListenerTrigger[] {
	return triggers.map((trigger) => {
		if (trigger === "matrix.message") {
			return { kind: "matrix.message" };
		}

		if (trigger.kind === "external") {
			return {
				...trigger,
				source: arrayFromOptionalValue(trigger.source),
				event: arrayFromOptionalValue(trigger.event),
			};
		}

		if (trigger.kind === "schedule") {
			if (trigger.everyMs === undefined && trigger.at === undefined) {
				throw new Error("schedule listener trigger requires `everyMs` or `at`");
			}
			if (trigger.everyMs !== undefined && trigger.everyMs <= 0) {
				throw new Error(
					"schedule listener trigger `everyMs` must be greater than 0",
				);
			}

			return {
				...trigger,
				source: trigger.source ?? "schedule",
			};
		}

		return trigger;
	});
}

function nativeListenerMatrixMessageTriggers(
	triggers: NormalizedListenerTrigger[],
): NativeListenerMatrixMessageTrigger[] {
	return triggers
		.filter(
			(trigger): trigger is NormalizedListenerMatrixMessageTrigger =>
				trigger.kind === "matrix.message",
		)
		.map((trigger) => ({
			messageTypes: trigger.messageTypes,
		}));
}

function listenerTriggerMatches(
	trigger: NormalizedListenerTrigger,
	event: ListenerEvent,
): boolean {
	if (trigger.kind !== event.kind) {
		return false;
	}

	if (trigger.kind === "matrix.message") {
		const request = event.request;
		if (!request) {
			return false;
		}

		return (
			matchesOptionalList(trigger.messageTypes, request.message.type) &&
			matchesOptionalList(trigger.rooms, request.room.id) &&
			matchesOptionalList(trigger.senders, request.sender.id)
		);
	}

	if (trigger.kind === "external") {
		return (
			matchesOptionalList(trigger.source, event.source) &&
			matchesOptionalList(trigger.event, event.name)
		);
	}

	return matchesOptionalList([trigger.source], event.source);
}

function matrixMessageListenerEvent(request: Context): ListenerEvent {
	return {
		id: request.message.id,
		kind: "matrix.message",
		source: "matrix",
		request,
		timestamp: new Date(),
	};
}

function scheduleListenerEvent(
	trigger: NormalizedListenerScheduleTrigger,
): ListenerEvent {
	return {
		id: `${trigger.source}:${Date.now()}`,
		kind: "schedule",
		source: trigger.source,
		timestamp: new Date(),
	};
}

function matchesOptionalList<T>(
	values: readonly T[] | undefined,
	value: T | undefined,
): boolean {
	return (
		values === undefined ||
		values.length === 0 ||
		(value !== undefined && values.includes(value))
	);
}

function arrayFromOptionalValue(
	value?: string | string[],
): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	return Array.isArray(value) ? value : [value];
}

function assertPresent(field: string, value: string | string[]): void {
	if (
		!value ||
		(typeof value === "string" ? value.trim().length === 0 : value.length === 0)
	) {
		throw new Error(`${field} is required`);
	}
}

function resolveMatrixBotConfig(
	config: MatrixBotRuntimeConfig = {},
): ResolvedMatrixBotRuntimeConfig {
	return {
		announceCommandGroupUsage: config.announceCommandGroupUsage ?? false,
		selfDocumentation: config.selfDocumentation ?? false,
		documentationPath: config.documentationPath ?? "matrix-bot-family.md",
		utility: config.utility ?? false,
	};
}

function toNativeOptions(options: MatrixBotOptions): {
	homeserverUrl: string;
	username: string;
	password: string;
	recoveryKey: string;
	dataDir?: string;
	admin: string[];
	moderator?: string[];
	timeline_limit?: number;
} {
	return {
		homeserverUrl: options.homeserverUrl,
		username: options.username,
		password: options.password,
		recoveryKey: options.recoveryKey,
		dataDir: options.dataDir,
		admin: options.admin,
		moderator: options.moderator,
		timeline_limit: options.timelineLimit,
	};
}

function generateBotDocumentation(bot: MatrixBot): string {
	const lines = [
		"# Matrix Bot Family Tree",
		"",
		`Generated: ${new Date().toISOString()}`,
		"",
		"## Main Bot",
		"",
		`- User: ${formatInline(bot.options.username)}`,
		`- Homeserver: ${formatInline(bot.options.homeserverUrl)}`,
		`- Sub-bots: ${bot.commandGroups.length}`,
		`- Listeners: ${bot.listeners.length}`,
		"",
		"## Family Tree",
		"",
		"```text",
		`${bot.options.username || "MatrixBot"}`,
	];

	if (bot.commandGroups.length === 0) {
		lines.push("  (no sub-bots mounted)");
	} else {
		for (const commandGroup of bot.commandGroups) {
			lines.push(
				`  -> ${commandGroup.name} (${commandGroup.commands.join(", ")})`,
			);
			if (commandGroup.childCommands.length === 0) {
				continue;
			}

			for (const command of commandGroup.childCommands) {
				lines.push(`      -> ${command.name} (${command.commands.join(", ")})`);
			}
		}
	}

	if (bot.listeners.length > 0) {
		for (const listener of bot.listeners) {
			lines.push(`  -> ${listener.name} [listener]`);
		}
	}

	lines.push("```", "", "## Commands", "");

	if (bot.commandGroups.length === 0 && bot.listeners.length === 0) {
		lines.push("No commands are mounted.", "");
		return lines.join("\n");
	}

	for (const commandGroup of bot.commandGroups) {
		lines.push(`### ${commandGroup.name}`, "");
		lines.push(`- Type: CommandGroup`);
		lines.push(`- Commands: ${formatCommandList(commandGroup.commands)}`);
		lines.push(
			`- Description: ${commandGroup.description ?? "No description."}`,
		);
		if (commandGroup.category) {
			lines.push(`- Category: ${commandGroup.category}`);
		}
		if (commandGroup.adminOnly) {
			lines.push(`- Admin only: yes`);
		}

		if (commandGroup.childCommands.length === 0) {
			lines.push("");
			continue;
		}

		lines.push("", "| Command | Commands | Description |");
		lines.push("| --- | --- | --- |");
		for (const command of commandGroup.childCommands) {
			lines.push(
				`| ${escapeTableCell(command.name)} | ${escapeTableCell(formatCommandList(command.commands))} | ${escapeTableCell(command.description ?? "No description.")} |`,
			);
		}
		lines.push("");
	}

	if (bot.listeners.length > 0) {
		lines.push("## Listeners", "");
		for (const listener of bot.listeners) {
			lines.push(`### ${listener.name}`, "");
			lines.push(`- Type: Listener`);
			lines.push(`- Triggers: ${formatListenerTriggers(listener.triggers)}`);
			lines.push(`- Description: ${listener.description ?? "No description."}`);
			lines.push("");
		}
	}

	return lines.join("\n");
}

function formatCommandList(commands: string[]): string {
	return commands.map(formatInline).join(", ");
}

function formatListenerTriggers(triggers: NormalizedListenerTrigger[]): string {
	return triggers.map((trigger) => formatInline(trigger.kind)).join(", ");
}

function formatInline(value: string): string {
	return `\`${value.replaceAll("`", "\\`")}\``;
}

function escapeTableCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function normalizeCommands(
	command: string | string[],
	commands?: string | string[],
): string[] {
	const values = [...arrayFromCommand(command), ...arrayFromCommand(commands)]
		.map((value) => value.trim())
		.filter(Boolean);

	return [...new Set(values)];
}

function arrayFromCommand(command?: string | string[]): string[] {
	if (command === undefined) {
		return [];
	}

	return Array.isArray(command) ? command : [command];
}

function assertCommands(kind: string, name: string, commands: string[]): void {
	if (commands.length === 0) {
		throw new Error(`${kind} \`${name}\` requires at least one command`);
	}
}

function firstSharedValue(left: string[], right: string[]): string | undefined {
	const values = new Set(left);
	return right.find((value) => values.has(value));
}

function createPipeline(pipeline: Array<Middleware | Handler>): {
	middleware: Middleware[];
	handler: Handler;
} {
	if (pipeline.length === 0) {
		throw new Error("handler is required");
	}

	return {
		middleware: pipeline.slice(0, -1) as Middleware[],
		handler: pipeline[pipeline.length - 1] as Handler,
	};
}

function createListenerPipeline(
	pipeline: Array<ListenerMiddleware | ListenerHandler>,
): {
	middleware: ListenerMiddleware[];
	handler: ListenerHandler;
} {
	if (pipeline.length === 0) {
		throw new Error("handler is required");
	}

	return {
		middleware: pipeline.slice(0, -1) as ListenerMiddleware[],
		handler: pipeline[pipeline.length - 1] as ListenerHandler,
	};
}

function scopeByCommand(ctx: Context, commands: string[]): Context | undefined {
	const remainder = commandRemainder(ctx.message.body, commands);
	if (remainder === undefined) {
		return undefined;
	}

	return { ...ctx, message: { ...ctx.message, body: remainder } };
}

function commandRemainder(
	body: string,
	commands: string[],
): string | undefined {
	const trimmed = body.trim();
	const lower = trimmed.toLowerCase();
	const command = commands.find((candidate) => {
		const lc = candidate.toLowerCase();
		return lower === lc || lower.startsWith(`${lc} `);
	});
	if (!command) {
		return undefined;
	}

	return trimmed.slice(command.length).trimStart();
}

function _optionalNumber(
	value: number | bigint | undefined,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	return Number(value);
}

function resolveMediaDownloadTarget(
	target: MediaDownloadTarget | undefined,
	message: Pick<NativeIncomingMessage, "roomId" | "eventId">,
): { roomId: string; eventId: string } {
	if (typeof target === "string") {
		assertPresent("media download target eventId", target);
		return {
			roomId: message.roomId,
			eventId: target,
		};
	}

	return {
		roomId: target?.roomId ?? message.roomId,
		eventId: target?.eventId ?? message.eventId,
	};
}

export async function normalizeMediaAttachment(
	attachment: MediaAttachment,
	kind: MediaKind = "file",
): Promise<NativeMediaAttachment> {
	if (typeof attachment === "string") {
		return mediaAttachmentFromPath(attachment, kind);
	}

	if ("data" in attachment) {
		return attachment;
	}

	return mediaAttachmentFromPath(attachment.path, kind, attachment);
}

async function mediaAttachmentFromPath(
	path: string,
	kind: MediaKind,
	options: Pick<MediaPathAttachment, "filename" | "contentType"> = {},
): Promise<NativeMediaAttachment> {
	assertPresent("attachment path", path);

	return {
		filename: options.filename ?? basename(path),
		contentType: options.contentType ?? inferContentType(path, kind),
		data: await readFile(path),
	};
}

function inferContentType(path: string, kind: MediaKind): string {
	const extension = extname(path).toLowerCase();
	const contentType = contentTypesByExtension[extension];
	if (contentType) {
		return contentType;
	}

	switch (kind) {
		case "image":
			return "image/png";
		case "video":
			return "video/mp4";
		default:
			return "application/octet-stream";
	}
}

async function runPipeline(
	ctx: Context,
	middleware: Middleware[],
	handler: Handler,
): Promise<void> {
	let index = -1;

	async function dispatch(position: number): Promise<void> {
		if (position <= index) {
			throw new Error("next() called multiple times");
		}
		index = position;

		const layer = middleware[position];
		if (!layer) {
			await handler(ctx);
			return;
		}

		await layer(ctx, () => dispatch(position + 1));
	}

	await dispatch(0);
}

async function runListenerPipeline(
	event: ListenerEvent,
	actions: ListenerActions,
	middleware: ListenerMiddleware[],
	handler: ListenerHandler,
): Promise<void> {
	let index = -1;

	async function dispatch(position: number): Promise<void> {
		if (position <= index) {
			throw new Error("next() called multiple times");
		}
		index = position;

		const layer = middleware[position];
		if (!layer) {
			await handler(event, actions);
			return;
		}

		await layer(event, actions, () => dispatch(position + 1));
	}

	await dispatch(0);
}

const nativeBinding = loadNativeBinding();

const contentTypesByExtension: Record<string, string> = {
	".7z": "application/x-7z-compressed",
	".aac": "audio/aac",
	".apng": "image/apng",
	".avif": "image/avif",
	".bmp": "image/bmp",
	".csv": "text/csv",
	".doc": "application/msword",
	".docx":
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".flac": "audio/flac",
	".gif": "image/gif",
	".gz": "application/gzip",
	".htm": "text/html",
	".html": "text/html",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".json": "application/json",
	".m4v": "video/mp4",
	".md": "text/markdown",
	".mov": "video/quicktime",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".mpeg": "video/mpeg",
	".mpg": "video/mpeg",
	".ogg": "audio/ogg",
	".opus": "audio/opus",
	".pdf": "application/pdf",
	".png": "image/png",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx":
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".rar": "application/vnd.rar",
	".svg": "image/svg+xml",
	".tar": "application/x-tar",
	".tiff": "image/tiff",
	".txt": "text/plain",
	".wav": "audio/wav",
	".webm": "video/webm",
	".webp": "image/webp",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xml": "application/xml",
	".zip": "application/zip",
};

function defaultLogger(event: MatrixLogEvent): void {
	if (event.level === "debug") {
		return;
	}
	const prefix = `[${event.level.toUpperCase()}]`;
	const context: string[] = [];
	if (event.component) context.push(`component=${event.component}`);
	if (event.eventId) context.push(`event=${event.eventId}`);
	if (event.roomId) context.push(`room=${event.roomId}`);
	if (event.sender) context.push(`sender=${event.sender}`);
	if (event.handled !== undefined) context.push(`handled=${event.handled}`);
	if (event.durationMs !== undefined)
		context.push(`duration=${event.durationMs}ms`);

	const contextStr = context.length > 0 ? ` (${context.join(", ")})` : "";

	if (event.level === "error") {
		log.error(`${prefix} ${event.message}${contextStr}`);
		if (event.error) log.error(event.error);
	} else if (process.env.NODE_ENV !== "test") {
		if (event.level === "warn") {
			log.warn(`${prefix} ${event.message}${contextStr}`);
		} else {
			log.info(`${prefix} ${event.message}${contextStr}`);
		}
	}
}

function errorToString(error: unknown): string {
	if (error instanceof Error) {
		return error.stack ?? error.message;
	}
	return String(error);
}

function createSendContext(
	// biome-ignore lint/suspicious/noExplicitAny: dynamic types
	native: any,
	roomId: string,
	promise: Promise<unknown>,
): SendContext {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic types
	const sendCtx: any = {
		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
		catch: (onrejected: any) => promise.catch(onrejected),
		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
		finally: (onfinally: any) => promise.finally(onfinally),
		get [Symbol.toStringTag]() {
			return "Promise";
		},
		message: (body: string) =>
			createSendContext(
				native,
				roomId,
				promise.then(() => native.sendText(roomId, body)),
			),
		text: (body: string) => sendCtx.message(body),
		markdown: (body: string) =>
			createSendContext(
				native,
				roomId,
				promise.then(() => native.sendMarkdown(roomId, body)),
			),
		media: (kind: MediaKind, attachment: MediaAttachment) =>
			createSendContext(
				native,
				roomId,
				promise.then(async () => {
					const normalized = await normalizeMediaAttachment(attachment, kind);
					if (kind === "image") await native.sendImage(roomId, normalized);
					else if (kind === "video") await native.sendVideo(roomId, normalized);
					else await native.sendFile(roomId, normalized);
				}),
			),
		image: (attachment: MediaAttachment) =>
			createSendContext(
				native,
				roomId,
				promise.then(async () => {
					await native.sendImage(
						roomId,
						await normalizeMediaAttachment(attachment, "image"),
					);
				}),
			),
		file: (attachment: MediaAttachment) =>
			createSendContext(
				native,
				roomId,
				promise.then(async () => {
					await native.sendFile(
						roomId,
						await normalizeMediaAttachment(attachment, "file"),
					);
				}),
			),
		video: (attachment: MediaAttachment) =>
			createSendContext(
				native,
				roomId,
				promise.then(async () => {
					await native.sendVideo(
						roomId,
						await normalizeMediaAttachment(attachment, "video"),
					);
				}),
			),
		poll: (poll: OutboundPoll) =>
			createSendContext(
				native,
				roomId,
				promise.then(() =>
					native.sendPoll(roomId, {
						question: poll.question,
						answers: poll.answers,
						kind:
							poll.kind === "undisclosed"
								? "org.matrix.msc3381.poll.undisclosed"
								: poll.kind === "disclosed"
									? "org.matrix.msc3381.poll.disclosed"
									: undefined,
						maxSelections: poll.maxSelections,
						actionId: poll.actionId,
					}),
				),
			),
	};
	// biome-ignore lint/suspicious/noThenProperty: Context is designed to be thenable for chaining
	Object.defineProperty(sendCtx, "then", {
		// biome-ignore lint/suspicious/noExplicitAny: Promise resolution signature
		value: (onfulfilled: any, onrejected: any) =>
			promise.then(onfulfilled, onrejected),
	});
	return sendCtx as SendContext;
}

function createReplyContext(
	// biome-ignore lint/suspicious/noExplicitAny: dynamic types
	native: any,
	roomId: string,
	eventId: string,
	promise: Promise<unknown>,
): ReplyContext {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic types
	const replyCtx: any = {
		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
		catch: (onrejected: any) => promise.catch(onrejected),
		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
		finally: (onfinally: any) => promise.finally(onfinally),
		get [Symbol.toStringTag]() {
			return "Promise";
		},
		message: (body: string) =>
			createReplyContext(
				native,
				roomId,
				eventId,
				promise.then(() => native.replyText(roomId, eventId, body)),
			),
		text: (body: string) => replyCtx.message(body),
		markdown: (body: string) =>
			createReplyContext(
				native,
				roomId,
				eventId,
				promise.then(() => native.replyMarkdown(roomId, eventId, body)),
			),
	};
	// biome-ignore lint/suspicious/noThenProperty: Context is designed to be thenable for chaining
	Object.defineProperty(replyCtx, "then", {
		// biome-ignore lint/suspicious/noExplicitAny: Promise resolution signature
		value: (onfulfilled: any, onrejected: any) =>
			promise.then(onfulfilled, onrejected),
	});
	return replyCtx as ReplyContext;
}
