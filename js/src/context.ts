import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { BotError } from "./errors";
import { getMimeType, markdownToHtml } from "./helpers";
import type {
	Context,
	MediaInput,
	MediaKind,
	MediaOptions,
	MessageContext,
	MessageHandle,
	OutboundPollOptions,
	PromptAction,
	PromptOptions,
	PromptResult,
	RoomContext,
	RoomHandle,
	RoomSender,
	SenderContext,
	SendTextOptions,
	SentMessage,
	SentPoll,
} from "./types";

let eventCounter = 1;
function generateMockEventId(): string {
	return `$mock_event_${Date.now()}_${eventCounter++}`;
}

export class SentMessageImpl implements SentMessage {
	readonly id: string;
	readonly roomId: string;
	private readonly sender: RoomSender;
	private readonly nativeBot?: any;

	constructor(id: string, roomId: string, sender: RoomSender, nativeBot?: any) {
		this.id = id;
		this.roomId = roomId;
		this.sender = sender;
		this.nativeBot = nativeBot;
	}

	get reply(): RoomSender {
		return createBoundSender(this.sender, this.id);
	}

	async react(emoji: string): Promise<SentMessage> {
		if (this.nativeBot?.react) {
			await this.nativeBot.react(this.roomId, this.id, emoji);
		}
		return this;
	}

	async redact(reason?: string): Promise<void> {
		if (this.nativeBot?.redact) {
			await this.nativeBot.redact(this.roomId, this.id, reason);
		}
	}

	async edit(newText: string): Promise<SentMessage> {
		// In Matrix, an edit sends a replacement event
		return this.sender.text(newText);
	}

	// Chaining support
	text(body: string, options?: SendTextOptions): Promise<SentMessage> {
		return this.sender.text(body, options);
	}

	message(body: string, options?: SendTextOptions): Promise<SentMessage> {
		return this.sender.text(body, options);
	}

	markdown(body: string, options?: SendTextOptions): Promise<SentMessage> {
		return this.sender.markdown(body, options);
	}

	toString(): string {
		return this.id;
	}

	valueOf(): string {
		return this.id;
	}
}

export class SentPollImpl extends SentMessageImpl implements SentPoll {
	readonly tag?: string;

	constructor(
		id: string,
		roomId: string,
		sender: RoomSender,
		tag?: string,
		nativeBot?: any,
	) {
		super(id, roomId, sender, nativeBot);
		this.tag = tag;
	}

	async close(summary?: string): Promise<void> {
		const native = (this as any).nativeBot;
		if (native?.closePoll) {
			await native.closePoll(this.roomId, this.id, summary);
		}
	}
}

function createBoundSender(
	baseSender: RoomSender,
	replyToEventId: string,
): RoomSender {
	return {
		text: (body, options) => {
			return baseSender.text(body, { ...options });
		},
		message: (body, options) => {
			return baseSender.text(body, { ...options });
		},
		markdown: (body, options) => {
			return baseSender.markdown(body, { ...options });
		},
		notice: (body, options) => {
			return baseSender.notice(body, { ...options });
		},
		image: (input, options) => baseSender.image(input, options),
		file: (input, options) => baseSender.file(input, options),
		audio: (input, options) => baseSender.audio(input, options),
		video: (input, options) => baseSender.video(input, options),
		poll: (options) => baseSender.poll(options),
		media: (kind, input, options) => baseSender.media(kind, input, options),
	};
}

