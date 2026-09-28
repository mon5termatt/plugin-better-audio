import streamDeck, {
	action,
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	type SendToPluginEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { DataSourcePayload } from "../sdpi";
import { MAIN_OUTPUT_ROUTE, routeTarget } from "../wavelink/selection";
import type { MixToggleSettings, WaveLinkSession } from "../wavelink/session";

const MIX_TOGGLE_UUID = "com.matt.better-audio.mix-toggle";

/**
 * Key that turns one mix on or off for an output.
 * Place one key per mix. On routes to that mix; off restores the previous mix.
 */
@action({ UUID: MIX_TOGGLE_UUID })
export class MixToggleAction extends SingletonAction<MixToggleSettings> {
	private readonly keys = new Map<string, KeyAction<MixToggleSettings>>();
	private readonly settings = new Map<string, MixToggleSettings>();
	private readonly shown = new Map<string, string>();

	constructor(private readonly session: WaveLinkSession) {
		super();
		this.session.state.onChange((kind) => {
			if (kind === "meter") {
				return;
			}

			void this.renderAll();
			if (kind === "devices") {
				this.publishLists();
			}
		});
	}

	override async onWillAppear(ev: WillAppearEvent<MixToggleSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		this.keys.set(ev.action.id, ev.action);
		this.settings.set(ev.action.id, ev.payload.settings);
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<MixToggleSettings>): void {
		this.keys.delete(ev.action.id);
		this.settings.delete(ev.action.id);
		this.shown.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MixToggleSettings>): Promise<void> {
		this.settings.set(ev.action.id, ev.payload.settings);
		if (ev.action.isKey()) {
			await this.render(ev.action);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<MixToggleSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		try {
			const settings = await this.ensureOutput(ev.action);
			const switched = await this.session.toggleMix(settings);
			if (!switched) {
				await ev.action.showAlert();
			}
		} catch {
			await ev.action.showAlert();
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, MixToggleSettings>): Promise<void> {
		if (!isMixDataSource(ev.payload)) {
			return;
		}

		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishLists(settings);
	}

	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<MixToggleSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishLists(settings);
	}

	private publishLists(settings?: MixToggleSettings): void {
		const visible = streamDeck.ui.action;
		if (visible && visible.manifestId !== MIX_TOGGLE_UUID) {
			return;
		}

		const current = settings ?? currentInspectorSettings(this.keys, this.settings);
		void streamDeck.ui
			.sendToPropertyInspector({
				event: "getOutputs",
				items: this.session.routeOutputItems(current.output),
			} satisfies DataSourcePayload)
			.catch(() => undefined);
		void streamDeck.ui
			.sendToPropertyInspector({
				event: "getMixes",
				items: this.session.mixItems(current.mix),
			} satisfies DataSourcePayload)
			.catch(() => undefined);
	}

	private async renderAll(): Promise<void> {
		await Promise.all([...this.keys.values()].map((key) => this.render(key)));
	}

	private async render(key: KeyAction<MixToggleSettings>): Promise<void> {
		const settings = await this.ensureOutput(key);
		const title = mixTitle(this.session, settings);
		const state = mixState(this.session, settings);
		const shown = `${title}:${state}`;
		if (this.shown.get(key.id) === shown) {
			return;
		}

		await Promise.all([key.setTitle(title), key.setState(state)]);
		this.shown.set(key.id, shown);
	}

	private async ensureOutput(key: KeyAction<MixToggleSettings>): Promise<MixToggleSettings> {
		const settings: MixToggleSettings = { ...(this.settings.get(key.id) ?? {}) };
		if (settings.output) {
			return settings;
		}

		settings.output = MAIN_OUTPUT_ROUTE;
		this.settings.set(key.id, settings);
		await key.setSettings(settings);
		return settings;
	}
}

function mixTitle(session: WaveLinkSession, settings: MixToggleSettings): string {
	if (!session.state.connected) {
		return "Offline";
	}

	if (!settings.mix) {
		return "Mix";
	}

	const target = routeTarget(settings.output, session.state.currentTarget());
	if (!target || !session.state.findOutput(target.outputDeviceId, target.outputId)) {
		return "No output";
	}

	return session.state.mixName(settings.mix) || "Mix";
}

function mixState(session: WaveLinkSession, settings: MixToggleSettings): 0 | 1 {
	const target = routeTarget(settings.output, session.state.currentTarget());
	const output = target ? session.state.findOutput(target.outputDeviceId, target.outputId) : undefined;
	return output?.mixId && settings.mix && output.mixId === settings.mix ? 1 : 0;
}

function isMixDataSource(payload: JsonValue): boolean {
	if (typeof payload !== "object" || payload === null || !("event" in payload)) {
		return false;
	}

	return payload.event === "getOutputs" || payload.event === "getMixes";
}

function currentInspectorSettings(
	keys: Map<string, KeyAction<MixToggleSettings>>,
	settings: Map<string, MixToggleSettings>,
): MixToggleSettings {
	const currentId = streamDeck.ui.action?.id;
	if (currentId && settings.has(currentId)) {
		return settings.get(currentId) ?? {};
	}

	const firstId = keys.keys().next().value;
	return (firstId && settings.get(firstId)) || {};
}
