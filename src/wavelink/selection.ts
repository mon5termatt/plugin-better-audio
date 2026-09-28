import type { OutputTarget } from "./types";

export const OUTPUT_SEPARATOR = "|";

/** Property-inspector value that follows whichever output Wave Link is using. */
export const MAIN_OUTPUT_ROUTE = "main";

export type MeterStyle = "arc" | "bars";

/** Arc is the default. Stereo bars are chosen in the property inspector. */
export function meterStyle(value: unknown): MeterStyle {
	return value === "bars" ? "bars" : "arc";
}

export function meterLayout(style: MeterStyle): string {
	return style === "bars" ? "layouts/main-output-bars.json" : "layouts/main-output.json";
}

/** Percent added or removed for one dial tick. Each output can use 1–10. */
export function volumeStepPercent(value: unknown): number {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 1;
	if (!Number.isFinite(parsed)) {
		return 1;
	}

	return Math.min(10, Math.max(1, Math.round(parsed)));
}

/**
 * Step for whichever configured output is live. A third device uses the old shared step.
 */
export function stepForTarget(
	current: OutputTarget | undefined,
	outputA: OutputTarget | undefined,
	outputB: OutputTarget | undefined,
	stepA: unknown,
	stepB: unknown,
	fallback: unknown,
): number {
	if (sameTarget(current, outputA)) {
		return volumeStepPercent(stepA ?? fallback);
	}

	if (sameTarget(current, outputB)) {
		return volumeStepPercent(stepB ?? fallback);
	}

	return volumeStepPercent(fallback);
}

/**
 * Move the 0–1 output level by `ticks` times the configured percent step.
 */
export function stepLevel(level: number, ticks: number, stepPercent = 1): number {
	const next = level + ticks * (volumeStepPercent(stepPercent) / 100);
	return Math.round(Math.min(1, Math.max(0, next)) * 1000) / 1000;
}

export function sameTarget(left: OutputTarget | undefined, right: OutputTarget | undefined): boolean {
	if (!left || !right) {
		return false;
	}

	return left.outputDeviceId === right.outputDeviceId && left.outputId === right.outputId;
}

/**
 * A → B, B → A. When the live main output is neither configured device, choose A.
 * Returns undefined when there is nowhere new to go.
 */
export function chooseNextOutput(
	current: OutputTarget | undefined,
	outputA: OutputTarget | undefined,
	outputB: OutputTarget | undefined,
): OutputTarget | undefined {
	if (!outputA && !outputB) {
		return undefined;
	}

	if (!outputA) {
		return sameTarget(current, outputB) ? undefined : outputB;
	}

	if (!outputB) {
		return sameTarget(current, outputA) ? undefined : outputA;
	}

	if (sameTarget(current, outputA)) {
		return outputB;
	}

	if (sameTarget(current, outputB)) {
		return outputA;
	}

	return outputA;
}

/**
 * On when the output is already on this mix, off otherwise.
 * Off sends an empty mix id, which Wave Link uses to restore the previous mix.
 * Returns undefined when no mix is configured.
 */
export function toggledMixId(currentMixId: string | undefined, mixId: unknown): string | undefined {
	const mix = mixSetting(mixId);
	if (!mix) {
		return undefined;
	}

	return currentMixId === mix ? "" : mix;
}

/**
 * Mix A → mix B, mix B → mix A. When the output is on neither mix, choose A.
 * Returns undefined when the output is already on the only configured mix.
 */
export function chooseNextMix(currentMixId: string | undefined, mixA: unknown, mixB: unknown): string | undefined {
	const nextA = mixSetting(mixA);
	const nextB = mixSetting(mixB);
	const current = currentMixId || undefined;

	if (!nextA && !nextB) {
		return undefined;
	}

	if (!nextA) {
		return current === nextB ? undefined : nextB;
	}

	if (!nextB || nextA === nextB) {
		return current === nextA ? undefined : nextA;
	}

	if (current === nextA) {
		return nextB;
	}

	if (current === nextB) {
		return nextA;
	}

	return nextA;
}

/** `main` follows the live main output. Anything else is a saved output id. */
export function routeTarget(setting: unknown, main: OutputTarget | undefined): OutputTarget | undefined {
	if (setting === undefined || setting === "" || setting === MAIN_OUTPUT_ROUTE) {
		return main;
	}

	return decodeOutput(setting);
}

function mixSetting(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function encodeOutput(target: OutputTarget): string {
	return `${target.outputDeviceId}${OUTPUT_SEPARATOR}${target.outputId}`;
}

export function decodeOutput(value: unknown): OutputTarget | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}

	const index = value.indexOf(OUTPUT_SEPARATOR);
	if (index <= 0 || index === value.length - 1) {
		return undefined;
	}

	return {
		outputDeviceId: value.slice(0, index),
		outputId: value.slice(index + 1),
	};
}

export function percentLabel(level: number): string {
	return `${Math.round(level * 100)}%`;
}

export const SYSTEM_CHANNEL_NAME = "System";
export const CHAT_MIX_NAME = "Chat Mix";

/** Mute when the channel is heard in the mix, otherwise unmute. */
export function nextMixMute(isMuted: boolean): boolean {
	return !isMuted;
}

export function displayName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length <= 22) {
		return trimmed || "Output";
	}

	return `${trimmed.slice(0, 21)}…`;
}
