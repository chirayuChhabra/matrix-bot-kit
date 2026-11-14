import type {
	Context,
	EventFilterOptions,
	ExternalEventContext,
	MatrixMessageType,
	ScheduleContext,
	ScheduleOptions,
} from "./types";

export type ListenerHandler = (
	ctxOrEvent: any,
	actionsOrUndef?: any,
) => Promise<void> | void;

export interface RegisteredListener {
	id: string;
	kind: string;
	filter?: EventFilterOptions;
	handler: ListenerHandler;
	dispose: () => void;
}

let listenerIdCounter = 1;

export class ListenerRegistry {
	readonly listeners: RegisteredListener[] = [];
	private bot: any;

	constructor(bot: any) {
		this.bot = bot;
	}

	private addListener(
		kind: string,
		filterOrHandler: EventFilterOptions | ListenerHandler | undefined,
		maybeHandler?: ListenerHandler,
	): { dispose: () => void } {
		let filter: EventFilterOptions | undefined;
		let handler: ListenerHandler;

		if (typeof filterOrHandler === "function") {
			handler = filterOrHandler;
		} else {
			filter = filterOrHandler;
			if (!maybeHandler) {
				throw new Error("Listener handler function is required");
			}
			handler = maybeHandler;
		}

		const id = `listener_${listenerIdCounter++}`;
		const entry: RegisteredListener = {
			id,
			kind,
			filter,
			handler,
			dispose: () => {
				const idx = this.listeners.findIndex((l) => l.id === id);
				if (idx !== -1) {
					this.listeners.splice(idx, 1);
				}
			},
		};

		this.listeners.push(entry);
		return { dispose: entry.dispose };
	}

	message(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.message", filterOrHandler, handler);
	}

	text(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.text", filterOrHandler, handler);
	}

	image(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.image", filterOrHandler, handler);
	}

	file(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.file", filterOrHandler, handler);
	}

	audio(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.audio", filterOrHandler, handler);
	}

	video(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.video", filterOrHandler, handler);
	}

	poll(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.poll", filterOrHandler, handler);
	}

	pollVote(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.poll_response", filterOrHandler, handler);
	}

	reaction(
		filterOrHandler?: EventFilterOptions | ListenerHandler,
		handler?: ListenerHandler,
	): { dispose: () => void } {
		return this.addListener("matrix.reaction", filterOrHandler, handler);
	}

	schedule(
		options: ScheduleOptions,
		handler: (ctx: ScheduleContext) => Promise<void> | void,
	): { dispose: () => void } {
		return this.bot.schedule(`schedule_${Date.now()}`, options, handler);
	}

	external<TPayload = unknown>(
		optionsOrHandler:
			| { source?: string; event?: string }
			| ((ctx: ExternalEventContext<TPayload>) => Promise<void> | void),
		maybeHandler?: (
			ctx: ExternalEventContext<TPayload>,
		) => Promise<void> | void,
	): { dispose: () => void } {
		let filter: any;
		let handler: any;
		if (typeof optionsOrHandler === "function") {
			handler = optionsOrHandler;
		} else {
			filter = optionsOrHandler;
			handler = maybeHandler!;
		}
		return this.addListener("external", filter, handler);
	}

	matchesFilter(
		listener: RegisteredListener,
		ctx: Context,
		messageType?: MatrixMessageType,
	): boolean {
		const filter = listener.filter;
		if (!filter) return true;

		// Room filtering
		if (filter.rooms !== undefined) {
			if (filter.rooms.length === 0) return false;
			if (!filter.rooms.includes(ctx.room?.id)) return false;
		}

		// Sender filtering
		if (filter.senders !== undefined) {
			if (filter.senders.length === 0) return false;
			if (!filter.senders.includes(ctx.sender?.id)) return false;
		}

		// Message type filtering
		if (filter.types !== undefined && messageType) {
			if (filter.types.length === 0) return false;
			if (!filter.types.includes(messageType)) return false;
		}

		// Poll tag / actionId filtering
		const tag = filter.tag || filter.actionId;
		if (tag !== undefined) {
			const pollRespTag =
				(ctx.message as any)?.pollResponse?.actionId ||
				(ctx.message as any)?.pollResponse?.tag;
			const msgTag =
				(ctx.message as any)?.pollTag ||
				(ctx.message as any)?.tag ||
				pollRespTag;
			if (msgTag !== tag) return false;
		}

		return true;
	}

	async dispatch(
		eventKind: string,
		context: Context,
		messageType?: MatrixMessageType,
		legacyEvent?: any,
		legacyActions?: any,
	): Promise<number> {
		const effectiveType = messageType || context.message?.type;
		const matching = this.listeners.filter((l) => {
			const matchesKind =
				l.kind === eventKind ||
				l.kind === "matrix.message" ||
				(effectiveType && l.kind === `matrix.${effectiveType}`);
			if (!matchesKind) {
				return false;
			}
			return this.matchesFilter(l, context, effectiveType);
		});

		for (const listener of matching) {
			try {
				if (listener.handler.length >= 2 && legacyEvent) {
					// Legacy signature: (event, actions)
					await listener.handler(legacyEvent, legacyActions);
				} else {
					// Modern signature: (ctx)
					await listener.handler(context);
				}
			} catch (err) {
				if (this.bot?.handleError) {
					await this.bot.handleError(err, "listener", context);
				}
			}
		}

		return matching.length;
	}
}
