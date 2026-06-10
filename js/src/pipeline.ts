import { Context, Handler, ListenerActions, ListenerEvent, ListenerHandler, ListenerMiddleware, Middleware } from "./types.js";

export async function runPipeline(ctx: Context, middleware: Middleware[], handler: Handler): Promise<void> {
    let index = -1;

    async function dispatch(position: number): Promise<void> {
        if (position <= index) {
        	throw new Error("next() called multiple times");
        }

        index = position;
        const layer = middleware[position];
        if (!layer) {
        	await handler(ctx);
        	return;
        }

        await layer(ctx, () => dispatch(position + 1));
    }

    await dispatch(0);
}

export async function runListenerPipeline(event: ListenerEvent, actions: ListenerActions, middleware: ListenerMiddleware[], handler: ListenerHandler): Promise<void> {
    let index = -1;

    async function dispatch(position: number): Promise<void> {
        if (position <= index) {
        	throw new Error("next() called multiple times");
        }

        index = position;
        const layer = middleware[position];
        if (!layer) {
        	await handler(event, actions);
        	return;
        }

        await layer(event, actions, () => dispatch(position + 1));
    }

    await dispatch(0);
}

export function createPipeline(pipeline: Array<Middleware | Handler>): {
    	middleware: Middleware[];
    	handler: Handler;
    } {
    if (pipeline.length === 0) {
    	throw new Error("handler is required");
    }

    return {
    	middleware: pipeline.slice(0, -1) as Middleware[],
    	handler: pipeline[pipeline.length - 1] as Handler,
    };
}

export function createListenerPipeline(pipeline: Array<ListenerMiddleware | ListenerHandler>): {
    	middleware: ListenerMiddleware[];
    	handler: ListenerHandler;
    } {
    if (pipeline.length === 0) {
    	throw new Error("handler is required");
    }

    return {
    	middleware: pipeline.slice(0, -1) as ListenerMiddleware[],
    	handler: pipeline[pipeline.length - 1] as ListenerHandler,
    };
}
