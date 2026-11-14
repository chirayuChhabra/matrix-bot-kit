import crypto from "node:crypto";
import { extname } from "node:path";

/**
 * Escapes characters for HTML output.
 */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Basic markdown to HTML converter for Matrix messages.
 */
export function markdownToHtml(md: string): string {
	let html = escapeHtml(md);

	// Code blocks: ```lang ... ```
	html = html.replace(
		/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g,
		"<pre><code>$1</code></pre>",
	);

	// Inline code: `...`
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

	// Bold: **...** or __...__
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

	// Italic: *...* or _..._
	html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
	html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

	// Strikethrough: ~~...~~
	html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");

	// Links: [text](url)
	html = html.replace(
		/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		'<a href="$2">$1</a>',
	);

	// Line breaks to <br />
	html = html.replace(/\n/g, "<br />\n");

	return html;
}

/**
 * Determines MIME type from file extension.
 */
export function getMimeType(filename: string): string {
	const ext = extname(filename).toLowerCase();
	switch (ext) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		case ".svg":
			return "image/svg+xml";
		case ".mp4":
			return "video/mp4";
		case ".webm":
			return "video/webm";
		case ".mp3":
			return "audio/mpeg";
		case ".ogg":
			return "audio/ogg";
		case ".wav":
			return "audio/wav";
		case ".pdf":
			return "application/pdf";
		case ".json":
			return "application/json";
		case ".txt":
			return "text/plain";
		case ".html":
			return "text/html";
		case ".zip":
			return "application/zip";
		default:
			return "application/octet-stream";
	}
}

/**
 * Constant time string comparison to prevent timing attacks.
 */
export function constantTimeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return crypto.timingSafeEqual(bufA, bufB);
}
