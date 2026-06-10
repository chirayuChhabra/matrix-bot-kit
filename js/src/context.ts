import { readFile } from "node:fs/promises";
import { basename, extname } from "path";
import { MediaAttachment, MediaDownloadTarget, MediaKind, MediaPathAttachment, OutboundPoll, ReplyContext, SendContext } from "./types.js";
import { assertPresent } from "./helpers";
import { NativeIncomingMessage, NativeMatrixBot, NativeMediaAttachment } from "./native.js";
import { contentTypesByExtension } from "./constants.js";

export function createSendContext(native: NativeMatrixBot, roomId: string, promise: Promise<unknown>): SendContext {
    const sendCtx: any = {
        		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
        		catch: (onrejected: any) => promise.catch(onrejected),
        		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
        		finally: (onfinally: any) => promise.finally(onfinally),
        		get [Symbol.toStringTag]() {
        			return "Promise";
        		},
        		message: (body: string) =>
        			createSendContext(
        				native,
        				roomId,
        				promise.then(() => native.sendText(roomId, body)),
        			),
        		text: (body: string) => sendCtx.message(body),
        		markdown: (body: string) =>
        			createSendContext(
        				native,
        				roomId,
        				promise.then(() => native.sendMarkdown(roomId, body)),
        			),
        		media: (kind: MediaKind, attachment: MediaAttachment) =>
        			createSendContext(
        				native,
        				roomId,
        				promise.then(async () => {
        					const normalized = await normalizeMediaAttachment(attachment, kind);
        					if (kind === "image") await native.sendImage(roomId, normalized);
        					else if (kind === "video") await native.sendVideo(roomId, normalized);
        					else await native.sendFile(roomId, normalized);
        				}),
        			),
        		image: (attachment: MediaAttachment) =>
        			createSendContext(
        				native,
        				roomId,
        				promise.then(async () => {
        					await native.sendImage(
        						roomId,
        						await normalizeMediaAttachment(attachment, "image"),
        					);
        				}),
        			),
        		file: (attachment: MediaAttachment) =>
        			createSendContext(
        				native,
        				roomId,
        				promise.then(async () => {
        					await native.sendFile(
        						roomId,
        						await normalizeMediaAttachment(attachment, "file"),
        					);
        				}),
        			),
        		video: (attachment: MediaAttachment) =>
        			createSendContext(
        				native,
        				roomId,
        				promise.then(async () => {
        					await native.sendVideo(
        						roomId,
        						await normalizeMediaAttachment(attachment, "video"),
        					);
        				}),
        			),
        		poll: (poll: OutboundPoll) =>
        			createSendContext(
        				native,
        				roomId,
        				promise.then(() =>
        					native.sendPoll(roomId, {
        						question: poll.question,
        						answers: poll.answers,
        						kind: poll.kind,
        						maxSelections: poll.maxSelections,
        						actionId: poll.actionId,
        					}),
        				),
        			),
        	};
    Object.defineProperty(sendCtx, "then", {
    	// biome-ignore lint/suspicious/noExplicitAny: Promise resolution signature
    	value: (onfulfilled: any, onrejected: any) =>
    		promise.then(onfulfilled, onrejected),
    });
    return sendCtx as SendContext;
}

export function createReplyContext(native: NativeMatrixBot, roomId: string, eventId: string, promise: Promise<unknown>): ReplyContext {
    const replyCtx: any = {
        		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
        		catch: (onrejected: any) => promise.catch(onrejected),
        		// biome-ignore lint/suspicious/noExplicitAny: dynamic types
        		finally: (onfinally: any) => promise.finally(onfinally),
        		get [Symbol.toStringTag]() {
        			return "Promise";
        		},
        		message: (body: string) =>
        			createReplyContext(
        				native,
        				roomId,
        				eventId,
        				promise.then(() => native.replyText(roomId, eventId, body)),
        			),
        		text: (body: string) => replyCtx.message(body),
        		markdown: (body: string) =>
        			createReplyContext(
        				native,
        				roomId,
        				eventId,
        				promise.then(() => native.replyMarkdown(roomId, eventId, body)),
        			),
        	};
    Object.defineProperty(replyCtx, "then", {
    	// biome-ignore lint/suspicious/noExplicitAny: Promise resolution signature
    	value: (onfulfilled: any, onrejected: any) =>
    		promise.then(onfulfilled, onrejected),
    });
    return replyCtx as ReplyContext;
}

export async function normalizeMediaAttachment(attachment: MediaAttachment, kind: MediaKind = "file"): Promise<NativeMediaAttachment> {
    if (typeof attachment === "string") {
    	return mediaAttachmentFromPath(attachment, kind);
    }

    if ("data" in attachment) {
    	return attachment;
    }

    return mediaAttachmentFromPath(attachment.path, kind, attachment);
}

async function mediaAttachmentFromPath(path: string, kind: MediaKind, options: Pick<MediaPathAttachment, "filename" | "contentType"> = {}): Promise<NativeMediaAttachment> {
    assertPresent("attachment path", path);
    return {
    	filename: options.filename ?? basename(path),
    	contentType: options.contentType ?? inferContentType(path, kind),
    	data: await readFile(path),
    };
}

export function inferContentType(path: string, kind: MediaKind): string {
    const extension = extname(path).toLowerCase();
    const contentType = contentTypesByExtension[extension];
    if (contentType) {
    	return contentType;
    }

    switch (kind) {
    	case "image":
    		return "image/png";
    	case "video":
    		return "video/mp4";
    	default:
    		return "application/octet-stream";
    }
}

export function resolveMediaDownloadTarget(target: MediaDownloadTarget | undefined, message: Pick<NativeIncomingMessage, "roomId" | "eventId">): { roomId: string; eventId: string } {
    if (typeof target === "string") {
    	assertPresent("media download target eventId", target);
    	return {
    		roomId: message.roomId,
    		eventId: target,
    	};
    }

    return {
    	roomId: target?.roomId ?? message.roomId,
    	eventId: target?.eventId ?? message.eventId,
    };
}
