import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
import { displayName } from "../wavelink/selection";
import type { ChannelMuteSettings, WaveLinkSession } from "../wavelink/session";

const iconDir = join(dirname(fileURLToPath(import.meta.url)), "../imgs/actions/system-chat");
const MUTED_SVG = readFileSync(join(iconDir, "icon.svg"), "utf8");
const HEARD_SVG = readFileSync(join(iconDir, "icon-on.svg"), "utf8");
const ERROR_SVG = readFileSync(join(iconDir, "icon-error.svg"), "utf8");

const CHANNEL_MUTE_UUID = "com.matt.better-audio.system-chat";

/**
 * Mutes or unmutes one Wave Link channel inside one mix.
 * An unconfigured key starts on System and Chat Mix.
 */
@action({ UUID: CHANNEL_MUTE_UUID })
export class SystemChatAction extends SingletonAction<ChannelMuteSettings> {
	private readonly keys = new Map<string, KeyAction<ChannelMuteSettings>>();
	private readonly settings = new Map<string, ChannelMuteSettings>();
	private readonly shown = new Map<string, string>();

	constructor(private readonly session: WaveLinkSession) {
		super();
		this.session.state.onChange((kind) => {
			if (kind === "meter") {
				return;
			}

			void this.renderAll();
			if (kind === "devices" || kind === "channels") {
				this.publishLists();
			}
		});
	}

	override async onWillAppear(ev: WillAppearEvent<ChannelMuteSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		this.keys.set(ev.action.id, ev.action);
		this.settings.set(ev.action.id, ev.payload.settings);
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<ChannelMuteSettings>): void {
		this.keys.delete(ev.action.id);
		this.settings.delete(ev.action.id);
		this.shown.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ChannelMuteSettings>): Promise<void> {
		this.settings.set(ev.action.id, ev.payload.settings);
		if (ev.action.isKey()) {
			await this.render(ev.action);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<ChannelMuteSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		try {
			const settings = await this.ensureDefaults(ev.action);
			const switched = await this.session.toggleChannelMute(settings);
			if (!switched) {
				await ev.action.showAlert();
			}
		} catch {
			await ev.action.showAlert();
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, ChannelMuteSettings>): Promise<void> {
		if (!isChannelMuteDataSource(ev.payload)) {
			return;
		}

		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishLists(settings);
	}

	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<ChannelMuteSettings>): Promise<void> {
		const settings = await ev.action.getSettings();
		this.settings.set(ev.action.id, settings);
		this.publishLists(settings);
	}

	private publishLists(settings?: ChannelMuteSettings): void {
		const visible = streamDeck.ui.action;
		if (visible && visible.manifestId !== CHANNEL_MUTE_UUID) {
			return;
		}

		const current = settings ?? currentInspectorSettings(this.keys, this.settings);
		void streamDeck.ui
			.sendToPropertyInspector({
				event: "getChannels",
				items: this.session.channelItems(current.channel),
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

	private async render(key: KeyAction<ChannelMuteSettings>): Promise<void> {
		const settings = await this.ensureDefaults(key);
		const view = channelMuteView(this.session, settings);
		const shown = `${view.title}:${view.state}:${view.image}`;
		if (this.shown.get(key.id) === shown) {
			return;
		}

		await key.setTitle(view.title);
		await key.setState(view.state);
		await key.setImage(view.image);
		this.shown.set(key.id, shown);
	}

	private async ensureDefaults(key: KeyAction<ChannelMuteSettings>): Promise<ChannelMuteSettings> {
		const settings: ChannelMuteSettings = { ...(this.settings.get(key.id) ?? {}) };
		let changed = false;

		if (!settings.channel) {
			const channel = this.session.resolveChannel(undefined);
			if (channel) {
				settings.channel = channel.id;
				changed = true;
			}
		}

		if (!settings.mix) {
			const mix = this.session.resolveMix(undefined);
			if (mix) {
				settings.mix = mix.id;
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

function channelMuteView(session: WaveLinkSession, settings: ChannelMuteSettings): KeyFace {
	if (!session.state.connected) {
		return { title: "Offline", state: 0, image: "" };
	}

	const channel = session.resolveChannel(settings.channel);
	const mix = session.resolveMix(settings.mix);
	if (!channel) {
		return { title: "Channel", state: 0, image: "" };
	}
	if (!mix) {
		return { title: "Mix", state: 0, image: "" };
	}

	const muted = session.state.channelMixMute(channel.id, mix.id);
	let glyph = HEARD_SVG;
	if (muted === undefined) {
		glyph = ERROR_SVG;
	} else if (muted) {
		glyph = MUTED_SVG;
	}
	return {
		title: "",
		state: muted === false ? 1 : 0,
		image: svgDataUri(withLabels(glyph, channel.name, mix.name)),
	};
}

interface KeyFace {
	title: string;
	state: 0 | 1;
	image: string;
}

function withLabels(svg: string, channelName: string, mixName: string): string {
	const channel = label(channelName, 22);
	const mix = label(mixName, 134);
	return svg.replace("</svg>", `${channel}${mix}</svg>`);
}

function label(name: string, y: number): string {
	const text = escapeXml(displayName(name));
	const size = fitSize(text);
	return `<text x="72" y="${y}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="${size}">${text}</text>`;
}

/** Shrink the label until it fits the key, leaving a margin at each edge. */
function fitSize(text: string): number {
	const maxWidth = 128;
	let size = 20;
	while (size > 11 && text.length * size * 0.62 > maxWidth) {
		size -= 1;
	}
	return size;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&apos;";
		}
	});
}

function svgDataUri(svg: string): string {
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

function isChannelMuteDataSource(payload: JsonValue): boolean {
	if (typeof payload !== "object" || payload === null || !("event" in payload)) {
		return false;
	}

	return payload.event === "getChannels" || payload.event === "getMixes";
}

function currentInspectorSettings(
	keys: Map<string, KeyAction<ChannelMuteSettings>>,
	settings: Map<string, ChannelMuteSettings>,
): ChannelMuteSettings {
	const currentId = streamDeck.ui.action?.id;
	if (currentId && settings.has(currentId)) {
		return settings.get(currentId) ?? {};
	}

	const firstId = keys.keys().next().value;
	return (firstId && settings.get(firstId)) || {};
}
