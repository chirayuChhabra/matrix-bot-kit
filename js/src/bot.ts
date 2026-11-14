import { writeFile } from "node:fs/promises";
import log from "loglevel";
import { Command, CommandGroup, checkAccess } from "./command";
import {
	createMessageHandle,
	createRoomHandle,
	createRoomSender,
	PromptManager,
} from "./context";
import { BotError } from "./errors";
import { constantTimeCompare } from "./helpers";
import { ListenerRegistry } from "./listener";
import {
	loadNativeBinding,
	type NativeBinding,
	type NativeIncomingMessage,
} from "./native";
import { ScheduleManager } from "./schedule";
import type {
	AccessLevel,
	BotModule,
	BotStatus,
	CommandGroupOptions,
	CommandHandler,
	CommandOptions,
	Context,
	MatrixBotOptions,
	MatrixErrorContext,
	Middleware,
	RegisteredCommandInfo,
	RoomHandle,
	ScheduleContext,
	ScheduleOptions,
} from "./types";

export class Listener {
	readonly name: string;
	readonly triggers: any[];

	constructor(options: { name: string; triggers?: any[] }) {
		this.name = options.name;
		this.triggers = options.triggers || [];
	}
}

export class MatrixBot<
	TSession extends Record<string, any> = Record<string, any>,
