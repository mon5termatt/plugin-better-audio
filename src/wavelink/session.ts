import type { JsonValue } from "@elgato/utils";

import {
	CHAT_MIX_NAME,
	chooseNextMix,
	chooseNextOutput,
	decodeOutput,
	encodeOutput,
	MAIN_OUTPUT_ROUTE,
	nextMixMute,
	routeTarget,
	SYSTEM_CHANNEL_NAME,
	toggledMixId,
} from "./selection";
import { OutputState } from "./state";
import type { DataSourceResult } from "../sdpi";
import type { Channel, ChannelChange, LevelReading, Mix, OutputDevice, OutputDeviceChange, OutputDevicesResult, ReadyInfo } from "./types";
import { OutputVolumeWriter } from "./volume-writer";
import { WaveLinkClient } from "./client";

export type RouteSettings = {
	[key: string]: JsonValue;
	output?: string;
	mixA?: string;
	mixB?: string;
};

export type MixToggleSettings = {
	[key: string]: JsonValue;
	output?: string;
	mix?: string;
};

export type ChannelMuteSettings = {
	[key: string]: JsonValue;
	channel?: string;
	mix?: string;
};

export type OutputSettings = {
	[key: string]: JsonValue;
	outputA?: string;
	outputB?: string;
	volumeStep?: number;
	stepA?: number;
	stepB?: number;
	meterStyle?: string;
};

/**
 * One Wave Link connection shared by every dial.
 * Volume and main-output changes are sent with `setOutputDevice` only.
 */
export class WaveLinkSession {
	readonly state = new OutputState();

	private readonly client = new WaveLinkClient();
	private readonly volume: OutputVolumeWriter;
	private readonly failures = new Set<(error: unknown) => void>();
	private meterUsers = 0;
	private meterTarget: MeterSubscription | undefined;
	private meterSyncing = false;
	private meterSyncQueued = false;

	constructor() {
		this.volume = new OutputVolumeWriter(
			this.state,
			(deviceId, outputId, level) => this.client.setOutputLevel(deviceId, outputId, level),
			(error) => {
				this.reportFailure(error);
				void this.refresh().catch((refreshError) => {
					this.client.emit("error", refreshError);
				});
			},
		);

		this.client.on("ready", (info: ReadyInfo) => {
			this.state.connected = true;
			this.state.replaceOutputs(info.outputs.mainOutput, info.outputs.outputDevices);
			void this.loadMixes();
			void this.loadChannels();
			void this.syncLevelMeter();
		});

		this.client.on("disconnected", () => {
			this.meterTarget = undefined;
			this.state.setConnected(false);
		});

		this.client.on("outputDevicesChanged", (payload: OutputDevicesResult) => {
			this.state.replaceOutputs(payload.mainOutput, payload.outputDevices);
			void this.syncLevelMeter();
		});

		this.client.on("levelMeterChanged", (readings: LevelReading[]) => {
			this.state.applyOutputMeters(readings);
		});

		this.client.on("mixesChanged", (mixes: Mix[]) => {
			this.state.replaceMixes(mixes);
		});

		this.client.on("channelsChanged", (channels: Channel[]) => {
			this.state.replaceChannels(channels);
		});

		this.client.on("channelChanged", (change: ChannelChange) => {
			if (!this.state.applyChannelChange(change)) {
				void this.loadChannels();
			}
		});

		this.client.on("outputDeviceChanged", (change: OutputDeviceChange) => {
			const known = this.state.applyDeviceChange(change);
			this.volume.restorePending();
			if (!known) {
				void this.refresh().catch((error) => {
					this.client.emit("error", error);
				});
			}
		});
	}

	start(): void {
		this.client.start();
	}

	stop(): void {
		this.client.stop();
	}

	onError(listener: (error: Error) => void): void {
		this.client.on("error", listener);
	}

	onReady(listener: (info: ReadyInfo) => void): void {
		this.client.on("ready", listener);
	}

	onFailure(listener: (error: unknown) => void): void {
		this.failures.add(listener);
	}

	retainLevelMeter(): void {
		this.meterUsers += 1;
		void this.syncLevelMeter();
	}

	releaseLevelMeter(): void {
		this.meterUsers = Math.max(0, this.meterUsers - 1);
		void this.syncLevelMeter();
	}

	async refresh(): Promise<void> {
		const outputs = await this.client.refreshOutputs();
		this.state.connected = true;
		this.state.replaceOutputs(outputs.mainOutput, outputs.outputDevices);
		void this.syncLevelMeter();
	}

