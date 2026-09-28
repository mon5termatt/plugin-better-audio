import { decodeOutput, encodeOutput, stepLevel } from "./selection";
import type { OutputState } from "./state";
import type { OutputTarget } from "./types";

type SendLevel = (deviceId: string, outputId: string, level: number) => Promise<void>;

/**
 * Sends output volume to Wave Link while a dial is turning.
 * In-flight requests keep the newest level, and older notifications cannot rewind it.
 */
export class OutputVolumeWriter {
	private readonly pending = new Map<string, number>();
	private sending = false;

	constructor(
		private readonly state: OutputState,
		private readonly send: SendLevel,
		private readonly onError: (error: unknown) => void,
	) {}

	adjust(target: OutputTarget, ticks: number, stepPercent = 1): void {
		const output = this.state.findOutput(target.outputDeviceId, target.outputId);
		if (!output || ticks === 0) {
			return;
		}

		const key = encodeOutput(target);
		const base = this.pending.get(key) ?? output.level;
		const next = stepLevel(base, ticks, stepPercent);
		if (next === base) {
			return;
		}

		this.pending.set(key, next);
		this.state.setLevel(target, next);
		void this.flush();
	}

	/**
	 * After a remote update is merged, put any level we still intend to write back on top.
	 */
	restorePending(): void {
		for (const [key, level] of this.pending) {
			const target = decodeOutput(key);
			if (!target) {
				this.pending.delete(key);
				continue;
			}

			const output = this.state.findOutput(target.outputDeviceId, target.outputId);
			if (!output) {
				continue;
			}

			if (output.level === level) {
				this.pending.delete(key);
				continue;
			}

			this.state.setLevel(target, level);
		}
	}

	private async flush(): Promise<void> {
		if (this.sending) {
			return;
		}

		this.sending = true;
		try {
			while (this.pending.size > 0) {
				const next = this.pending.entries().next().value as [string, number] | undefined;
				if (!next) {
					break;
				}

				const [key, level] = next;
				const target = decodeOutput(key);
				if (!target) {
					this.pending.delete(key);
					continue;
				}

				try {
					await this.send(target.outputDeviceId, target.outputId, level);
					if (this.pending.get(key) === level) {
						this.pending.delete(key);
					}
				} catch (error) {
					this.pending.delete(key);
					this.onError(error);
					break;
				}
			}
		} finally {
			this.sending = false;
		}
	}
}
