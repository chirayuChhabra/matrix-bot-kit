import { CommandGroup } from "./command.js";
import { Listener } from "./listener.js";
import { nativeBinding } from "./constants.js";
import { writeFile } from "node:fs/promises";
import { Context, EventFilterOptions, Handler, ListenerActions, ListenerEvent, ListenerHandler, ListenerMiddleware, ListenerTrigger, MatrixBotModule, MatrixBotOptions, MatrixBotRuntimeConfig, MatrixErrorContext, MatrixErrorHandler, MatrixLogEvent, MatrixLogger, MatrixLogLevel, MediaDownloadTarget, Middleware, Next, ScheduleOptions, UtilityConfig, WebhookOptions } from "./types.js";
import { createReplyContext, createSendContext, resolveMediaDownloadTarget } from "./context";
import { assertPresent, defaultLogger, errorToString, firstSharedValue, generateBotDocumentation } from "./helpers";
import { matrixMessageListenerEvent, scheduleListenerEvent } from "./listener";
import { loadNativeBinding, MatrixMessageType, NativeIncomingMessage } from "./native";
import { ResolvedMatrixBotRuntimeConfig } from "./types";

export function resolveMatrixBotConfig(config: MatrixBotRuntimeConfig = {}): ResolvedMatrixBotRuntimeConfig {
    let utility: UtilityConfig = { enabled: false, maintenancePassword: "" };
    if (config.utility) {
    	utility = { enabled: config.utility.enabled ?? true, ...config.utility };
    	if (utility.enabled) {
    		assertPresent(
    			"config.utility.maintenancePassword",
    			config.utility.maintenancePassword,
    		);
    	}
    }

    return {
    	announceCommandGroupUsage: config.announceCommandGroupUsage ?? false,
    	selfDocumentation: config.selfDocumentation ?? false,
    	documentationPath: config.documentationPath ?? "matrix-bot-family.md",
    	utility,
    };
}