	adjustCurrentVolume(ticks: number, stepPercent = 1): void {
		const target = this.state.currentTarget();
		if (!this.state.connected || !target) {
			throw new Error("Wave Link main output is unavailable");
		}

		this.volume.adjust(target, ticks, stepPercent);
	}

	async toggle(settings: OutputSettings): Promise<boolean> {
		if (!this.state.connected) {
			throw new Error("Wave Link is not running");
		}

		const next = chooseNextOutput(
			this.state.currentTarget(),
			decodeOutput(settings.outputA),
			decodeOutput(settings.outputB),
		);

		if (!next) {
			return false;
		}

		this.state.setMainOutput(next);
		await this.client.setMainOutput(next);
		void this.syncLevelMeter();
		return true;
	}

	/**
	 * Switch the chosen output between mix A and mix B.
	 * An empty output setting follows the live main output.
	 */
	async toggleRoute(settings: RouteSettings): Promise<boolean> {
		if (!this.state.connected) {
			throw new Error("Wave Link is not running");
		}

		const target = routeTarget(settings.output, this.state.currentTarget());
		if (!target || !this.state.findOutput(target.outputDeviceId, target.outputId)) {
			return false;
		}

		const current = this.state.findOutput(target.outputDeviceId, target.outputId);
		const next = chooseNextMix(current?.mixId, settings.mixA, settings.mixB);
		if (!next) {
			return false;
		}

		await this.applyMix(target, next);
		return true;
	}

	/**
	 * Turn one mix on for an output, or off again if that mix is already routed.
	 * Off restores the output's previous mix.
	 */
	async toggleMix(settings: MixToggleSettings): Promise<boolean> {
		if (!this.state.connected) {
			throw new Error("Wave Link is not running");
		}

		const target = routeTarget(settings.output, this.state.currentTarget());
		const output = target ? this.state.findOutput(target.outputDeviceId, target.outputId) : undefined;
		if (!target || !output) {
			return false;
		}

		const next = toggledMixId(output.mixId, settings.mix);
		if (next === undefined) {
			return false;
		}

		await this.applyMix(target, next);
		return true;
	}

	private async applyMix(target: { outputDeviceId: string; outputId: string }, mixId: string): Promise<void> {
		this.state.setOutputMix(target, mixId);
		try {
			await this.client.setOutputMix(target.outputDeviceId, target.outputId, mixId);
		} catch (error) {
			await this.refresh().catch(() => undefined);
			throw error;
		}
	}

	outputItems(settings: OutputSettings): DataSourceResult {
		const items: DataSourceResult = this.state.devices.flatMap((device) =>
			device.outputs.map((output) => ({
				value: encodeOutput({ outputDeviceId: device.id, outputId: output.id }),
				label: outputChoiceLabel(device, output.name),
			})),
		);

		for (const saved of [settings.outputA, settings.outputB]) {
			if (saved && decodeOutput(saved) && !items.some((item) => item.value === saved)) {
				items.push({
					value: saved,
					label: "Unavailable output",
					disabled: true,
				});
			}
		}

		if (items.length === 0) {
			items.push({
				value: "__none__",
				label: this.state.connected ? "No outputs found" : "Wave Link is not running",
				disabled: true,
			});
		}

		return items.sort((left, right) => left.label.localeCompare(right.label));
	}

	routeOutputItems(saved?: string): DataSourceResult {
		const items: DataSourceResult = [{ value: MAIN_OUTPUT_ROUTE, label: "Main output" }];

		for (const device of this.state.devices) {
			for (const output of device.outputs) {
				items.push({
					value: encodeOutput({ outputDeviceId: device.id, outputId: output.id }),
					label: outputChoiceLabel(device, output.name),
				});
			}
		}

		if (saved && saved !== MAIN_OUTPUT_ROUTE && decodeOutput(saved) && !items.some((item) => item.value === saved)) {
			items.push({ value: saved, label: "Unavailable output", disabled: true });
		}

		if (this.state.devices.length === 0) {
			items.push({
				value: "__none__",
				label: this.state.connected ? "No outputs found" : "Wave Link is not running",
				disabled: true,
			});
		}

		const [main, ...rest] = items;
		rest.sort((left, right) => left.label.localeCompare(right.label));
		return main ? [main, ...rest] : rest;
	}

	mixItems(savedA?: string, savedB?: string): DataSourceResult {
		const items: DataSourceResult = this.state.mixes.map((mix) => ({
			value: mix.id,
			label: mix.name || mix.id,
		}));

		for (const saved of [savedA, savedB]) {
			if (saved && !items.some((item) => item.value === saved)) {
				items.push({ value: saved, label: "Unavailable mix", disabled: true });
			}
		}

		if (items.length === 0) {
			items.push({
				value: "__none__",
				label: this.state.connected ? "No mixes found" : "Wave Link is not running",
				disabled: true,
			});
		}

		return items;
	}

