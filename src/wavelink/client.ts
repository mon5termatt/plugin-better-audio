import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

import type {
	ApplicationInfo,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	OutputDeviceChange,
	OutputDevicesResult,
	Channel,
	ChannelChange,
	ChannelMix,
	LevelReading,
	Mix,
	OutputTarget,
	ReadyInfo,
} from "./types";

const DEFAULT_ORIGIN = "streamdeck://";
const MIN_PORT = 1884;
const MAX_PORT = 1893;
const PACKAGE_FAMILY = "Elgato.WaveLink_g54w8ztgkx496";

export interface WaveLinkClientOptions {
	host?: string;
	origin?: string;
	/** Explicit ports skip `ws-info.json`. Used by tests. */
	ports?: number[];
	wsInfoPath?: string;
	reconnectDelayMs?: number;
	handshakeTimeoutMs?: number;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

/**
 * JSON-RPC client for the local Wave Link WebSocket.
 * The port is read from Wave Link's `ws-info.json`, with 1884–1893 as a fallback.
 */
export class WaveLinkClient extends EventEmitter {
	private readonly host: string;
	private readonly origin: string;
	private readonly portsOverride: number[] | undefined;
	private readonly wsInfoPath: string | undefined;
	private readonly reconnectDelayMs: number;
	private readonly handshakeTimeoutMs: number;

	private socket: WebSocket | undefined;
	private nextId = 0;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly queuedNotifications: JsonRpcNotification[] = [];
	private ready = false;
	private stopped = false;
	private connecting = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: WaveLinkClientOptions = {}) {
		super();
		this.host = options.host ?? "127.0.0.1";
		this.origin = options.origin ?? DEFAULT_ORIGIN;
		this.portsOverride = options.ports;
		this.wsInfoPath = options.wsInfoPath ?? defaultWsInfoPath();
		this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
		this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 1500;
	}

	start(): void {
		this.stopped = false;
		void this.ensureConnected();
	}

	stop(): void {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}

