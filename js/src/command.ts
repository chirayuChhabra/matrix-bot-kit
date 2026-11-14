import { BotError } from "./errors";
import type {
	AccessLevel,
	CommandGroupOptions,
	CommandHandler,
	CommandOptions,
	Context,
	Middleware,
	Parser,
	RegisteredCommandInfo,
} from "./types";

export interface MatchedCommand {
	command: Command;
	aliasMatched: string;
	args: string;
	groupMiddlewares: Middleware[];
}

export class Command {
	readonly name: string;
	readonly aliases: string[];
	readonly description?: string;
	readonly category?: string;
	readonly access?: AccessLevel;
	readonly roomType?: "direct" | "group" | "all";
	readonly argsParser?: Parser<unknown>;
	readonly middlewares: Middleware[];
	readonly handler: CommandHandler;
	readonly groupName?: string;

	constructor(
		name: string,
		options: CommandOptions<unknown> | undefined,
		middlewares: Middleware[],
		handler: CommandHandler,
		groupName?: string,
	) {
		this.name = name;
		this.aliases = options?.aliases || [];
		this.description = options?.description;
		this.category = options?.category;
		this.access = options?.access;
		this.roomType = options?.roomType;
		this.argsParser = options?.args;
		this.middlewares = middlewares;
		this.handler = handler;
		this.groupName = groupName;
	}

	matches(input: string): { matched: boolean; alias: string; args: string } {
		const trimmed = input.trim();
		const candidates = [this.name, ...this.aliases];

		for (const cand of candidates) {
			const candLower = cand.toLowerCase();
			const inputLower = trimmed.toLowerCase();

			if (inputLower === candLower) {
				return { matched: true, alias: cand, args: "" };
			}

			if (inputLower.startsWith(candLower)) {
				const charAfter = trimmed.charAt(cand.length);
				if (/\s/.test(charAfter)) {
					const args = trimmed.slice(cand.length).trimStart();
					return { matched: true, alias: cand, args };
				}
			}
		}

		return { matched: false, alias: "", args: "" };
	}
}

export class CommandGroup {
	readonly name: string;
	readonly aliases: string[];
	readonly description?: string;
	readonly access?: AccessLevel;
	readonly category?: string;
	readonly roomType?: "direct" | "group" | "all";

	readonly commands = new Map<string, Command>();
	readonly subGroups = new Map<string, CommandGroup>();
	readonly middlewares: Middleware[] = [];
	defaultHandler?: CommandHandler;

	constructor(
		nameOrNamesOrOptions:
			| string
			| string[]
			| { name: string; command?: string; [key: string]: any },
		options?: CommandGroupOptions,
	) {
		if (
			typeof nameOrNamesOrOptions === "object" &&
			!Array.isArray(nameOrNamesOrOptions)
		) {
			this.name = nameOrNamesOrOptions.name;
			this.aliases = nameOrNamesOrOptions.command
				? [nameOrNamesOrOptions.command]
				: [];
			this.description = nameOrNamesOrOptions.description;
			this.access = nameOrNamesOrOptions.access;
			this.category = nameOrNamesOrOptions.category;
			this.roomType = nameOrNamesOrOptions.roomType;
		} else if (Array.isArray(nameOrNamesOrOptions)) {
			if (
				nameOrNamesOrOptions.length === 0 ||
				!nameOrNamesOrOptions[0].trim()
			) {
				throw new Error("Command group name is required");
			}
			this.name = nameOrNamesOrOptions[0].trim();
			this.aliases = [
				...nameOrNamesOrOptions.slice(1),
				...(options?.aliases || []),
			];
			this.description = options?.description;
			this.access = options?.access;
			this.category = options?.category;
			this.roomType = options?.roomType;
		} else {
			if (!nameOrNamesOrOptions || !nameOrNamesOrOptions.trim()) {
				throw new Error("Command group name is required");
			}
			this.name = nameOrNamesOrOptions.trim();
			this.aliases = options?.aliases || [];
			this.description = options?.description;
			this.access = options?.access;
			this.category = options?.category;
			this.roomType = options?.roomType;
		}
	}

	use(...middlewares: Middleware[]): this {
		this.middlewares.push(...middlewares);
		return this;
	}

