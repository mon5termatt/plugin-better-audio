import type {
	Channel,
	ChannelChange,
	LevelReading,
	MainOutput,
	Mix,
	Output,
	OutputDevice,
	OutputDeviceChange,
	OutputTarget,
} from "./types";

export interface MainOutputDetails {
	target: OutputTarget;
	name: string;
	level: number;
	isMuted: boolean;
}

/**
 * Cached Wave Link output list. Wave Link notifications are partial, so volume
 * changes are merged into the last full snapshot.
 */
export class OutputState {
	connected = false;
	mainOutput: MainOutput | null = null;
	devices: OutputDevice[] = [];
	mixes: Mix[] = [];
	channels: Channel[] = [];

	private outputMeters: LevelReading[] = [];
	private readonly listeners = new Set<(kind: OutputChangeKind) => void>();

	onChange(listener: (kind: OutputChangeKind) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	replaceOutputs(mainOutput: MainOutput, devices: OutputDevice[]): void {
		this.mainOutput = {
			outputDeviceId: mainOutput.outputDeviceId,
			outputId: mainOutput.outputId ?? "",
		};
		this.devices = devices.map(cloneDevice);
		this.emit("devices");
	}

	setConnected(connected: boolean): void {
		if (this.connected === connected) {
			return;
		}

		this.connected = connected;
		if (!connected) {
			this.outputMeters = [];
		}
		this.emit("devices");
	}

	applyOutputMeters(readings: LevelReading[]): void {
		let changed = false;

		for (const reading of readings) {
			const next = normalizeReading(reading);
			const index = this.outputMeters.findIndex((candidate) => candidate.id === next.id && candidate.subId === next.subId);
			if (index < 0) {
				this.outputMeters.push(next);
				changed = true;
				continue;
			}

			const current = this.outputMeters[index];
			if (
				current &&
				current.levelLeftPercentage === next.levelLeftPercentage &&
				current.levelRightPercentage === next.levelRightPercentage
			) {
				continue;
			}

			this.outputMeters[index] = next;
			changed = true;
		}

		if (changed) {
			this.emit("meter");
		}
	}

	setMainOutput(target: OutputTarget): void {
		this.mainOutput = {
			outputDeviceId: target.outputDeviceId,
			outputId: target.outputId,
		};
		this.emit("selection");
	}

	replaceMixes(mixes: Mix[]): void {
		const next = mixes
			.filter((mix) => mix.id.length > 0)
			.map((mix) => ({ id: mix.id, name: mix.name || mix.id }));
		if (
			next.length === this.mixes.length &&
			next.every((mix, index) => mix.id === this.mixes[index]?.id && mix.name === this.mixes[index]?.name)
		) {
			return;
		}

		this.mixes = next;
		this.emit("devices");
	}

	mixName(mixId: string): string {
		return this.mixes.find((mix) => mix.id === mixId)?.name ?? "";
	}

	replaceChannels(channels: Channel[]): void {
		this.channels = channels.map(cloneChannel);
		this.emit("channels");
	}

	findChannelByName(name: string): Channel | undefined {
		return this.channels.find((channel) => channel.name === name);
	}

	channelMixMute(channelId: string, mixId: string): boolean | undefined {
		return this.channels
			.find((channel) => channel.id === channelId)
			?.mixes.find((mix) => mix.id === mixId)?.isMuted;
	}

	setChannelMixMute(channelId: string, mixId: string, isMuted: boolean): void {
		const channel = this.channels.find((candidate) => candidate.id === channelId);
		if (!channel) {
			return;
		}

		const mix = channel.mixes.find((candidate) => candidate.id === mixId);
		if (!mix) {
			return;
		}

		if (mix.isMuted === isMuted) {
			return;
		}

		mix.isMuted = isMuted;
		this.emit("channels");
	}

	/**
	 * Merge one `channelChanged` notification.
	 * Returns false when the channel is not cached and a full refresh is needed.
	 */
	applyChannelChange(change: ChannelChange): boolean {
		const channel = this.channels.find((candidate) => candidate.id === change.id);
		if (!channel) {
			return false;
		}

		if (change.name !== undefined) {
			channel.name = change.name;
		}
		if (change.level !== undefined) {
			channel.level = change.level;
		}
		if (change.isMuted !== undefined) {
			channel.isMuted = change.isMuted;
		}

		for (const mixChange of change.mixes ?? []) {
			const mix = channel.mixes.find((candidate) => candidate.id === mixChange.id);
			if (!mix) {
				channel.mixes.push({
					id: mixChange.id,
					level: mixChange.level ?? 0,
					isMuted: mixChange.isMuted ?? false,
				});
				continue;
			}

			if (mixChange.level !== undefined) {
				mix.level = mixChange.level;
			}
			if (mixChange.isMuted !== undefined) {
				mix.isMuted = mixChange.isMuted;
			}
		}

		this.emit("channels");
		return true;
	}

	setOutputMix(target: OutputTarget, mixId: string): void {
		const output = this.findOutput(target.outputDeviceId, target.outputId);
		if (!output || output.mixId === mixId) {
			return;
		}

		output.mixId = mixId;
		this.emit("level");
	}

	setLevel(target: OutputTarget, level: number): void {
		const output = this.findOutput(target.outputDeviceId, target.outputId);
		if (!output || output.level === level) {
			return;
		}

		output.level = level;
		this.emit("level");
	}

	/**
	 * Merge one `outputDeviceChanged` notification.
	 * Returns false when the device is not in the cache and a full refresh is needed.
	 */
	applyDeviceChange(change: OutputDeviceChange): boolean {
		const device = this.devices.find((candidate) => candidate.id === change.id);
		if (!device) {
			return false;
		}

		if (change.name !== undefined) {
			device.name = change.name;
		}

		if (change.deviceType !== undefined) {
			device.deviceType = change.deviceType;
		}

		for (const outputChange of change.outputs ?? []) {
			const output = device.outputs.find((candidate) => candidate.id === outputChange.id);
			if (!output) {
				continue;
			}

			if (outputChange.name !== undefined) {
				output.name = outputChange.name;
			}

			if (outputChange.level !== undefined) {
				output.level = outputChange.level;
			}

			if (outputChange.isMuted !== undefined) {
				output.isMuted = outputChange.isMuted;
			}

			if (outputChange.mixId !== undefined) {
				output.mixId = outputChange.mixId;
			}
		}

		this.emit("level");
		return true;
	}

	currentTarget(): OutputTarget | undefined {
		if (!this.mainOutput?.outputDeviceId) {
			return undefined;
		}

		return {
			outputDeviceId: this.mainOutput.outputDeviceId,
			outputId: this.mainOutput.outputId || this.mainOutput.outputDeviceId,
		};
	}

	currentMeter(): number {
		const levels = this.currentLevels();
		return Math.max(levels.left, levels.right);
	}

	currentLevels(): { left: number; right: number } {
		const target = this.currentTarget();
		if (!target) {
			return { left: 0, right: 0 };
		}

		const subId = this.meterSubId(target.outputDeviceId, target.outputId);
		const reading = this.outputMeters.find(
			(candidate) => candidate.id === target.outputDeviceId && candidate.subId === subId,
		);
		return {
			left: clampLevel(reading?.levelLeftPercentage ?? 0),
			right: clampLevel(reading?.levelRightPercentage ?? 0),
		};
	}

	meterSubId(deviceId: string, outputId: string): string | undefined {
		const device = this.devices.find((candidate) => candidate.id === deviceId);
		return device?.deviceType === "waveXLRPro" ? outputId : undefined;
	}

	currentDetails(): MainOutputDetails | undefined {
		const target = this.currentTarget();
		if (!target) {
			return undefined;
		}

		const device = this.devices.find((candidate) => candidate.id === target.outputDeviceId);
		const output = this.findOutput(target.outputDeviceId, target.outputId);

		return {
			target,
			name: output?.name || device?.name || "Output",
			level: output?.level ?? 0,
			isMuted: output?.isMuted ?? false,
		};
	}

	findOutput(deviceId: string, outputId: string): Output | undefined {
		return this.devices
			.find((device) => device.id === deviceId)
			?.outputs.find((output) => output.id === outputId);
	}

	private emit(kind: OutputChangeKind): void {
		for (const listener of this.listeners) {
			listener(kind);
		}
	}
}

export type OutputChangeKind = "devices" | "level" | "selection" | "meter" | "channels";

function normalizeReading(reading: LevelReading): LevelReading {
	return {
		id: reading.id,
		subId: reading.subId || undefined,
		levelLeftPercentage: clampLevel(reading.levelLeftPercentage),
		levelRightPercentage: clampLevel(reading.levelRightPercentage),
	};
}

function clampLevel(level: number): number {
	if (!Number.isFinite(level)) {
		return 0;
	}

	return Math.min(1, Math.max(0, level));
}

function cloneChannel(channel: Channel): Channel {
	return {
		...channel,
		mixes: channel.mixes.map((mix) => ({ ...mix })),
	};
}

function cloneDevice(device: OutputDevice): OutputDevice {
	return {
		...device,
		outputs: device.outputs.map((output) => ({ ...output })),
	};
}
