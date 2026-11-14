/**
 * Standard error codes for MatrixBot operations.
 */
export type BotErrorCode =
	| "VALIDATION"
	| "AUTH"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "RATE_LIMITED"
	| "NETWORK"
	| "DECRYPTION"
	| "UNSUPPORTED_EVENT"
	| "NATIVE_UNAVAILABLE"
	| "STARTUP_TIMEOUT"
	| "PROMPT_TIMEOUT"
	| "PROMPT_CONFLICT"
	| "ABORTED"
	| "STOPPED"
	| "INTERNAL";

/**
 * Structured error class representing a failure in MatrixBot operations.
 */
export class BotError extends Error {
	readonly code: BotErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		message: string,
		code: BotErrorCode = "INTERNAL",
		options?: { cause?: unknown; details?: Record<string, unknown> },
	) {
		super(message, options?.cause ? { cause: options.cause } : undefined);
		this.name = "BotError";
		this.code = code;
		this.details = options?.details;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
