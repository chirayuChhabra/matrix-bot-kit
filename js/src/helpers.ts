import log from "loglevel";
import { MatrixLogEvent, NormalizedListenerTrigger } from "./types.js";
import { MatrixBot } from "./bot.js";


export function assertPresent(field: string, value: string | string[]): void {
    if (
    	!value ||
    	(typeof value === "string" ? value.trim().length === 0 : value.length === 0)
    ) {
    	throw new Error(`${field} is required`);
    }
}

export function formatInline(value: string): string {
    return `\`${value.replaceAll("`", "\\`")}\``;
}

export function escapeTableCell(value: string): string {
    return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function arrayFromCommand(command?: string | string[]): string[] {
    if (command === undefined) {
    	return [];
    }

    return Array.isArray(command) ? command : [command];
}

export function assertCommands(kind: string, name: string, commands: string[]): void {
    if (commands.length === 0) {
    	throw new Error(`${kind} \`${name}\` requires at least one command`);
    }
}

export function firstSharedValue(left: string[], right: string[]): string | undefined {
    const values = new Set(left);
    return right.find((value) => values.has(value));
}

export function matchesOptionalList<T>(values: readonly T[] | undefined, value: T | undefined): boolean {
    return (
    	values === undefined ||
    	values.length === 0 ||
    	(value !== undefined && values.includes(value))
    );
}

export function arrayFromOptionalValue(value?: string | string[]): string[] | undefined {
    if (value === undefined) {
    	return undefined;
    }

    return Array.isArray(value) ? value : [value];
}

export function defaultLogger(event: MatrixLogEvent): void {
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

export function errorToString(error: unknown): string {
    if (error instanceof Error) {
    	return error.stack ?? error.message;
    }

    return String(error);
}

export function generateBotDocumentation(bot: MatrixBot): string {
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

export function formatCommandList(commands: string[]): string {
    return commands.map(formatInline).join(", ");
}

export function formatListenerTriggers(triggers: NormalizedListenerTrigger[]): string {
    return triggers.map((trigger) => formatInline(trigger.kind)).join(", ");
}