		this.socket?.close();
		this.socket = undefined;
		this.ready = false;
		this.rejectAll(new Error("Wave Link client stopped"));
	}

	async setMainOutput(target: OutputTarget): Promise<void> {
		await this.call("setOutputDevice", {
			mainOutput: {
				outputDeviceId: target.outputDeviceId,
				outputId: target.outputId,
			},
		});
	}

	async setOutputLevel(deviceId: string, outputId: string, level: number): Promise<void> {
		await this.call("setOutputDevice", {
			outputDevice: {
				id: deviceId,
				outputs: [{ id: outputId, level }],
			},
		});
	}

	/** Point one output at a mix. Wave Link keeps the rest of that output. */
	async setOutputMix(deviceId: string, outputId: string, mixId: string): Promise<void> {
		await this.call("setOutputDevice", {
			outputDevice: {
				id: deviceId,
				outputs: [{ id: outputId, mixId }],
			},
		});
	}

	async getMixes(): Promise<Mix[]> {
		return readMixes(await this.call("getMixes"));
	}

	async getChannels(): Promise<Channel[]> {
		return readChannels(await this.call("getChannels"));
	}

	/** Mute or unmute one channel inside one mix. Other mixes and the master level stay as they are. */
	async setChannelMixMute(channelId: string, mixId: string, isMuted: boolean): Promise<void> {
		await this.call("setChannel", {
			id: channelId,
			mixes: [{ id: mixId, isMuted }],
		});
	}

	async refreshOutputs(): Promise<OutputDevicesResult> {
		return this.call<OutputDevicesResult>("getOutputDevices");
	}

	async setLevelMeterSubscription(id: string, enabled: boolean, subId?: string): Promise<void> {
		const levelMeterChanged: {
			id: string;
			isEnabled: boolean;
			type: "output";
			subId?: string;
		} = {
			id,
			isEnabled: enabled,
			type: "output",
		};

		if (subId) {
			levelMeterChanged.subId = subId;
		}

		await this.call("setSubscription", { levelMeterChanged });
	}

	private async ensureConnected(): Promise<void> {
		if (this.stopped || this.connecting || this.ready) {
			return;
		}

		this.connecting = true;
		try {
			await this.connectOnce();
		} catch (error) {
			this.emit("error", error instanceof Error ? error : new Error(String(error)));
			this.scheduleReconnect();
		} finally {
			this.connecting = false;
		}
	}

	private async connectOnce(): Promise<void> {
		const ports = this.resolvePorts();
		let lastError: Error | undefined;

		for (const port of ports) {
			try {
				await this.openPort(port);
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}
		}

		throw lastError ?? new Error("Wave Link is not running");
	}

	private resolvePorts(): number[] {
		if (this.portsOverride && this.portsOverride.length > 0) {
			return this.portsOverride;
		}

		const advertised = this.wsInfoPath ? readWsInfoPort(this.wsInfoPath) : undefined;
		if (advertised) {
			return [advertised];
		}

		return Array.from({ length: MAX_PORT - MIN_PORT + 1 }, (_, index) => MIN_PORT + index);
	}

	private openPort(port: number): Promise<void> {
		const socket = new WebSocket(`ws://${this.host}:${port}`, {
			origin: this.origin,
			handshakeTimeout: this.handshakeTimeoutMs,
		});

		return new Promise<void>((resolve, reject) => {
			const fail = (error: Error) => {
				socket.removeListener("open", onOpen);
				reject(error);
				if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
					socket.close();
				}
			};

			const onOpen = () => {
				socket.removeListener("error", onError);
				resolve();
			};

			const onError = (error: Error) => {
				fail(error);
			};

			socket.once("open", onOpen);
			socket.once("error", onError);
		}).then(async () => {
			this.attachSocket(socket);
			try {
				const application = await this.call<ApplicationInfo>("getApplicationInfo");
				if (application.appID !== "EWL" || application.interfaceRevision < 1) {
					throw new Error(`Unexpected Wave Link API (${application.appID || "unknown"})`);
				}

				const outputs = await this.call<OutputDevicesResult>("getOutputDevices");
				this.ready = true;
				const readyInfo: ReadyInfo = { application, outputs };
				this.emit("ready", readyInfo);
				this.flushNotifications();
			} catch (error) {
				socket.close();
				throw error;
			}
		});
	}

	private attachSocket(socket: WebSocket): void {
		this.socket = socket;
		this.ready = false;
		this.queuedNotifications.length = 0;

		socket.on("message", (data) => {
			this.handleMessage(String(data));
		});

		socket.on("close", () => {
			if (this.socket !== socket) {
				return;
			}

			this.socket = undefined;
			const wasReady = this.ready;
			this.ready = false;
			this.rejectAll(new Error("Wave Link connection closed"));
			if (wasReady) {
				this.emit("disconnected");
			}

			if (wasReady && !this.stopped) {
				this.scheduleReconnect();
			}
		});

		socket.on("error", (error) => {
			this.emit("error", error);
		});
	}

	private handleMessage(raw: string): void {
		let message: JsonRpcResponse | JsonRpcNotification;
		try {
			message = JSON.parse(raw) as JsonRpcResponse | JsonRpcNotification;
		} catch (error) {
			this.emit("error", error instanceof Error ? error : new Error(String(error)));
			return;
		}

		if ("id" in message && message.id !== undefined) {
			const pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}

			this.pending.delete(message.id);
			if (message.error) {
				pending.reject(new Error(message.error.message || "Wave Link request failed"));
			} else {
				pending.resolve(message.result);
			}
			return;
		}

		if (!("method" in message) || !message.method) {
			return;
		}

		if (!this.ready) {
			this.queuedNotifications.push(message);
			return;
		}

		this.emitNotification(message);
	}

	private flushNotifications(): void {
		const queued = this.queuedNotifications.splice(0);
		for (const notification of queued) {
			this.emitNotification(notification);
		}
	}

	private emitNotification(notification: JsonRpcNotification): void {
		if (notification.method === "outputDevicesChanged") {
			this.emit("outputDevicesChanged", notification.params as OutputDevicesResult);
			return;
		}

		if (notification.method === "outputDeviceChanged") {
			this.emit("outputDeviceChanged", notification.params as OutputDeviceChange);
			return;
		}

		if (notification.method === "levelMeterChanged") {
			this.emit("levelMeterChanged", readOutputMeters(notification.params));
			return;
		}

		if (notification.method === "mixesChanged") {
			this.emit("mixesChanged", readMixes(notification.params));
			return;
		}

		if (notification.method === "channelsChanged") {
			this.emit("channelsChanged", readChannels(notification.params));
			return;
		}

		if (notification.method === "channelChanged") {
			const change = readChannelChange(notification.params);
			if (change) {
				this.emit("channelChanged", change);
			}
		}
	}

	private call<T>(method: string, params?: unknown): Promise<T> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error("Not connected to Wave Link"));
		}

		const id = ++this.nextId;
		const request: JsonRpcRequest = {
			id,
			jsonrpc: "2.0",
			method,
		};

		if (params !== undefined) {
			request.params = params;
		}

		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Wave Link request timed out: ${method}`));
			}, 10_000);

			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timeout);
					resolve(value as T);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});

			socket.send(JSON.stringify(request));
		});
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
		this.queuedNotifications.length = 0;
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) {
			return;
		}

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.ensureConnected();
		}, this.reconnectDelayMs);
	}
}

export function defaultWsInfoPath(): string | undefined {
	if (process.platform !== "win32" || !process.env.LOCALAPPDATA) {
		return undefined;
	}

	return join(process.env.LOCALAPPDATA, "Packages", PACKAGE_FAMILY, "LocalState", "ws-info.json");
}

export function readChannels(params: unknown): Channel[] {
	if (!params || typeof params !== "object" || !("channels" in params) || !Array.isArray(params.channels)) {
		return [];
	}

	const channels: Channel[] = [];
	for (const entry of params.channels) {
		const channel = readChannel(entry);
		if (channel) {
			channels.push(channel);
		}
	}

	return channels;
}

export function readChannelChange(params: unknown): ChannelChange | undefined {
	if (!params || typeof params !== "object" || !("id" in params) || typeof params.id !== "string" || params.id.length === 0) {
		return undefined;
	}

	const change: ChannelChange = { id: params.id };
	if ("name" in params && typeof params.name === "string") {
		change.name = params.name;
	}
	if ("level" in params && typeof params.level === "number") {
		change.level = params.level;
	}
	if ("isMuted" in params && typeof params.isMuted === "boolean") {
		change.isMuted = params.isMuted;
	}
	if ("mixes" in params && Array.isArray(params.mixes)) {
		change.mixes = params.mixes.flatMap((entry) => {
			if (!entry || typeof entry !== "object" || !("id" in entry) || typeof entry.id !== "string" || entry.id.length === 0) {
				return [];
			}
			const mix: Partial<ChannelMix> & { id: string } = { id: entry.id };
			if ("level" in entry && typeof entry.level === "number") {
				mix.level = entry.level;
			}
			if ("isMuted" in entry && typeof entry.isMuted === "boolean") {
				mix.isMuted = entry.isMuted;
			}
			return [mix];
		});
	}

	return change;
}

function readChannel(entry: unknown): Channel | undefined {
	if (!entry || typeof entry !== "object" || !("id" in entry) || typeof entry.id !== "string" || entry.id.length === 0) {
		return undefined;
	}

	const name = "name" in entry && typeof entry.name === "string" ? entry.name : "";
	const level = "level" in entry && typeof entry.level === "number" ? entry.level : 0;
	const isMuted = "isMuted" in entry && typeof entry.isMuted === "boolean" ? entry.isMuted : false;
	const mixes = "mixes" in entry && Array.isArray(entry.mixes) ? entry.mixes.flatMap(readChannelMix) : [];

	return { id: entry.id, name, level, isMuted, mixes };
}

function readChannelMix(entry: unknown): ChannelMix[] {
	if (!entry || typeof entry !== "object" || !("id" in entry) || typeof entry.id !== "string" || entry.id.length === 0) {
		return [];
	}

	const level = "level" in entry && typeof entry.level === "number" ? entry.level : 0;
	const isMuted = "isMuted" in entry && typeof entry.isMuted === "boolean" ? entry.isMuted : false;
	return [{ id: entry.id, level, isMuted }];
}

export function readMixes(params: unknown): Mix[] {
	if (!params || typeof params !== "object" || !("mixes" in params) || !Array.isArray(params.mixes)) {
		return [];
	}

	const mixes: Mix[] = [];
	for (const entry of params.mixes) {
		if (!entry || typeof entry !== "object" || !("id" in entry) || typeof entry.id !== "string" || entry.id.length === 0) {
			continue;
		}

		const name = "name" in entry && typeof entry.name === "string" ? entry.name : "";
		mixes.push({ id: entry.id, name });
	}

	return mixes;
}

export function readOutputMeters(params: unknown): LevelReading[] {
	if (!params || typeof params !== "object" || !("outputDevices" in params)) {
		return [];
	}

	const outputDevices = params.outputDevices;
	if (!Array.isArray(outputDevices)) {
		return [];
	}

	const readings: LevelReading[] = [];
	for (const entry of outputDevices) {
		if (!entry || typeof entry !== "object" || !("id" in entry) || typeof entry.id !== "string") {
			continue;
		}

		const subId = "subId" in entry && typeof entry.subId === "string" && entry.subId.length > 0 ? entry.subId : undefined;
		readings.push({
			id: entry.id,
			subId,
			levelLeftPercentage: numberField(entry, "levelLeftPercentage"),
			levelRightPercentage: numberField(entry, "levelRightPercentage"),
		});
	}

	return readings;
}

function numberField(entry: object, key: string): number {
	const value = (entry as Record<string, unknown>)[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readWsInfoPort(filePath: string): number | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { port?: unknown };
		return typeof parsed.port === "number" && parsed.port > 0 ? parsed.port : undefined;
	} catch {
		return undefined;
	}
}
