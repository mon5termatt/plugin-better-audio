import streamDeck, {
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	type PropertyInspectorDidAppearEvent,
	type SendToPluginEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { DataSourcePayload } from "../sdpi";
import { levelBarImage, levelMeterImage, meterFrame, volumeLineImage, volumeNeedleImage } from "../wavelink/level-meter";
import { decodeOutput, meterLayout, meterStyle, stepForTarget, type MeterStyle } from "../wavelink/selection";
import type { OutputSettings, WaveLinkSession } from "../wavelink/session";

/**
 * Stream Deck Plus dial for the Wave Link main output.
 * Rotate changes that output's volume. Press swaps the two configured outputs.
 */
@action({ UUID: "com.matt.better-audio.main-output" })
export class MainOutputAction extends SingletonAction<OutputSettings> {
	private readonly dials = new Map<string, DialAction<OutputSettings>>();
	private readonly settings = new Map<string, OutputSettings>();
	private readonly laidOut = new Set<string>();
	private readonly meterShown = new Map<string, string>();
	private meterInFlight = false;
	private meterPending = false;

	constructor(private readonly session: WaveLinkSession) {
		super();
		this.session.state.onChange((kind) => {
			if (kind === "meter") {
				this.scheduleMeter();
				return;
			}

			void this.renderAll();
			if (kind === "devices") {
				this.publishOutputs();
			}
		});
		streamDeck.devices.onDeviceDidConnect(() => {
			void this.renderAll();
		});
		streamDeck.devices.onDeviceDidDisconnect(() => {
			void this.renderAll();
		});
		this.session.onFailure(() => {
			for (const dial of this.dials.values()) {
				void dial.showAlert();
			}
		});
	}

	override async onWillAppear(ev: WillAppearEvent<OutputSettings>): Promise<void> {
		const dial = asDial(ev.action);
		if (!dial) {
			return;
		}

		this.dials.set(dial.id, dial);
		this.settings.set(dial.id, ev.payload.settings);
		await dial.setFeedbackLayout(meterLayout(meterStyle(ev.payload.settings.meterStyle)));
		this.laidOut.add(dial.id);
		await this.render(dial);
		this.session.retainLevelMeter();
	}

	override onWillDisappear(ev: WillDisappearEvent<OutputSettings>): void {
		if (this.laidOut.delete(ev.action.id)) {
			this.session.releaseLevelMeter();
		}

		this.dials.delete(ev.action.id);
		this.settings.delete(ev.action.id);
		this.meterShown.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<OutputSettings>): Promise<void> {
		this.settings.set(ev.action.id, ev.payload.settings);
		const dial = this.dials.get(ev.action.id);
		if (!dial || !this.laidOut.has(dial.id)) {
			return;
		}

		this.meterShown.delete(dial.id);
		await dial.setFeedbackLayout(meterLayout(meterStyle(ev.payload.settings.meterStyle)));
		await this.render(dial);
	}

	override async onDialRotate(ev: DialRotateEvent<OutputSettings>): Promise<void> {
		try {
			const settings = ev.payload.settings;
			this.session.adjustCurrentVolume(
				ev.payload.ticks,
				stepForTarget(
					this.session.state.currentTarget(),
					decodeOutput(settings.outputA),
					decodeOutput(settings.outputB),
					settings.stepA,
					settings.stepB,
					settings.volumeStep,
				),
			);
		} catch {
			await ev.action.showAlert();
		}
	}

	override async onDialDown(ev: DialDownEvent<OutputSettings>): Promise<void> {
		try {
			const switched = await this.session.toggle(ev.payload.settings);
			if (!switched) {
				await ev.action.showAlert();
			}
		} catch {
			await this.session.refresh().catch(() => undefined);
			await ev.action.showAlert();
		}
	}

	override async onTouchTap(ev: TouchTapEvent<OutputSettings>): Promise<void> {
		try {
			await this.session.refresh();
		} catch {
			await ev.action.showAlert();
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, OutputSettings>): Promise<void> {
		if (!isDataSourceRequest(ev.payload)) {
			return;
		}

		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishOutputs(settings);
	}

	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<OutputSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishOutputs(settings);
	}

	private publishOutputs(settings?: OutputSettings): void {
		const visible = streamDeck.ui.action;
		if (visible && visible.manifestId !== "com.matt.better-audio.main-output") {
			return;
		}

		const payload: DataSourcePayload = {
			event: "getOutputs",
			items: this.session.outputItems(settings ?? currentInspectorSettings(this.dials, this.settings)),
		};

		void streamDeck.ui.sendToPropertyInspector(payload).catch(() => {
			// The property inspector is not open.
		});
	}

	private async renderAll(): Promise<void> {
		await Promise.all([...this.dials.values()].map((dial) => this.render(dial)));
	}

	private scheduleMeter(): void {
		if (this.meterInFlight) {
			this.meterPending = true;
			return;
		}

		this.meterInFlight = true;
		this.meterPending = false;
		const started = Date.now();
		void this.renderMeters().finally(() => {
			const wait = Math.max(0, 32 - (Date.now() - started));
			setTimeout(() => {
				this.meterInFlight = false;
				if (this.meterPending) {
					this.scheduleMeter();
				}
			}, wait);
		});
	}

	private async renderMeters(): Promise<void> {
		await Promise.all([...this.dials.values()].map((dial) => this.renderMeter(dial)));
	}

	private async renderMeter(dial: DialAction<OutputSettings>): Promise<void> {
		if (!this.laidOut.has(dial.id)) {
			return;
		}

		const style = this.styleFor(dial.id);
		const connected = this.session.state.connected;
		const levels = this.session.state.currentLevels();
		const shown = connected ? shownKey(style, levels.left, levels.right) : "";
		if (this.meterShown.get(dial.id) === shown) {
			return;
		}

		await dial.setFeedback(connected ? liveMeters(style, levels.left, levels.right) : hiddenMeters(style));
		this.meterShown.set(dial.id, shown);
	}

	private async render(dial: DialAction<OutputSettings>): Promise<void> {
		if (!this.laidOut.has(dial.id)) {
			return;
		}

		const style = this.styleFor(dial.id);
		if (!this.session.state.connected) {
			await dial.setFeedback({
				name: "Wave Link offline",
				value: "--",
				unit: { enabled: false },
				...hiddenMeters(style),
			});
			this.meterShown.set(dial.id, "");
			return;
		}

		const current = this.session.state.currentDetails();
		if (!current) {
			await dial.setFeedback({
				name: "No output",
				value: "--",
				unit: { enabled: false },
				...hiddenMeters(style),
			});
			this.meterShown.set(dial.id, "");
			return;
		}

		const levels = this.session.state.currentLevels();
		await dial.setFeedback({
			name: current.name.trim() || "Output",
			value: current.isMuted ? "Mute" : String(Math.round(current.level * 100)),
			unit: { value: "%", enabled: !current.isMuted },
			...liveMeters(style, levels.left, levels.right),
			...(style === "arc"
				? { needle: showNeedle(current.level) }
				: { volumeline: { value: volumeLineImage(current.level), enabled: true as const } }),
		});
		this.meterShown.set(dial.id, shownKey(style, levels.left, levels.right));
	}

	private styleFor(dialId: string): MeterStyle {
		return meterStyle(this.settings.get(dialId)?.meterStyle);
	}
}

function shownKey(style: MeterStyle, left: number, right: number): string {
	if (style === "bars") {
		return `${meterFrame(left)}:${meterFrame(right)}`;
	}

	return String(meterFrame(Math.max(left, right)));
}

function liveMeters(style: MeterStyle, left: number, right: number): Record<string, { value: string; enabled: true }> {
	if (style === "bars") {
		return {
			leftmeter: { value: levelBarImage(left), enabled: true },
			rightmeter: { value: levelBarImage(right), enabled: true },
		};
	}

	return {
		levelmeter: { value: levelMeterImage(Math.max(left, right)), enabled: true },
	};
}

function showNeedle(level: number): { value: string; enabled: true } {
	return { value: volumeNeedleImage(level), enabled: true };
}

function hiddenMeters(style: MeterStyle): Record<string, { enabled: false }> {
	if (style === "bars") {
		return {
			leftmeter: { enabled: false },
			rightmeter: { enabled: false },
			volumeline: { enabled: false },
		};
	}

	return {
		levelmeter: { enabled: false },
		needle: { enabled: false },
	};
}

function asDial(action: WillAppearEvent<OutputSettings>["action"]): DialAction<OutputSettings> | undefined {
	return action.isDial() ? action : undefined;
}

function isDataSourceRequest(payload: JsonValue): boolean {
	return typeof payload === "object" && payload !== null && "event" in payload && payload.event === "getOutputs";
}

function currentInspectorSettings(
	dials: Map<string, DialAction<OutputSettings>>,
	settings: Map<string, OutputSettings>,
): OutputSettings {
	const currentId = streamDeck.ui.action?.id;
	if (currentId && settings.has(currentId)) {
		return settings.get(currentId) ?? {};
	}

	const firstId = dials.keys().next().value;
	return (firstId && settings.get(firstId)) || {};
}
