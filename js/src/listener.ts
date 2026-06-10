import { Context, ListenerActions, ListenerConfig, ListenerEvent, ListenerHandler, ListenerMiddleware, ListenerOptions, ListenerTrigger } from "./types.js";
import { arrayFromOptionalValue, assertPresent, matchesOptionalList } from "./helpers";
import { NativeListenerMatrixMessageTrigger } from "./native";
import { createListenerPipeline } from "./pipeline";
import { NormalizedListenerMatrixMessageTrigger, NormalizedListenerScheduleTrigger, NormalizedListenerTrigger } from "./types";
import { nativeBinding } from "./constants.js";
import { runListenerPipeline } from "./pipeline.js";

/**
 * Represents a listener that responds to specific events, such as incoming messages,
 * scheduled triggers, or external webhooks.
 */
export class Listener<TConfig extends ListenerConfig = ListenerConfig> {
    readonly name: string;
    readonly description?: string;
    readonly triggers: NormalizedListenerTrigger[];
    readonly config: TConfig;
    readonly native;
    private pipeline?: {
        	middleware: ListenerMiddleware[];
        	handler: ListenerHandler;
        };

    constructor(options: ListenerOptions<TConfig>) {
        assertPresent("name", options.name);
        this.name = options.name;
        this.description = options.description;
        this.triggers = normalizeListenerTriggers(options.triggers);
        this.config = (options.config ?? {}) as TConfig;
        this.native = nativeBinding?.Listener
        ? new nativeBinding.Listener(
        		this.name,
        		nativeListenerMatrixMessageTriggers(this.triggers),
        	)
        : undefined;
    }

    use(...pipeline: [...ListenerMiddleware[], ListenerHandler]): this {
        this.pipeline = createListenerPipeline(pipeline);
        return this;
    }

    async dispatch(event: ListenerEvent, actions: ListenerActions): Promise<number> {
        if (!this.pipeline || !this.matches(event)) {
        	return 0;
        }

        await runListenerPipeline(
        	event,
        	actions,
        	this.pipeline.middleware,
        	this.pipeline.handler,
        );
        return 1;
    }

    matches(event: ListenerEvent): boolean {
        return this.triggers.some((trigger) =>
        	listenerTriggerMatches(trigger, event),
        );
    }

    scheduleTriggers(): NormalizedListenerScheduleTrigger[] {
        return this.triggers.filter(
        	(trigger): trigger is NormalizedListenerScheduleTrigger =>
        		trigger.kind === "schedule",
        );
    }
}

export function normalizeListenerTriggers(triggers: ListenerTrigger[] = ["matrix.message"]): NormalizedListenerTrigger[] {
    return triggers.map((trigger) => {
    	if (trigger === "matrix.message") {
    		return { kind: "matrix.message" };
    	}

    	if (trigger.kind === "external") {
    		return {
    			...trigger,
    			source: arrayFromOptionalValue(trigger.source),
    			event: arrayFromOptionalValue(trigger.event),
    		};
    	}

    	if (trigger.kind === "schedule") {
    		let everyMs: number | undefined = undefined;
    		let definedCount = 0;

    		if (trigger.everyDay !== undefined) { everyMs = trigger.everyDay * 24 * 60 * 60 * 1000; definedCount++; }
    		if (trigger.everyHr !== undefined) { everyMs = trigger.everyHr * 60 * 60 * 1000; definedCount++; }
    		if (trigger.everyMin !== undefined) { everyMs = trigger.everyMin * 60 * 1000; definedCount++; }
    		if (trigger.everySec !== undefined) { everyMs = trigger.everySec * 1000; definedCount++; }

    		if (definedCount > 1) {
    			throw new Error("schedule listener trigger can only use one interval type (e.g. use only everyMin, not both everyMin and everySec)");
    		}

    		if (everyMs === undefined && trigger.at === undefined) {
    			throw new Error("schedule listener trigger requires an interval (everySec, everyMin, etc.) or `at`");
    		}
    		if (everyMs !== undefined && everyMs < 1000) {
    			throw new Error(
    				"schedule listener trigger interval must be at least 1 second",
    			);
    		}

    		return {
    			kind: "schedule",
    			everyMs,
    			at: trigger.at,
    			source: trigger.source ?? "schedule",
    		};
    	}

    	return trigger;
    });
}

export function nativeListenerMatrixMessageTriggers(triggers: NormalizedListenerTrigger[]): NativeListenerMatrixMessageTrigger[] {
    return triggers
    .filter(
    	(trigger): trigger is NormalizedListenerMatrixMessageTrigger =>
    		trigger.kind === "matrix.message",
    )
    .map((trigger) => ({
    	messageTypes: trigger.messageTypes,
    }));
}

export function listenerTriggerMatches(trigger: NormalizedListenerTrigger, event: ListenerEvent): boolean {
    if (trigger.kind !== event.kind) {
    	return false;
    }

    if (trigger.kind === "matrix.message") {
    	const request = event.request;
    	if (!request) {
    		return false;
    	}

    	return (
    		matchesOptionalList(trigger.messageTypes, request.message.type) &&
    		matchesOptionalList(trigger.rooms, request.room.id) &&
    		matchesOptionalList(trigger.senders, request.sender.id)
    	);
    }

    if (trigger.kind === "external") {
    	return (
    		matchesOptionalList(trigger.source, event.source) &&
    		matchesOptionalList(trigger.event, event.name)
    	);
    }

    return matchesOptionalList([trigger.source], event.source);
}

export function matrixMessageListenerEvent(request: Context): ListenerEvent {
    return {
    	id: request.message.id,
    	kind: "matrix.message",
    	source: "matrix",
    	request,
    	timestamp: new Date(),
    };
}

export function scheduleListenerEvent(trigger: NormalizedListenerScheduleTrigger): ListenerEvent {
    return {
    	id: `${trigger.source}:${Date.now()}`,
    	kind: "schedule",
    	source: trigger.source,
    	timestamp: new Date(),
    };
}