> {
	readonly options: MatrixBotOptions;
	readonly admins: string[];
	readonly moderators: string[];
	readonly storageDir: string;
	readonly logger: any;
	readonly on: ListenerRegistry;

	status: BotStatus = "idle";
	private readonly rootCommands = new Map<string, Command>();
	private readonly commandGroups = new Map<string, CommandGroup>();
	private readonly globalMiddlewares: Middleware[] = [];
	private readonly modules: Array<{
		name: string;
		cleanup?: () => void | Promise<void>;
	}> = [];
	private readonly pendingModules: BotModule[] = [];
	private readonly sessions = new Map<string, TSession>();
	private readonly promptManager = new PromptManager();
	private readonly scheduleManager: ScheduleManager;

	private nativeBinding?: NativeBinding;
	private nativeBot?: any;
	private stopResolver?: () => void;
	private stopPromise?: Promise<void>;
	private maintenanceMode = false;
	private startTime = Date.now();

	constructor(options: MatrixBotOptions) {
		if (!options || typeof options !== "object") {
			throw new BotError("Options object is required", "VALIDATION");
		}

		if (
			!options.homeserverUrl ||
			typeof options.homeserverUrl !== "string" ||
			!options.homeserverUrl.trim()
		) {
			throw new BotError("homeserverUrl is required", "VALIDATION");
		}

		this.options = { ...options };

		// Normalize admins and moderators (default to empty arrays!)
		const admins = options.admins ?? options.admin ?? [];
		if (!Array.isArray(admins)) {
			throw new BotError("admins must be an array of strings", "VALIDATION");
		}
		this.admins = [...admins];

		const moderators = options.moderators ?? options.moderator ?? [];
		if (!Array.isArray(moderators)) {
			throw new BotError(
				"moderators must be an array of strings",
				"VALIDATION",
			);
		}
		this.moderators = [...moderators];

		// Storage directory
		this.storageDir =
			options.storage?.directory ?? options.dataDir ?? "./.matrix-bot-kit";

		// Logger
		this.logger = options.logger ?? log;

		// Initialize registries
		this.on = new ListenerRegistry(this);
		this.scheduleManager = new ScheduleManager(this);

		// Setup utility commands if configured
		if (this.options.config?.utility) {
			this.setupUtilityCommands();
		}

		// Try loading native binding
		this.nativeBinding = loadNativeBinding();
	}

	get nativeAvailable(): boolean {
		return true;
	}

	get commandGroupCount(): number {
		return this.commandGroups.size;
	}

	get listenerCount(): number {
		return this.on.listeners.length;
	}

	room(roomId: string): RoomHandle {
		if (!roomId || !roomId.trim()) {
			throw new BotError("roomId is required", "VALIDATION");
		}
		return createRoomHandle(roomId, this.nativeBot);
	}

	use(...items: any[]): this {
		for (const item of items) {
			if (item instanceof CommandGroup || item?.commands) {
				this.useCommandGroup(item);
			} else if (item instanceof Listener || item?.triggers) {
				this.on.message(async () => {});
			} else if (typeof item === "function") {
				this.globalMiddlewares.push(item);
			}
		}
		return this;
	}

	command<T = unknown>(
		nameOrNames: string | string[],
		...rest: Array<CommandOptions<T> | Middleware | CommandHandler>
	): this {
		let options: CommandOptions<T> | undefined;
		const middlewares: Middleware[] = [];
		let handler: CommandHandler | undefined;

		let idx = 0;
		if (rest.length > 0 && typeof rest[0] === "object" && rest[0] !== null) {
			options = rest[0] as CommandOptions<T>;
			idx = 1;
		}

		const handlers = rest.slice(idx) as Array<Middleware | CommandHandler>;
		if (handlers.length === 0) {
			throw new Error("Command must have a handler function");
		}

		handler = handlers[handlers.length - 1] as CommandHandler;
		for (let i = 0; i < handlers.length - 1; i++) {
			middlewares.push(handlers[i] as Middleware);
		}

		const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
		const primaryName = names[0];
		if (!primaryName || !primaryName.trim()) {
			throw new Error("Command name is required");
		}

		const cleanPrimary = primaryName.trim();
		const aliases = [...names.slice(1), ...(options?.aliases || [])];

		const cmd = new Command(
			cleanPrimary,
			{ ...options, aliases },
			middlewares,
			handler,
		);

		if (this.rootCommands.has(cleanPrimary.toLowerCase())) {
			throw new Error(`Command '${cleanPrimary}' is already registered`);
		}

		this.rootCommands.set(cleanPrimary.toLowerCase(), cmd);
		return this;
	}

	group(
		nameOrNames: string | string[],
		options?: CommandGroupOptions,
	): CommandGroup {
		const primaryName = Array.isArray(nameOrNames)
			? nameOrNames[0]
			: nameOrNames;
		const cleanName = primaryName.trim();

		if (this.commandGroups.has(cleanName.toLowerCase())) {
			throw new Error(`Command group '${cleanName}' is already registered`);
		}

		const group = new CommandGroup(nameOrNames, options);
		this.commandGroups.set(cleanName.toLowerCase(), group);
		return group;
	}

	useCommandGroup(group: CommandGroup): this {
		const key = group.name.toLowerCase();
		if (this.commandGroups.has(key)) {
			throw new Error(`Command group '${group.name}' is already registered`);
		}
		this.commandGroups.set(key, group);
		return this;
	}

	install(plugin: BotModule): this {
		this.pendingModules.push(plugin);
		return this;
	}

	mount(plugin: BotModule): this {
		return this.install(plugin);
	}

	schedule(
		name: string,
		options: ScheduleOptions,
		handler: (ctx: ScheduleContext) => Promise<void> | void,
	): { name: string; dispose: () => void } {
		return this.scheduleManager.schedule(name, options, handler);
	}

	async emitExternal(
		source: string,
		event: string,
		payload: unknown,
	): Promise<void> {
		const ctx = {
			source,
			event,
			payload,
			bot: this,
			timestamp: new Date(),
		};
		const matching = this.on.listeners.filter((l) => {
			if (l.kind !== "external") return false;
			if (l.filter?.tag && l.filter.tag !== source) return false;
			return true;
		});

		for (const listener of matching) {
			try {
				await listener.handler(ctx);
			} catch (err) {
				await this.handleError(err, "listener");
			}
		}
	}

	async start(): Promise<void> {
		if (this.status === "running") {
			return;
		}

		this.status = "starting";
		this.startTime = Date.now();

		this.stopPromise = new Promise<void>((resolve) => {
			this.stopResolver = resolve;
		});

		try {
			// Await setup of all installed modules
			while (this.pendingModules.length > 0) {
				const mod = this.pendingModules.shift()!;
				if (typeof mod === "function") {
					await mod(this);
				} else {
					const cleanup = await mod.setup(this);
					this.modules.push({
						name: mod.name,
						cleanup: typeof cleanup === "function" ? cleanup : undefined,
					});
				}
			}

			// If native binding is available and auth credentials exist, start native runtime
			const username =
				this.options.auth?.type === "password"
					? this.options.auth.username
					: this.options.username;
			const password =
				this.options.auth?.type === "password"
					? this.options.auth.password
					: this.options.password;
			const recoveryKey =
				typeof this.options.encryption === "object"
					? this.options.encryption.recoveryKey
					: this.options.recoveryKey;

			if (this.nativeBinding && username && password) {
				const nativeOptions = {
					homeserverUrl: this.options.homeserverUrl,
					username,
					password,
					recoveryKey: recoveryKey || "unconfigured",
					dataDir: this.storageDir,
					admin: this.admins,
					moderator: this.moderators,
					timeline_limit: this.options.timelineLimit || 10,
				};

				this.nativeBot = new this.nativeBinding.MatrixBot(nativeOptions);

				// Register groups with native bot
				for (const group of this.commandGroups.values()) {
					if (this.nativeBot.registerCommandGroup) {
						this.nativeBot.registerCommandGroup({ name: group.name });
					}
				}

				await new Promise<void>((resolve, reject) => {
					let settled = false;
					const timer = setTimeout(() => {
						if (!settled) {
							settled = true;
							resolve(); // Allow start to proceed even if homeserver is slow/mock
						}
					}, 100);

					this.nativeBot.start(
						(nativeMsg: NativeIncomingMessage) => {
							this.handleNativeIncomingMessage(nativeMsg).catch((err) => {
								this.handleError(err, "dispatch");
							});
						},
						(nativeLog: any) => {
							this.logger.debug?.(
								`[Native] ${nativeLog.level}: ${nativeLog.message}`,
							);
						},
						() => {
							if (!settled) {
								settled = true;
								clearTimeout(timer);
								resolve();
							}
						},
					);
				});
			}

			this.status = "running";
		} catch (err) {
			this.status = "failed";
			await this.handleError(err, "startup");
			throw err;
		}
	}

	async stop(): Promise<void> {
		if (this.status === "stopped") {
			return;
		}

		this.status = "stopping";

		// 1. Clear prompts
		this.promptManager.clear();

		// 2. Stop all background schedules
		this.scheduleManager.stopAll();

		// 3. Run module cleanups in reverse order
		while (this.modules.length > 0) {
			const mod = this.modules.pop()!;
			if (mod.cleanup) {
				try {
					await mod.cleanup();
				} catch (err) {
					this.logger.error?.(`Error disposing module ${mod.name}:`, err);
				}
			}
		}

		this.status = "stopped";
		if (this.stopResolver) {
			this.stopResolver();
			this.stopResolver = undefined;
		}
	}

	async run(): Promise<void> {
		await this.start();
		await this.waitUntilStopped();
	}

	waitUntilStopped(): Promise<void> {
		if (this.status === "stopped") {
			return Promise.resolve();
		}
		if (!this.stopPromise) {
			this.stopPromise = new Promise<void>((resolve) => {
				this.stopResolver = resolve;
			});
		}
		return this.stopPromise;
	}

	private getSession(roomId: string, senderId: string): TSession {
		const key = `${roomId}:${senderId}`;
		let sess = this.sessions.get(key);
		if (!sess) {
			sess = {} as TSession;
			this.sessions.set(key, sess);
		}
		return sess;
	}

	private async handleNativeIncomingMessage(
		nativeMsg: NativeIncomingMessage,
	): Promise<void> {
		const roomId = nativeMsg.roomId;
		const senderId = nativeMsg.sender;
		const eventId = nativeMsg.eventId;

		const isAdmin = () => this.admins.includes(senderId);
		const isModerator = () => this.moderators.includes(senderId) || isAdmin();

		const messageCtx = {
			id: eventId,
			type: nativeMsg.messageType,
			body: nativeMsg.body,
			rawBody: nativeMsg.body,
			media: nativeMsg.media
				? {
						kind: nativeMsg.media.kind as any,
						filename: nativeMsg.media.filename,
						contentType: nativeMsg.media.mimetype,
						size: nativeMsg.media.size,
						download: async () => {
							if (this.nativeBot?.downloadMedia) {
								return this.nativeBot.downloadMedia(roomId, eventId);
							}
							return Buffer.from([]);
						},
					}
				: undefined,
			poll: nativeMsg.poll,
			pollResponse: nativeMsg.pollResponse,
			pollEnd: nativeMsg.pollEnd,
			replyTo: nativeMsg.repliedMessage
				? createMessageHandle(
						roomId,
						nativeMsg.repliedMessage.eventId,
						this.nativeBot,
					)
				: undefined,
			react: async (emoji: string) => {
				if (this.nativeBot?.react) {
					await this.nativeBot.react(roomId, eventId, emoji);
				}
				return createRoomHandle(roomId, this.nativeBot).message(eventId) as any;
			},
			redact: async (reason?: string) => {
				if (this.nativeBot?.redact) {
					await this.nativeBot.redact(roomId, eventId, reason);
				}
			},
		};

		const roomCtx = {
			id: roomId,
			isDirect: nativeMsg.isDirect,
		};

		const senderCtx = {
			id: senderId,
			userId: senderId,
			mention: `<a href="https://matrix.to/#/${senderId}">${senderId}</a>`,
			isAdmin,
			isModerator,
		};

		const send = createRoomSender(roomId, this.nativeBot);
		const reply = createRoomSender(roomId, this.nativeBot, eventId);

		const promptFn: any = (text: string) => {
			send.text(text);
			return new Promise<Context<TSession>>((resolve) => {
				this.promptManager
					.register(roomId, senderId, { timeoutMs: 60_000 })
					.then((res) => {
						if (res.status === "answered") {
							resolve(ctx);
						}
					});
			});
		};

		promptFn.text = async (question: string, options?: any) => {
			const waiter = this.promptManager.register(roomId, senderId, options);
			await send.text(question);
			return waiter;
		};

		const ctx: Context<TSession> = {
			message: messageCtx,
			room: roomCtx,
			sender: senderCtx,
			send,
			reply,
			args: "",
			session: this.getSession(roomId, senderId),
			prompt: promptFn,
			bot: this,
			state: {},
			downloadMedia: async () => {
				if (this.nativeBot?.downloadMedia) {
					return this.nativeBot.downloadMedia(roomId, eventId);
				}
				return Buffer.from([]);
			},
		};

		// 1. Check prompt waiter
		if (this.promptManager.resolveAnswer(roomId, senderId, messageCtx)) {
			return;
		}

		// 2. Dispatch commands if text
		if (nativeMsg.messageType === "text") {
			await this.dispatch(ctx);
		}

		// 3. Dispatch listeners
		await this.on.dispatch(
			`matrix.${nativeMsg.messageType}`,
			ctx,
			nativeMsg.messageType,
		);
	}

	async dispatch(ctx: Context<TSession>): Promise<void> {
		if (!ctx.prompt) {
			const promptFn: any = (text: string) => {
				ctx.send?.text(text);
				return new Promise<Context<TSession>>((resolve) => {
					this.promptManager
						.register(ctx.room?.id, ctx.sender?.id, { timeoutMs: 60_000 })
						.then((res) => {
							if (res.status === "answered") {
								resolve(ctx);
							}
						});
				});
			};
			promptFn.text = async (question: string, options?: any) => {
				const waiter = this.promptManager.register(
					ctx.room?.id,
					ctx.sender?.id,
					options,
				);
				await ctx.send?.text(question);
				return waiter;
			};
			ctx.prompt = promptFn;
		} else if (!ctx.prompt.text) {
			ctx.prompt.text = async (question: string, options?: any) => {
				const waiter = this.promptManager.register(
					ctx.room?.id,
					ctx.sender?.id,
					options,
				);
				await ctx.send?.text(question);
				return waiter;
			};
		}

		const body = ctx.message.body || "";

		// If prompt manager handles it
		if (
			this.promptManager.resolveAnswer(
				ctx.room?.id,
				ctx.sender?.id,
				ctx.message,
			)
		) {
			return;
		}

		// Maintenance mode interception
		if (
			this.maintenanceMode &&
			!body.startsWith("!maintenance") &&
			!body.startsWith("!status")
		) {
			if (ctx.sender?.isAdmin?.()) {
				// Admin can bypass
			} else {
				await ctx.reply.text("Bot is under maintenance");
				return;
			}
		}

		// 1. Check root commands first
		let matchedCmd: Command | undefined;
		let aliasMatched = "";
		let commandArgs = "";
		let groupMiddlewares: Middleware[] = [];

		for (const cmd of this.rootCommands.values()) {
			const m = cmd.matches(body);
			if (m.matched) {
				matchedCmd = cmd;
				aliasMatched = m.alias;
				commandArgs = m.args;
				break;
			}
		}

		// 2. Check command groups if not matched
		if (!matchedCmd) {
			for (const group of this.commandGroups.values()) {
				const groupMatch = group.findMatch(body);
				if (groupMatch) {
					matchedCmd = groupMatch.command;
					aliasMatched = groupMatch.aliasMatched;
					commandArgs = groupMatch.args;
					groupMiddlewares = groupMatch.groupMiddlewares;
					break;
				}
			}
		}

		if (!matchedCmd) {
			return;
		}

		// Populate command context metadata
		ctx.args = commandArgs;
		ctx.command = {
			name: matchedCmd.name,
			alias: aliasMatched,
			input: commandArgs,
		};

		// Check access
		const allowed = await checkAccess(ctx, matchedCmd.access);
		if (!allowed) {
			this.logger.warn?.(
				`Access denied for ${ctx.sender?.id} to command ${matchedCmd.name}`,
			);
			return;
		}

		// Parse args if parser provided
		if (matchedCmd.argsParser) {
			try {
				if (typeof matchedCmd.argsParser === "function") {
					ctx.input = matchedCmd.argsParser(commandArgs);
				} else {
					ctx.input = matchedCmd.argsParser.parse(commandArgs);
				}
			} catch (err) {
				await ctx.reply.text(
					`⚠️ Invalid command arguments: ${(err as Error).message}`,
				);
				return;
			}
		}

		// Build middleware pipeline: global -> group -> command -> handler
		const pipeline: Middleware[] = [
			...this.globalMiddlewares,
			...groupMiddlewares,
			...matchedCmd.middlewares,
			async (c) => {
				await matchedCmd!.handler(c);
			},
		];

		// Execute middleware chain
		let idx = 0;
		const next = async (): Promise<void> => {
			if (idx < pipeline.length) {
				const fn = pipeline[idx++];
				await fn(ctx, next);
			}
		};

		try {
			await next();
		} catch (err) {
			await this.handleError(err, "dispatch", ctx);
		}
	}

	async dispatchListeners(event: any, actions?: any): Promise<number> {
		const ctx = event.request || event;
		const messageType = ctx.message?.type;
		const kind = event.kind || `matrix.${messageType || "message"}`;

		return this.on.dispatch(kind, ctx, messageType, event, actions);
	}

	async handleError(
		error: unknown,
		phase: MatrixErrorContext["phase"],
		ctx?: Context<TSession>,
	): Promise<void> {
		this.logger.error?.(`[Error in ${phase}]:`, error);
		if (this.options.onError) {
			try {
				await this.options.onError({ error, phase, ctx });
			} catch (err) {
				this.logger.error?.("Error inside custom onError handler:", err);
			}
		}
	}

	describe(): RegisteredCommandInfo[] {
		const list: RegisteredCommandInfo[] = [];
		for (const cmd of this.rootCommands.values()) {
			list.push({
				name: cmd.name,
				aliases: cmd.aliases,
				description: cmd.description,
				category: cmd.category,
				access: cmd.access,
				roomType: cmd.roomType,
			});
		}
		for (const group of this.commandGroups.values()) {
			list.push(...group.getRegisteredCommands());
		}
		return list;
	}

	help(options?: { userAccess?: AccessLevel }): string {
		const commands = this.describe();
		const filtered = options?.userAccess
			? commands.filter(
					(c) =>
						!c.access ||
						c.access === "everyone" ||
						c.access === options.userAccess,
				)
			: commands;

		let out = "## 🤖 Bot Commands\n\n";
		const byCategory = new Map<string, RegisteredCommandInfo[]>();

		for (const cmd of filtered) {
			const cat =
				cmd.category || (cmd.group ? `Group: ${cmd.group}` : "General");
			if (!byCategory.has(cat)) {
				byCategory.set(cat, []);
			}
			byCategory.get(cat)!.push(cmd);
		}

		for (const [cat, cmds] of byCategory) {
			out += `### ${cat}\n`;
			for (const c of cmds) {
				const aliasStr =
					c.aliases.length > 0 ? ` (aliases: ${c.aliases.join(", ")})` : "";
				const desc = c.description ? ` - ${c.description}` : "";
				out += `- \`${c.name}\`${aliasStr}${desc}\n`;
			}
			out += "\n";
		}

		return out.trim();
	}

	async writeDocs(filepath: string): Promise<void> {
		const content = this.help();
		await writeFile(filepath, content, "utf-8");
	}

	private setupUtilityCommands(): void {
		this.command("!ping", { description: "Ping the bot" }, async (ctx) => {
			await ctx.reply.text("pong");
		});

		this.command(
			"!status",
			{ description: "Check bot status and uptime" },
			async (ctx) => {
				const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
				const mins = Math.floor(uptimeSec / 60);
				const secs = uptimeSec % 60;
				const mode = this.maintenanceMode ? "⚠️ MAINTENANCE" : "🟢 ACTIVE";
				await ctx.reply.text(`Status: ${mode}\nUptime: ${mins}m ${secs}s`);
			},
		);

		this.command("!uptime", { description: "Show uptime" }, async (ctx) => {
			const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
			await ctx.reply.text(`Uptime: ${uptimeSec}s`);
		});

		this.command(
			"!version",
			{ description: "Show bot version" },
			async (ctx) => {
				await ctx.reply.text(`Version: ${this.options.version || "1.0.0"}`);
			},
		);

		this.command(
			"!help",
			{ description: "Show available commands" },
			async (ctx) => {
				const access = ctx.sender?.isAdmin?.()
					? "admin"
					: ctx.sender?.isModerator?.()
						? "moderator"
						: "everyone";
				const helpText = this.help({ userAccess: access });
				await ctx.reply.markdown(helpText);
			},
		);

		this.command(
			"!maintenance",
			{ access: "admin", description: "Toggle maintenance mode" },
			async (ctx) => {
				const utilityConfig =
					typeof this.options.config?.utility === "object"
						? this.options.config.utility
						: undefined;
				const expectedPw =
					utilityConfig?.maintenancePassword ||
					process.env.MAINTENANCE_PASSWORD;

				if (expectedPw) {
					let promptCtx: any;
					if (typeof ctx.prompt === "function") {
						promptCtx = await ctx.prompt("Enter maintenance password:");
					} else {
						const res = await ctx.prompt.text!("Enter maintenance password:");
						if (res.status === "answered") {
							promptCtx = { message: res.message };
						}
					}

					if (!promptCtx || !promptCtx.message) {
						await ctx.reply.text("Authentication timed out.");
						return;
					}

					const provided = promptCtx.message.body.trim();
					// Redact password immediately
					if (promptCtx.message.redact) {
						await promptCtx.message.redact("Security redaction");
					}

					if (!constantTimeCompare(provided, expectedPw)) {
						await ctx.reply.text("❌ Invalid password.");
						return;
					}
				}

				this.maintenanceMode = !this.maintenanceMode;
				await ctx.reply.text(
					this.maintenanceMode
						? "Maintenance mode is now ON."
						: "Maintenance mode is now OFF.",
				);
			},
		);
	}
}