export function createRoomSender(
	roomId: string,
	nativeBot?: any,
	replyToEventId?: string,
): RoomSender {
	const sender: RoomSender = {
		async text(body: string, _options?: SendTextOptions): Promise<SentMessage> {
			let id: string | undefined;
			if (replyToEventId && nativeBot?.replyText) {
				await nativeBot.replyText(roomId, replyToEventId, body);
			} else if (nativeBot?.sendText) {
				await nativeBot.sendText(roomId, body);
			}
			id = id || generateMockEventId();
			return new SentMessageImpl(id, roomId, sender, nativeBot);
		},

		async message(
			body: string,
			options?: SendTextOptions,
		): Promise<SentMessage> {
			return sender.text(body, options);
		},

		async markdown(
			body: string,
			_options?: SendTextOptions,
		): Promise<SentMessage> {
			let id: string | undefined;
			if (replyToEventId && nativeBot?.replyMarkdown) {
				await nativeBot.replyMarkdown(roomId, replyToEventId, body);
			} else if (nativeBot?.sendMarkdown) {
				await nativeBot.sendMarkdown(roomId, body);
			}
			id = id || generateMockEventId();
			return new SentMessageImpl(id, roomId, sender, nativeBot);
		},

		async notice(
			body: string,
			options?: SendTextOptions,
		): Promise<SentMessage> {
			return sender.text(body, { ...options, kind: "notice" });
		},

		async image(
			input: MediaInput | string,
			options?: MediaOptions,
		): Promise<SentMessage> {
			return sender.media("image", input, options);
		},

		async file(
			input: MediaInput | string,
			options?: MediaOptions,
		): Promise<SentMessage> {
			return sender.media("file", input, options);
		},

		async audio(
			input: MediaInput | string,
			options?: MediaOptions,
		): Promise<SentMessage> {
			return sender.media("audio", input, options);
		},

		async video(
			input: MediaInput | string,
			options?: MediaOptions,
		): Promise<SentMessage> {
			return sender.media("video", input, options);
		},

		async media(
			kind: MediaKind,
			input: MediaInput | string,
			options?: MediaOptions,
		): Promise<SentMessage> {
			let buffer: Buffer | Uint8Array;
			let filename: string;
			let contentType: string;

			if (typeof input === "string") {
				filename = options?.filename || basename(input);
				contentType = options?.contentType || getMimeType(filename);
				buffer = await readFile(input);
			} else if ("path" in input) {
				filename = input.filename || options?.filename || basename(input.path);
				contentType =
					input.contentType || options?.contentType || getMimeType(filename);
				buffer = await readFile(input.path);
			} else {
				filename = input.filename || options?.filename || "file.bin";
				contentType =
					input.contentType || options?.contentType || getMimeType(filename);
				buffer = input.data;
			}

			if (nativeBot) {
				const attachment = { filename, contentType, data: buffer };
				if (kind === "image" && nativeBot.sendImage) {
					await nativeBot.sendImage(roomId, attachment);
				} else if (kind === "video" && nativeBot.sendVideo) {
					await nativeBot.sendVideo(roomId, attachment);
				} else if (nativeBot.sendFile) {
					await nativeBot.sendFile(roomId, attachment);
				}
			}

			const id = generateMockEventId();
			return new SentMessageImpl(id, roomId, sender, nativeBot);
		},

		async poll(options: OutboundPollOptions): Promise<SentPoll> {
			let id: string | undefined;
			const answers = options.answers.map((ans, idx) => {
				if (typeof ans === "string") {
					return { id: String(idx), text: ans };
				}
				return ans;
			});

			if (nativeBot?.sendPoll) {
				id = await nativeBot.sendPoll(roomId, {
					question: options.question,
					answers,
					kind: options.visibility || "disclosed",
					maxSelections: options.maxSelections || 1,
				});
			}

			id = id || generateMockEventId();
			return new SentPollImpl(id, roomId, sender, options.tag, nativeBot);
		},
	};

	return sender;
}

export function createMessageHandle(
	roomId: string,
	eventId: string,
	nativeBot?: any,
): MessageHandle {
	const sender = createRoomSender(roomId, nativeBot);
	return {
		id: eventId,
		roomId,
		async react(emoji: string) {
			if (nativeBot?.react) {
				await nativeBot.react(roomId, eventId, emoji);
			}
			return new SentMessageImpl(eventId, roomId, sender, nativeBot);
		},
		async redact(reason?: string) {
			if (nativeBot?.redact) {
				await nativeBot.redact(roomId, eventId, reason);
			}
		},
		reply: createRoomSender(roomId, nativeBot, eventId),
	};
}

export function createRoomHandle(roomId: string, nativeBot?: any): RoomHandle {
	return {
		roomId,
		send: createRoomSender(roomId, nativeBot),
		message: (eventId: string) =>
			createMessageHandle(roomId, eventId, nativeBot),
	};
}

export interface PendingPrompt {
	key: string;
	resolve: (result: PromptResult) => void;
	reject: (err: any) => void;
	timer: NodeJS.Timeout;
}

export class PromptManager {
	private waiters = new Map<string, PendingPrompt>();

	private makeKey(roomId?: string, senderId?: string): string {
		return `${roomId || ""}:${senderId || ""}`;
	}

	register(
		roomId: string,
		senderId: string,
		options?: PromptOptions,
	): Promise<PromptResult> {
		const key = this.makeKey(roomId, senderId);
		const existing = this.waiters.get(key);
		if (existing) {
			clearTimeout(existing.timer);
			existing.resolve({ status: "cancelled" });
			this.waiters.delete(key);
		}

		const timeoutMs = options?.timeoutMs ?? 60_000;
		return new Promise<PromptResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiters.delete(key);
				resolve({ status: "timeout" });
			}, timeoutMs);

			if (options?.signal) {
				options.signal.addEventListener("abort", () => {
					clearTimeout(timer);
					this.waiters.delete(key);
					resolve({ status: "cancelled" });
				});
			}

			this.waiters.set(key, { key, resolve, reject, timer });
		});
	}

	resolveAnswer(
		roomId: string,
		senderId: string,
		message: MessageContext,
	): boolean {
		const key = this.makeKey(roomId, senderId);
		const waiter = this.waiters.get(key);
		if (!waiter) return false;

		clearTimeout(waiter.timer);
		this.waiters.delete(key);
		waiter.resolve({
			status: "answered",
			text: message.body,
			message,
		});
		return true;
	}

	clear(): void {
		for (const waiter of this.waiters.values()) {
			clearTimeout(waiter.timer);
			waiter.resolve({ status: "cancelled" });
		}
		this.waiters.clear();
	}
}
