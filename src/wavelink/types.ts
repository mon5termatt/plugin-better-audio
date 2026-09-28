export interface JsonRpcRequest {
	id: number;
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
	};
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export interface ApplicationInfo {
	appID: string;
	name: string;
	interfaceRevision: number;
	version?: string;
	build?: number;
	operatingSystem?: string;
}

export type DeviceType = "thirdParty" | "commonWave" | "waveXLRPro" | (string & {});

export interface Mix {
	id: string;
	name: string;
}

export interface ChannelMix {
	id: string;
	level: number;
	isMuted: boolean;
}

export interface Channel {
	id: string;
	name: string;
	level: number;
	isMuted: boolean;
	mixes: ChannelMix[];
}

/** Partial `channelChanged` payload. Only changed fields are present. */
export interface ChannelChange {
	id: string;
	name?: string;
	level?: number;
	isMuted?: boolean;
	mixes?: Array<Partial<ChannelMix> & { id: string }>;
}

export interface Output {
	id: string;
	name: string;
	level: number;
	isMuted: boolean;
	mixId: string;
}

export interface OutputDevice {
	id: string;
	name: string;
	deviceType: DeviceType;
	outputs: Output[];
}

export interface MainOutput {
	outputDeviceId: string;
	outputId?: string;
}

export interface OutputDevicesResult {
	mainOutput: MainOutput;
	outputDevices: OutputDevice[];
}

export interface OutputTarget {
	outputDeviceId: string;
	outputId: string;
}

export interface ReadyInfo {
	application: ApplicationInfo;
	outputs: OutputDevicesResult;
}

export interface LevelReading {
	id: string;
	subId?: string;
	levelLeftPercentage: number;
	levelRightPercentage: number;
}

/** Partial `outputDeviceChanged` payload. Only changed fields are present. */
export interface OutputDeviceChange {
	id: string;
	name?: string;
	deviceType?: DeviceType;
	outputs?: Array<Partial<Output> & { id: string }>;
}
