import { createRequire } from "node:module";

type NativeMatrixBot = {
	start(
		onMessage: (message: NativeIncomingMessage) => void,
		onLog: (event: NativeRuntimeLog) => void,
		onReady: () => void,
	): void;
	sendText(roomId: string, body: string): Promise<void>;
	sendMarkdown(roomId: string, body: string): Promise<void>;
	sendImage(roomId: string, attachment: NativeMediaAttachment): Promise<void>;
	sendFile(roomId: string, attachment: NativeMediaAttachment): Promise<void>;
	sendVideo(roomId: string, attachment: NativeMediaAttachment): Promise<void>;
	sendPoll(roomId: string, poll: NativePoll): Promise<string>;
	closePoll(
		roomId: string,
		pollEventId: string,
		fallbackText?: string,
	): Promise<void>;
	replyText(roomId: string, eventId: string, body: string): Promise<void>;
	replyMarkdown(roomId: string, eventId: string, body: string): Promise<void>;
	react(roomId: string, eventId: string, emoji: string): Promise<void>;
	redact(roomId: string, eventId: string, reason?: string): Promise<void>;
	downloadMedia(roomId: string, eventId: string): Promise<Buffer>;
	registerCommandGroup(commandGroup: NativeCommandGroup): void;
	registerListener?(listener: NativeListener): void;
	commandGroupCount: number;
	listenerCount: number;
};

type NativeCommandGroup = {
	name: string;
};

type NativeListener = {
	name: string;
};

export type NativeListenerMatrixMessageTrigger = {
	messageTypes?: MatrixMessageType[];
};

export type NativeIncomingMessage = {
	eventId: string;
	roomId: string;
	sender: string;
	messageType: MatrixMessageType;
	body: string;
	media?: NativeMediaMessage;
	poll?: NativePollMessage;
	pollResponse?: NativePollResponseMessage;
	pollEnd?: NativePollEndMessage;
	repliedMessage?: {
		eventId: string;
		sender: string;
		messageType: MatrixMessageType;
		body: string;
		media?: NativeMediaMessage;
	};
	replyUnsupported: boolean;
	isDirect: boolean;
};

export type NativeRuntimeLog = {
	level: "debug" | "info" | "warn" | "error";
	message: string;
};

export type MatrixMessageType =
	| "text"
	| "notice"
	| "server_notice"
	| "image"
	| "file"
	| "video"
	| "poll"
	| "poll_response"
	| "poll_end";

export type NativeMediaMessage = {
	kind: "image" | "file" | "video";
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

export type NativePollMessage = {
	question: string;
	kind: string;
	maxSelections: number;
	answers: NativePollAnswer[];
};

export type NativePollAnswer = {
	id: string;
	text: string;
};

export type NativeMediaAttachment = {
	filename: string;
	contentType: string;
	data: Buffer | Uint8Array;
};

export type NativePoll = {
	question: string;
	answers: NativePollAnswer[];
	kind?: string;
	maxSelections?: number;
};

export type NativePollResponseMessage = {
	pollEventId: string;
	selections: string[];
};

export type NativePollEndMessage = {
	pollEventId: string;
	text: string;
};

export type NativeBinding = {
	MatrixBot: new (options: {
		homeserverUrl: string;
		username: string;
		password: string;
		recoveryKey: string;
		dataDir?: string;
		admin: string[];
		moderator?: string[];
		timeline_limit?: number;
	}) => NativeMatrixBot;
	CommandGroup: new (name: string, commands?: string[]) => NativeCommandGroup;
	Listener?: new (
		name: string,
		matrixMessageTriggers?: NativeListenerMatrixMessageTrigger[],
	) => NativeListener;
};

export function loadNativeBinding(): NativeBinding | undefined {
	try {
		const isCJS = typeof __filename !== "undefined";
		const require = isCJS
			? createRequire(__filename)
			: createRequire(import.meta.url);
		return require("../native/matrix_bot_node.node") as NativeBinding;
	} catch {
		try {
			const isCJS = typeof __filename !== "undefined";
			const require = isCJS
				? createRequire(__filename)
				: createRequire(import.meta.url);
			const { platform, arch } = process;
			let pkgName = "";
			if (platform === "darwin" && arch === "arm64")
				pkgName = "matrix-bot-kit-darwin-arm64";
			else if (platform === "darwin" && arch === "x64")
				pkgName = "matrix-bot-kit-darwin-x64";
			else if (platform === "win32" && arch === "x64")
				pkgName = "matrix-bot-kit-win32-x64-msvc";
			else if (platform === "win32" && arch === "arm64")
				pkgName = "matrix-bot-kit-win32-arm64-msvc";
			else if (platform === "linux" && arch === "x64")
				pkgName = "matrix-bot-kit-linux-x64-gnu";
			else if (platform === "linux" && arch === "arm64")
				pkgName = "matrix-bot-kit-linux-arm64-gnu";

			if (pkgName) {
				return require(pkgName) as NativeBinding;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}
}
