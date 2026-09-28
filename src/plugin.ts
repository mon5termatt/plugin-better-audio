import streamDeck from "@elgato/streamdeck";

import { MainOutputAction } from "./actions/main-output";
import { MixToggleAction } from "./actions/mix-toggle";
import { RouteMixAction } from "./actions/route-mix";
import { SystemChatAction } from "./actions/system-chat";
import { WaveLinkSession } from "./wavelink/session";

const session = new WaveLinkSession();
session.onReady((info) => {
	const output = info.outputs.outputDevices.find((device) => device.id === info.outputs.mainOutput.outputDeviceId);
	streamDeck.logger.info(
		`Connected to ${info.application.name} ${info.application.version ?? ""} (main output: ${output?.name ?? info.outputs.mainOutput.outputDeviceId})`,
	);
});
session.onError((error) => {
	streamDeck.logger.error(error.message);
});

streamDeck.actions.registerAction(new MainOutputAction(session));
streamDeck.actions.registerAction(new RouteMixAction(session));
streamDeck.actions.registerAction(new MixToggleAction(session));
streamDeck.actions.registerAction(new SystemChatAction(session));
streamDeck.connect();
session.start();

streamDeck.devices.onDeviceDidConnect((ev) => {
	streamDeck.logger.info(`Stream Deck connected: ${ev.device.name}`);
});

streamDeck.devices.onDeviceDidDisconnect((ev) => {
	streamDeck.logger.info(`Stream Deck disconnected: ${ev.device.id}`);
});