	channelItems(saved?: string): DataSourceResult {
		const items: DataSourceResult = this.state.channels.map((channel) => ({
			value: channel.id,
			label: channel.name || channel.id,
		}));

		if (saved && !items.some((item) => item.value === saved)) {
			items.push({ value: saved, label: "Unavailable channel", disabled: true });
		}

		if (items.length === 0) {
			items.push({
				value: "__none__",
				label: this.state.connected ? "No channels found" : "Wave Link is not running",
				disabled: true,
			});
		}

		return items.sort((left, right) => left.label.localeCompare(right.label));
	}

	resolveChannel(channelId: string | undefined) {
		if (channelId) {
			return this.state.channels.find((channel) => channel.id === channelId);
		}

		return this.state.findChannelByName(SYSTEM_CHANNEL_NAME);
	}

	resolveMix(mixId: string | undefined) {
		if (mixId) {
			return this.state.mixes.find((mix) => mix.id === mixId);
		}

		return this.state.mixes.find((mix) => mix.name === CHAT_MIX_NAME);
	}

	/**
	 * Mute or unmute one channel inside one mix.
	 * An empty choice follows System and Chat Mix. Other mixes and the master level stay as they are.
	 */
	async toggleChannelMute(settings: ChannelMuteSettings): Promise<boolean> {
		if (!this.state.connected) {
			throw new Error("Wave Link is not running");
		}

		const channel = this.resolveChannel(settings.channel);
		const mix = this.resolveMix(settings.mix);
		if (!channel || !mix) {
			return false;
		}

		const muted = this.state.channelMixMute(channel.id, mix.id);
		if (muted === undefined) {
			return false;
		}

		const nextMuted = nextMixMute(muted);
		this.state.setChannelMixMute(channel.id, mix.id, nextMuted);
		try {
			await this.client.setChannelMixMute(channel.id, mix.id, nextMuted);
		} catch (error) {
			await this.loadChannels().catch(() => undefined);
			throw error;
		}

		return true;
	}

	private async loadChannels(): Promise<void> {
		try {
			this.state.replaceChannels(await this.client.getChannels());
		} catch (error) {
			this.client.emit("error", error instanceof Error ? error : new Error(String(error)));
		}
	}

	private async loadMixes(): Promise<void> {
		try {
			this.state.replaceMixes(await this.client.getMixes());
		} catch (error) {
			this.client.emit("error", error instanceof Error ? error : new Error(String(error)));
		}
	}

	private async syncLevelMeter(): Promise<void> {
		if (this.meterSyncing) {
			this.meterSyncQueued = true;
			return;
		}

		this.meterSyncing = true;
		try {
			do {
				this.meterSyncQueued = false;
				await this.applyMeterSubscription();
			} while (this.meterSyncQueued);
		} finally {
			this.meterSyncing = false;
		}
	}

	private async applyMeterSubscription(): Promise<void> {
		if (!this.state.connected) {
			this.meterTarget = undefined;
			return;
		}

		const next = this.desiredMeter();
		const previous = this.meterTarget;
		if (sameMeter(previous, next)) {
			return;
		}

		try {
			if (previous) {
				await this.client.setLevelMeterSubscription(previous.id, false, previous.subId);
			}

			if (next) {
				await this.client.setLevelMeterSubscription(next.id, true, next.subId);
			}

			this.meterTarget = next;
		} catch (error) {
			this.meterTarget = undefined;
			this.client.emit("error", error instanceof Error ? error : new Error(String(error)));
		}
	}

	private desiredMeter(): MeterSubscription | undefined {
		if (this.meterUsers === 0) {
			return undefined;
		}

		const target = this.state.currentTarget();
		if (!target) {
			return undefined;
		}

		return {
			id: target.outputDeviceId,
			subId: this.state.meterSubId(target.outputDeviceId, target.outputId),
		};
	}

	private reportFailure(error: unknown): void {
		for (const listener of this.failures) {
			listener(error);
		}
	}
}

interface MeterSubscription {
	id: string;
	subId?: string;
}

function sameMeter(left: MeterSubscription | undefined, right: MeterSubscription | undefined): boolean {
	return left?.id === right?.id && left?.subId === right?.subId;
}

function outputChoiceLabel(device: OutputDevice, outputName: string): string {
	if (device.outputs.length > 1 && outputName && outputName !== device.name) {
		return `${device.name} — ${outputName}`;
	}

	return device.name || outputName || device.id;
}
