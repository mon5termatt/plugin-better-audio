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
import type { RouteSettings, WaveLinkSession } from "../wavelink/session";

const ROUTE_MIX_UUID = "com.matt.better-audio.route-mix";

/**
 * Key that switches one Wave Link output between two mixes.
 * The title is the mix that output is routed to right now.
 */
@action({ UUID: ROUTE_MIX_UUID })
export class RouteMixAction extends SingletonAction<RouteSettings> {
	private readonly keys = new Map<string, KeyAction<RouteSettings>>();
	private readonly settings = new Map<string, RouteSettings>();
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

	override async onWillAppear(ev: WillAppearEvent<RouteSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		this.keys.set(ev.action.id, ev.action);
		this.settings.set(ev.action.id, ev.payload.settings);
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<RouteSettings>): void {
		this.keys.delete(ev.action.id);
		this.settings.delete(ev.action.id);
		this.shown.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<RouteSettings>): Promise<void> {
		this.settings.set(ev.action.id, ev.payload.settings);
		if (ev.action.isKey()) {
			await this.render(ev.action);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<RouteSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		try {
			const settings = await this.ensureDefaults(ev.action);
			const switched = await this.session.toggleRoute(settings);
			if (!switched) {
				await ev.action.showAlert();
			}
		} catch {
			await ev.action.showAlert();
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, RouteSettings>): Promise<void> {
		if (!isRouteDataSource(ev.payload)) {
			return;
		}

		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishLists(settings);
	}

	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<RouteSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishLists(settings);
	}

	private publishLists(settings?: RouteSettings): void {
		const visible = streamDeck.ui.action;
		if (visible && visible.manifestId !== ROUTE_MIX_UUID) {
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
				items: this.session.mixItems(current.mixA, current.mixB),
			} satisfies DataSourcePayload)
			.catch(() => undefined);
	}

	private async renderAll(): Promise<void> {
		await Promise.all([...this.keys.values()].map((key) => this.render(key)));
	}

	private async render(key: KeyAction<RouteSettings>): Promise<void> {
		const settings = await this.ensureDefaults(key);
		const title = routeTitle(this.session, settings);
		const state = routeState(this.session, settings);
		const shown = `${title}:${state}`;
		if (this.shown.get(key.id) === shown) {
			return;
		}

		await Promise.all([key.setTitle(title), key.setState(state)]);
		this.shown.set(key.id, shown);
	}

	/** Fill an unconfigured key with the live main output and the first two mixes. */
	private async ensureDefaults(key: KeyAction<RouteSettings>): Promise<RouteSettings> {
		const settings: RouteSettings = { ...(this.settings.get(key.id) ?? {}) };
		let changed = false;

		if (!settings.output) {
			settings.output = MAIN_OUTPUT_ROUTE;
			changed = true;
		}

		const mixes = this.session.state.mixes;
		if (!settings.mixA && mixes[0]) {
			settings.mixA = mixes[0].id;
			changed = true;
		}

		if (!settings.mixB) {
			const other = mixes.find((mix) => mix.id !== settings.mixA);
			if (other) {
				settings.mixB = other.id;
				changed = true;
			}
		}

		if (changed) {
			this.settings.set(key.id, settings);
			await key.setSettings(settings);
		}

		return settings;
	}
}

function routeTitle(session: WaveLinkSession, settings: RouteSettings): string {
	if (!session.state.connected) {
		return "Offline";
	}

	const target = routeTarget(settings.output, session.state.currentTarget());
	const output = target ? session.state.findOutput(target.outputDeviceId, target.outputId) : undefined;
	if (!output) {
		return "No output";
	}

	if (!output.mixId) {
		return "No mix";
	}

	return session.state.mixName(output.mixId) || "Mix";
}

function routeState(session: WaveLinkSession, settings: RouteSettings): 0 | 1 {
	const target = routeTarget(settings.output, session.state.currentTarget());
	const output = target ? session.state.findOutput(target.outputDeviceId, target.outputId) : undefined;
	return output?.mixId && settings.mixB && output.mixId === settings.mixB ? 1 : 0;
}

function isRouteDataSource(payload: JsonValue): boolean {
	if (typeof payload !== "object" || payload === null || !("event" in payload)) {
		return false;
	}

	return payload.event === "getOutputs" || payload.event === "getMixes";
}

function currentInspectorSettings(
	keys: Map<string, KeyAction<RouteSettings>>,
	settings: Map<string, RouteSettings>,
): RouteSettings {
	const currentId = streamDeck.ui.action?.id;
	if (currentId && settings.has(currentId)) {
		return settings.get(currentId) ?? {};
	}

	const firstId = keys.keys().next().value;
	return (firstId && settings.get(firstId)) || {};
}
