import { BotError } from "./errors";
import type { ScheduleContext, ScheduleOptions } from "./types";

export interface ScheduledJob {
	name: string;
	options: ScheduleOptions;
	handler: (ctx: ScheduleContext) => Promise<void> | void;
	timer?: NodeJS.Timeout;
	running: boolean;
	disposed: boolean;
	dispose: () => void;
}

export class ScheduleManager {
	private jobs = new Map<string, ScheduledJob>();
	private bot: any;

	constructor(bot: any) {
		this.bot = bot;
	}

	normalizeIntervalMs(options: ScheduleOptions): number | undefined {
		if (options.everyMs !== undefined) {
			if (
				typeof options.everyMs !== "number" ||
				Number.isNaN(options.everyMs) ||
				!Number.isFinite(options.everyMs) ||
				options.everyMs <= 0
			) {
				throw new BotError(
					"everyMs must be a positive finite number",
					"VALIDATION",
				);
			}
			return options.everyMs;
		}

		if (options.everySec !== undefined) {
			if (
				typeof options.everySec !== "number" ||
				Number.isNaN(options.everySec) ||
				!Number.isFinite(options.everySec) ||
				options.everySec <= 0
			) {
				throw new BotError(
					"everySec must be a positive finite number",
					"VALIDATION",
				);
			}
			return options.everySec * 1000;
		}

		if (options.everyMin !== undefined) {
			if (
				typeof options.everyMin !== "number" ||
				Number.isNaN(options.everyMin) ||
				!Number.isFinite(options.everyMin) ||
				options.everyMin <= 0
			) {
				throw new BotError(
					"everyMin must be a positive finite number",
					"VALIDATION",
				);
			}
			return options.everyMin * 60_000;
		}

		if (options.everyHr !== undefined) {
			if (
				typeof options.everyHr !== "number" ||
				Number.isNaN(options.everyHr) ||
				!Number.isFinite(options.everyHr) ||
				options.everyHr <= 0
			) {
				throw new BotError(
					"everyHr must be a positive finite number",
					"VALIDATION",
				);
			}
			return options.everyHr * 3_600_000;
		}

		if (options.everyDay !== undefined) {
			if (
				typeof options.everyDay !== "number" ||
				Number.isNaN(options.everyDay) ||
				!Number.isFinite(options.everyDay) ||
				options.everyDay <= 0
			) {
				throw new BotError(
					"everyDay must be a positive finite number",
					"VALIDATION",
				);
			}
			return options.everyDay * 86_400_000;
		}

		if (options.every) {
			let totalMs = 0;
			if (options.every.seconds !== undefined) {
				if (
					typeof options.every.seconds !== "number" ||
					Number.isNaN(options.every.seconds) ||
					!Number.isFinite(options.every.seconds) ||
					options.every.seconds <= 0
				) {
					throw new BotError(
						"every.seconds must be a positive finite number",
						"VALIDATION",
					);
				}
				totalMs += options.every.seconds * 1000;
			}
			if (options.every.minutes !== undefined) {
				if (
					typeof options.every.minutes !== "number" ||
					Number.isNaN(options.every.minutes) ||
					!Number.isFinite(options.every.minutes) ||
					options.every.minutes <= 0
				) {
					throw new BotError(
						"every.minutes must be a positive finite number",
						"VALIDATION",
					);
				}
				totalMs += options.every.minutes * 60_000;
			}
			if (options.every.hours !== undefined) {
				if (
					typeof options.every.hours !== "number" ||
					Number.isNaN(options.every.hours) ||
					!Number.isFinite(options.every.hours) ||
					options.every.hours <= 0
				) {
					throw new BotError(
						"every.hours must be a positive finite number",
						"VALIDATION",
					);
				}
				totalMs += options.every.hours * 3_600_000;
			}
			if (options.every.days !== undefined) {
				if (
					typeof options.every.days !== "number" ||
					Number.isNaN(options.every.days) ||
					!Number.isFinite(options.every.days) ||
					options.every.days <= 0
				) {
					throw new BotError(
						"every.days must be a positive finite number",
						"VALIDATION",
					);
				}
				totalMs += options.every.days * 86_400_000;
			}
			if (totalMs > 0) return totalMs;
		}

		return undefined;
	}

	schedule(
		name: string,
		options: ScheduleOptions,
		handler: (ctx: ScheduleContext) => Promise<void> | void,
	): { name: string; dispose: () => void } {
		const intervalMs = this.normalizeIntervalMs(options);
		const atDate = options.at;

		if (intervalMs !== undefined && atDate !== undefined) {
			throw new BotError(
				"Cannot specify both interval and 'at' date for a schedule",
				"VALIDATION",
			);
		}

		if (intervalMs === undefined && atDate === undefined) {
			throw new BotError(
				"Schedule must specify an interval or 'at' date",
				"VALIDATION",
			);
		}

		if (atDate) {
			const diff = atDate.getTime() - Date.now();
			if (diff <= 0) {
				throw new BotError(
					"Scheduled 'at' date must be in the future",
					"VALIDATION",
				);
			}
		}

		const existing = this.jobs.get(name);
		if (existing) {
			existing.dispose();
		}

		const job: ScheduledJob = {
			name,
			options,
			handler,
			running: false,
			disposed: false,
			dispose: () => {
				job.disposed = true;
				if (job.timer) {
					clearTimeout(job.timer);
					clearInterval(job.timer);
					job.timer = undefined;
				}
				this.jobs.delete(name);
			},
		};

		const runTick = async () => {
			if (job.disposed) return;
			const overlapPolicy = options.overlap || "skip";
			if (job.running && overlapPolicy === "skip") {
				return;
			}

			job.running = true;
			try {
				const ctx: ScheduleContext = {
					name: job.name,
					bot: this.bot,
					timestamp: new Date(),
				};
				await job.handler(ctx);
			} catch (err) {
				if (this.bot?.handleError) {
					await this.bot.handleError(err, "schedule");
				}
			} finally {
				job.running = false;
			}
		};

		if (intervalMs !== undefined) {
			job.timer = setInterval(runTick, intervalMs);
		} else if (atDate !== undefined) {
			const delay = atDate.getTime() - Date.now();
			job.timer = setTimeout(async () => {
				await runTick();
				job.dispose();
			}, delay);
		}

		this.jobs.set(name, job);
		return { name, dispose: job.dispose };
	}

	stopAll(): void {
		for (const job of this.jobs.values()) {
			job.dispose();
		}
		this.jobs.clear();
	}
}