export function toNativeOptions(options: MatrixBotOptions): {
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
        if (this.config.utility.enabled) {
        	this.setupUtilityCommands();
        }
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
     * The event listener namespace. Contains specialized methods for responding to Matrix events, schedules, and webhooks.
     * All methods support chaining infinite middleware before the final handler.
     *
     * @example
     * ```ts
     * // Global message listener
     * bot.on.message(async (event, actions) => { ... })
     *
     * // Scoped listener using options
     * bot.on.message({ rooms: ["!myRoom:matrix.org"] }, async (event, actions) => { ... })
     *
     * // Tagged poll vote listener
     * bot.on.pollVote({ actionId: "my_poll_tag" }, async (event, actions) => { ... })
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
        const checkPassword = async (ctx: Context): Promise<boolean> => {
            			const expectedPassword = this.config.utility.maintenancePassword;
            			const promptCtx = await ctx.prompt("Please enter the maintenance password:");
            			const password = promptCtx.message.body.trim();

            			const passwordBuf = Buffer.from(password);
            			const expectedPasswordBuf = Buffer.from(expectedPassword);
            			const isPasswordValid =
            				passwordBuf.length === expectedPasswordBuf.length &&
            				crypto.timingSafeEqual(passwordBuf, expectedPasswordBuf);

            			if (!isPasswordValid) {
            				await ctx.reply.text("Invalid password.");
            				await promptCtx.message.redact("Hide password");
            				return false;
            			}
            			await promptCtx.message.redact("Hide password");
            			return true;
            		};
        registerUtility(
        	"!maintenance",
        	"Toggles maintenance mode.",
        	async (ctx) => {
        		if (!(await checkPassword(ctx))) return;

        		this.isUnderMaintenance = !this.isUnderMaintenance;
        		await ctx.reply.text(
        			`Maintenance mode is now ${this.isUnderMaintenance ? "ON" : "OFF"}.`,
        		);
        	},
        );
        registerUtility(
        	"!shutdown",
        	"Shuts down the bot gracefully.",
        	async (ctx) => {
        		if (!(await checkPassword(ctx))) return;

        		await ctx.reply.text("Shutting down gracefully...");
        		await this.stop();
        		process.exit(0);
        	},
        );
        registerUtility(
        	"!reload",
        	"Reloads the bot by spawning a new instance and stopping the old one.",
        	async (ctx) => {
        		if (!(await checkPassword(ctx))) return;

        		await ctx.reply.text("Spawning new instance and reloading...");

        		await this.stop();

        		const { spawn } = await import("node:child_process");
        		const child = spawn(process.execPath, process.argv.slice(1), {
        			detached: true,
        			stdio: "inherit",
        		});
        		child.unref();

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
     * Registers a sub-bot (CommandGroup), a Listener, or a functional module plugin with the main bot.
     * @param component The CommandGroup, Listener, or plugin function to register.
     * @returns This MatrixBot instance for chaining.
     */
    use(component: CommandGroup | Listener | MatrixBotModule): this {
        if (typeof component === "function") {
        	void component(this);
        	return this;
        }

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

    /**
     * Registers a command handler.
     * @param match The command string or array of command strings to trigger this handler.
     * @param pipeline The middleware and handler to execute when the command is triggered.
     * @returns This MatrixBot instance for chaining.
     */
    command(match: string | string[], ...pipeline: [...Middleware[], Handler]): this {
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

    private inner_on(event: string, ...args: any[]): this {
        const isRooms = typeof args[0] === "string" ||
            			(Array.isArray(args[0]) && typeof args[0][0] === "string");
        const rooms = isRooms ? (args[0] as string | string[]) : undefined;
        const pipeline = isRooms ? args.slice(1) : args;
        const roomsArray = rooms
            			? Array.isArray(rooms)
            				? rooms
            				: [rooms]
            			: undefined;
        const name = `on-${event}-${++this.onListenerCount}`;
        const triggers: ListenerTrigger[] = event === "message"
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

    schedule(options: ScheduleOptions, ...pipeline: [...ListenerMiddleware[], ListenerHandler]): this {
        const name = `schedule-${++this.scheduleListenerCount}`;
        const listener = new Listener({
            			name,
            			triggers: [{ kind: "schedule", ...options, source: "schedule" }],
            		});
        listener.use(...pipeline);
        this.useListener(listener);
        return this;
    }

    webhook(source: string, event: string | undefined, ...pipeline: [...ListenerMiddleware[], ListenerHandler]): this {
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
    async closePoll(roomId: string, pollEventId: string, fallbackText?: string): Promise<void> {
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

    async dispatchListeners(event: ListenerEvent, actions: ListenerActions = {}): Promise<number> {
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

    async emitExternal(source: string, name: string, payload?: unknown): Promise<number> {
        return this.dispatchListeners({
        	id: `${source}:${name}:${Date.now()}`,
        	kind: "external",
        	source,
        	name,
        	payload,
        	timestamp: new Date(),
        });
    }

    private async sendCommandGroupUsageNotice(commandGroup: CommandGroup, ctx: Context): Promise<void> {
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

    private createPrompt(roomId: string, userId: string, timeoutMs: number = 60000): Promise<Context> {
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
        this.native?.stop();
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

    async writeSelfDocumentation(path = this.config.documentationPath): Promise<string> {
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

    private async contextFromNative(message: NativeIncomingMessage): Promise<Context> {
        const native = this.native;
        if (!native) throw new Error("native Matrix runtime binding is missing");
        const sessionKey = `${message.roomId}:${message.sender}`;
        if (!this.sessions.has(sessionKey)) {
        	this.sessions.set(sessionKey, { data: {}, lastAccessed: Date.now() });
        }

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

    private log(level: MatrixLogLevel, message: string, fields: Omit<MatrixLogEvent, "level" | "message">): void {
        this.logger({ level, message, ...fields });
    }
}
