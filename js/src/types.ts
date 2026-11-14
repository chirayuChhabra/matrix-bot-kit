import type { BotError } from "./errors";
import type { MatrixMessageType } from "./native";

export type { MatrixMessageType };

export type BotStatus =
	| "idle"
	| "starting"
	| "running"
	| "stopping"
	| "stopped"
	| "failed";

export type MatrixAuthOptions =
	| {
			type?: "password";
			username: string;
			password: string;
	  }
	| {
			type: "token";
			accessToken: string;
			userId: string;
			deviceId?: string;
	  };

export interface MatrixBotOptions {
	/** Matrix homeserver URL (e.g. "https://matrix.org"). Required. */
	homeserverUrl: string;

	/** Authentication configuration. Accepts password or access token credentials. */
	auth?: MatrixAuthOptions;

	/** Shortcut for auth.username (when using password auth). */
	username?: string;

	/** Shortcut for auth.password (when using password auth). */
	password?: string;

	/** Recovery key or encryption configuration for End-to-End Encryption. Optional. */
	encryption?: { recoveryKey?: string } | boolean;

	/** Shortcut for encryption.recoveryKey. */
	recoveryKey?: string;

	/** User IDs with administrative privileges. Optional, defaults to empty array. */
	admins?: string[];

	/** Backwards-compatible alias for admins. */
	admin?: string[];

	/** User IDs with moderator privileges. Optional, defaults to empty array. */
	moderators?: string[];

	/** Backwards-compatible alias for moderators. */
	moderator?: string[];

	/** Local directory to store crypto database and state. Defaults to "./.matrix-bot-kit". */
	storage?: { directory?: string };

	/** Backwards-compatible alias for storage.directory. */
	dataDir?: string;

	/** Additional runtime configuration. */
	config?: MatrixBotRuntimeConfig;

	/** Custom logger function or object. */
	logger?: MatrixLogger;

	/** Global error handler for uncaught exceptions in handlers. */
	onError?: MatrixErrorHandler;

	/** Initial timeline message limit on sync. */
	timelineLimit?: number;

	/** Bot version string, shown in utility commands or help. */
	version?: string;

	/** Invitation policy: "reject" (default), "trusted" (only admins/moderators), "all" (auto-accept). */
	invitations?: "reject" | "trusted" | "all";
}

export interface MatrixBotRuntimeConfig {
	announceCommandGroupUsage?: boolean;
	selfDocumentation?: boolean;
	documentationPath?: string;
	utility?: boolean | { enabled?: boolean; maintenancePassword?: string };
}

export type MatrixLogger = {
	debug?: (...args: unknown[]) => void;
	info?: (...args: unknown[]) => void;
	warn?: (...args: unknown[]) => void;
	error?: (...args: unknown[]) => void;
};

export type MatrixErrorContext = {
	error: unknown;
	phase: "startup" | "dispatch" | "listener" | "schedule" | "runtime";
	ctx?: Context;
};

export type MatrixErrorHandler = (
	errorContext: MatrixErrorContext,
) => void | Promise<void>;

export type AccessLevel =
	| "everyone"
	| "moderator"
	| "admin"
	| ((ctx: Context<any>) => boolean | Promise<boolean>);

export type Parser<T = unknown> =
	| { parse: (input: unknown) => T }
	| ((input: string) => T);

export interface CommandOptions<T = unknown> {
	description?: string;
	aliases?: string[];
	access?: AccessLevel;
	category?: string;
	roomType?: "direct" | "group" | "all";
	args?: Parser<T>;
}

export interface CommandGroupOptions {
	description?: string;
	aliases?: string[];
	access?: AccessLevel;
	category?: string;
	roomType?: "direct" | "group" | "all";
	command?: string;
}

export type Middleware<TContext = Context<any>> = (
	ctx: TContext,
	next: () => Promise<void>,
) => Promise<void> | void;

export type CommandHandler<TContext = Context<any>> = (
	ctx: TContext,
) => Promise<void> | void;

export type MediaKind = "image" | "file" | "video" | "audio";

export type MediaInput =
	| {
			path: string;
			filename?: string;
			contentType?: string;
			caption?: string;
	  }
	| {
			data: Buffer | Uint8Array;
			filename: string;
			contentType?: string;
			caption?: string;
	  };

export interface MediaOptions {
	filename?: string;
	contentType?: string;
	caption?: string;
}

export interface SendTextOptions {
	thread?: string;
	kind?: "notice" | "message";
}

export type OutboundPollAnswer = string | { id: string; text: string };

export interface OutboundPollOptions {
	question: string;
	answers: OutboundPollAnswer[];
	tag?: string;
	maxSelections?: number;
	visibility?: "disclosed" | "undisclosed" | "afterClose";
}

export interface SentMessage {
	id: string;
	roomId: string;
	react: (emoji: string) => Promise<SentMessage>;
	redact: (reason?: string) => Promise<void>;
	edit: (newText: string) => Promise<SentMessage>;
	reply: RoomSender;
}

export interface SentPoll extends SentMessage {
	tag?: string;
	close: (summary?: string) => Promise<void>;
}

