import { CommandConfig, CommandGroupConfig, CommandGroupOptions, CommandOptions, Context, Handler, Middleware } from "./types.js";
import { arrayFromCommand, assertCommands, assertPresent, firstSharedValue } from "./helpers";
import { createPipeline } from "./pipeline";
import { nativeBinding } from "./constants.js";
import { runPipeline } from "./pipeline.js";

/**
 * Represents a group of commands. Command groups can have their own middleware
 * and can act as sub-bots by mounting child commands.
 */
export class CommandGroup<TConfig extends CommandGroupConfig = CommandGroupConfig> {
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
        this.commands = normalizeCommands(options.command);
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

    command(match: string | string[], ...pipeline: [...Middleware[], Handler]): this {
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
        this.commands = normalizeCommands(options.command);
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

export function normalizeCommands(command: string | string[]): string[] {
    const values = arrayFromCommand(command)
        		.map((value) => value.trim())
        		.filter(Boolean);
    return [...new Set(values)];
}

export function scopeByCommand(ctx: Context, commands: string[]): Context | undefined {
    const remainder = commandRemainder(ctx.message.body, commands);
    if (remainder === undefined) {
    	return undefined;
    }

    return { ...ctx, message: { ...ctx.message, body: remainder } };
}

export function commandRemainder(body: string, commands: string[]): string | undefined {
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
