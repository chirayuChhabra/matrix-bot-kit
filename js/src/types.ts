import type { MatrixBot } from "./bot.js";
import { MatrixMessageType } from "./native.js";

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
/**
 * Configuration options for built-in utility commands.
 */
export type UtilityConfig = {
    	/**
    	 * Whether utility commands (!ping, !status, !maintenance, etc.) should be enabled.
    	 * Defaults to true.
    	 */
    	enabled?: boolean;
    	/**
    	 * The password required to trigger maintenance mode or shutdown the bot.
    	 */
    	maintenancePassword: string;
    };
/**
 * Additional runtime configuration for the bot.
 */
export type MatrixBotRuntimeConfig = {
    	/** Whether to announce when a command group is matched but no child command matches. */
    	announceCommandGroupUsage?: boolean;
    	/** Whether to enable the built-in !help command. */
    	selfDocumentation?: boolean;
    	/** Custom path to markdown documentation to serve or reference. */
    	documentationPath?: string;
    	/** Configuration for built-in utility commands. */
    	utility?: UtilityConfig;
    };
export type ResolvedMatrixBotRuntimeConfig = {
    	announceCommandGroupUsage: boolean;
    	selfDocumentation: boolean;
    	documentationPath: string;
    	utility: UtilityConfig;
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
    	everySec?: number;
    	everyMin?: number;
    	everyHr?: number;
    	everyDay?: number;
    	at?: Date | string;
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
export type MediaDownloadTarget = | string
    	| {
    			roomId?: string;
    			eventId?: string;
    	  };
export type MediaKind = "image" | "file" | "video" | "audio";
export type MediaAttachment = | string
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
    	kind: "disclosed" | "undisclosed";
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
    	everySec?: number;
    	everyMin?: number;
    	everyHr?: number;
    	everyDay?: number;
    	at?: Date | string;
    	source?: string;
    };
export type ListenerTrigger = | "matrix.message"
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
export type CommandGroupOptions<TConfig extends CommandGroupConfig = CommandGroupConfig> = {
    	name: string;
    	command: string | string[];
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
    	description?: string;
    	adminOnly?: boolean;
    	moderatorOnly?: boolean;
    	roomType?: "direct" | "any";
    	config?: TConfig;
    };
export type MatrixBotModule = (bot: MatrixBot) => void;
export type NormalizedListenerMatrixMessageTrigger = {
    	kind: "matrix.message";
    	messageTypes?: MatrixMessageType[];
    	rooms?: string[];
    	senders?: string[];
    };
export type NormalizedListenerExternalTrigger = {
    	kind: "external";
    	source?: string[];
    	event?: string[];
    };
export type NormalizedListenerScheduleTrigger = {
    	kind: "schedule";
    	everyMs?: number;
    	at?: Date | string;
    	source: string;
    };
export type NormalizedListenerTrigger = | NormalizedListenerMatrixMessageTrigger
    	| NormalizedListenerExternalTrigger
    	| NormalizedListenerScheduleTrigger;