export interface RoomSender {
	text: (body: string, options?: SendTextOptions) => Promise<SentMessage>;
	markdown: (body: string, options?: SendTextOptions) => Promise<SentMessage>;
	notice: (body: string, options?: SendTextOptions) => Promise<SentMessage>;
	image: (
		input: MediaInput | string,
		options?: MediaOptions,
	) => Promise<SentMessage>;
	file: (
		input: MediaInput | string,
		options?: MediaOptions,
	) => Promise<SentMessage>;
	audio: (
		input: MediaInput | string,
		options?: MediaOptions,
	) => Promise<SentMessage>;
	video: (
		input: MediaInput | string,
		options?: MediaOptions,
	) => Promise<SentMessage>;
	poll: (options: OutboundPollOptions) => Promise<SentPoll>;
	/** Alias for text() for backwards compatibility. */
	message: (body: string, options?: SendTextOptions) => Promise<SentMessage>;
	/** Generic media sender. */
	media: (
		kind: MediaKind,
		input: MediaInput | string,
		options?: MediaOptions,
	) => Promise<SentMessage>;
}

export interface MessageHandle {
	id: string;
	roomId: string;
	react: (emoji: string) => Promise<SentMessage>;
	redact: (reason?: string) => Promise<void>;
	reply: RoomSender;
}

export interface RoomHandle {
	roomId: string;
	send: RoomSender;
	message: (eventId: string) => MessageHandle;
}

export type PromptResult =
	| {
			status: "answered";
			text: string;
			message: MessageContext;
	  }
	| {
			status: "timeout";
	  }
	| {
			status: "cancelled";
	  };

export interface PromptOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
	cancelOnCommand?: boolean;
}

export type PromptAction = {
	(text: string): Promise<Context<any>>;
	text?: (question: string, options?: PromptOptions) => Promise<PromptResult>;
};

export interface MessageMedia {
	kind: MediaKind;
	filename: string;
	contentType?: string;
	size?: number;
	width?: number;
	height?: number;
	mxcUri?: string;
	encrypted?: boolean;
	download: (options?: { maxBytes?: number }) => Promise<Buffer>;
}

export interface MessageContext {
	id: string;
	type: MatrixMessageType;
	body: string;
	rawBody: string;
	media?: MessageMedia;
	poll?: {
		question: string;
		kind: string;
		maxSelections: number;
		answers: Array<{ id: string; text: string }>;
	};
	pollResponse?: {
		pollEventId: string;
		selections: string[];
	};
	pollEnd?: {
		pollEventId: string;
		text: string;
	};
	replyTo?: MessageHandle;
	react: (emoji: string) => Promise<SentMessage>;
	redact: (reason?: string) => Promise<void>;
}

export interface RoomContext {
	id: string;
	isDirect: boolean;
}

export interface SenderContext {
	id: string;
	userId: string;
	mention: string;
	isAdmin: () => boolean;
	isModerator: () => boolean;
}

export interface Context<TSession = Record<string, any>> {
	message: MessageContext;
	room: RoomContext;
	sender: SenderContext;
	send: RoomSender;
	reply: RoomSender;
	args: string;
	command?: {
		name: string;
		alias: string;
		input: string;
	};
	input?: unknown;
	session: TSession;
	prompt: PromptAction;
	bot: any;
	signal?: AbortSignal;
	state: Record<string, unknown>;
	downloadMedia: (options?: { maxBytes?: number }) => Promise<Buffer>;
}

export interface ScheduleOptions {
	every?: {
		seconds?: number;
		minutes?: number;
		hours?: number;
		days?: number;
	};
	everyMs?: number;
	everySec?: number;
	everyMin?: number;
	everyHr?: number;
	everyDay?: number;
	at?: Date;
	overlap?: "skip" | "allow";
}

export interface ScheduleContext {
	name: string;
	bot: any;
	timestamp: Date;
}

export interface ExternalEventContext<TPayload = unknown> {
	source: string;
	event: string;
	payload: TPayload;
	bot: any;
	timestamp: Date;
}

export type BotModule =
	| {
			name: string;
			setup: (bot: any) => void | Promise<void | (() => void | Promise<void>)>;
	  }
	| ((bot: any) => void | Promise<void>);

export interface EventFilterOptions {
	rooms?: string[];
	senders?: string[];
	tag?: string;
	actionId?: string;
	types?: MatrixMessageType[];
}

export interface RegisteredCommandInfo {
	name: string;
	aliases: string[];
	description?: string;
	category?: string;
	access?: AccessLevel;
	group?: string;
	roomType?: "direct" | "group" | "all";
}

// Legacy compatibility types
export interface SendContext extends Promise<string | undefined> {
	message: (body: string) => SendContext;
	text: (body: string) => SendContext;
	markdown: (body: string) => SendContext;
	media: (kind: MediaKind, attachment: any) => SendContext;
	image: (attachment: any) => SendContext;
	file: (attachment: any) => SendContext;
	video: (attachment: any) => SendContext;
	poll: (poll: any) => SendContext;
}

export interface ReplyContext extends Promise<void> {
	message: (body: string) => ReplyContext;
	text: (body: string) => ReplyContext;
	markdown: (body: string) => ReplyContext;
}

export type MediaAttachment = {
	filename: string;
	data: Buffer | Uint8Array;
	contentType?: string;
	caption?: string;
};

export type OutboundPoll = {
	question: string;
	answers: string[] | Array<{ id: string; text: string }>;
	kind?: string;
	maxSelections?: number;
};