	default(handler: CommandHandler): this {
		this.defaultHandler = handler;
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

		// Inherit group access if not explicitly overridden
		const mergedAccess = options?.access || this.access;
		const mergedRoomType = options?.roomType || this.roomType;

		const cmd = new Command(
			cleanPrimary,
			{
				...options,
				aliases,
				access: mergedAccess,
				roomType: mergedRoomType,
			},
			middlewares,
			handler,
			this.name,
		);

		if (this.commands.has(cleanPrimary.toLowerCase())) {
			throw new Error(
				`Command '${cleanPrimary}' is already registered in group '${this.name}'`,
			);
		}

		this.commands.set(cleanPrimary.toLowerCase(), cmd);
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

		if (this.subGroups.has(cleanName.toLowerCase())) {
			throw new Error(
				`Subgroup '${cleanName}' is already registered in group '${this.name}'`,
			);
		}

		const mergedAccess = options?.access || this.access;
		const subGroup = new CommandGroup(nameOrNames, {
			...options,
			access: mergedAccess,
		});

		this.subGroups.set(cleanName.toLowerCase(), subGroup);
		return subGroup;
	}

	matchesPrefix(input: string): {
		matched: boolean;
		alias: string;
		remainder: string;
	} {
		const trimmed = input.trim();
		const candidates = [this.name, ...this.aliases];

		for (const cand of candidates) {
			const candLower = cand.toLowerCase();
			const inputLower = trimmed.toLowerCase();

			if (inputLower === candLower) {
				return { matched: true, alias: cand, remainder: "" };
			}

			if (inputLower.startsWith(candLower)) {
				const charAfter = trimmed.charAt(cand.length);
				if (/\s/.test(charAfter)) {
					const remainder = trimmed.slice(cand.length).trimStart();
					return { matched: true, alias: cand, remainder };
				}
			}
		}

		return { matched: false, alias: "", remainder: "" };
	}

	findMatch(
		input: string,
		accumulatedMiddlewares: Middleware[] = [],
	): MatchedCommand | null {
		const prefixCheck = this.matchesPrefix(input);
		if (!prefixCheck.matched) return null;

		const currentMiddlewares = [...accumulatedMiddlewares, ...this.middlewares];
		const remainder = prefixCheck.remainder;

		// 1. Check subgroups
		for (const sub of this.subGroups.values()) {
			const subMatch = sub.findMatch(remainder, currentMiddlewares);
			if (subMatch) return subMatch;
		}

		// 2. Check direct child commands
		for (const cmd of this.commands.values()) {
			const match = cmd.matches(remainder);
			if (match.matched) {
				return {
					command: cmd,
					aliasMatched: `${prefixCheck.alias} ${match.alias}`.trim(),
					args: match.args,
					groupMiddlewares: currentMiddlewares,
				};
			}
		}

		// 3. Fallback to default handler if present
		if (this.defaultHandler) {
			const fallbackCmd = new Command(
				`${this.name} [default]`,
				{ access: this.access, roomType: this.roomType },
				[],
				this.defaultHandler,
				this.name,
			);
			return {
				command: fallbackCmd,
				aliasMatched: prefixCheck.alias,
				args: remainder,
				groupMiddlewares: currentMiddlewares,
			};
		}

		return null;
	}

	getRegisteredCommands(): RegisteredCommandInfo[] {
		const list: RegisteredCommandInfo[] = [];
		for (const cmd of this.commands.values()) {
			list.push({
				name: `${this.name} ${cmd.name}`,
				aliases: cmd.aliases.map((a) => `${this.name} ${a}`),
				description: cmd.description,
				category: cmd.category || this.category,
				access: cmd.access,
				group: this.name,
				roomType: cmd.roomType,
			});
		}
		for (const sub of this.subGroups.values()) {
			list.push(...sub.getRegisteredCommands());
		}
		return list;
	}
}

export async function checkAccess(
	ctx: Context<any>,
	access?: AccessLevel,
): Promise<boolean> {
	if (!access || access === "everyone") return true;
	if (access === "admin") return ctx.sender.isAdmin();
	if (access === "moderator")
		return ctx.sender.isModerator() || ctx.sender.isAdmin();
	if (typeof access === "function") {
		return access(ctx);
	}
	return true;
}
