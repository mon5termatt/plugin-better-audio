import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import { WebSocketServer } from "ws";

import { WaveLinkClient } from "./client";
import type { OutputDeviceChange, ReadyInfo } from "./types";

describe("WaveLinkClient", () => {
	it("handshakes with the Wave Link origin and sends main-output commands", async () => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Test server has no port");
		}

		const received: Array<{ method: string; params?: unknown; origin?: string }> = [];
		server.on("connection", (socket, request) => {
			socket.on("message", (data) => {
				const message = JSON.parse(String(data)) as { id: number; method: string; params?: unknown };
				received.push({ method: message.method, params: message.params, origin: request.headers.origin });

				if (message.method === "getApplicationInfo") {
					socket.send(
						JSON.stringify({
							jsonrpc: "2.0",
							id: message.id,
							result: { appID: "EWL", name: "Elgato Wave Link", interfaceRevision: 2 },
						}),
					);
					return;
				}

				if (message.method === "getOutputDevices") {
					socket.send(
						JSON.stringify({
							jsonrpc: "2.0",
							id: message.id,
							result: {
								mainOutput: { outputDeviceId: "speakers", outputId: "speakers-out" },
								outputDevices: [
									{
										id: "speakers",
										name: "Speakers",
										deviceType: "thirdParty",
										outputs: [{ id: "speakers-out", name: "Speakers", level: 0.2, isMuted: false, mixId: "" }],
									},
								],
							},
						}),
					);
					return;
				}

				socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: message.params ?? {} }));
			});
		});

		const client = new WaveLinkClient({
			ports: [address.port],
			reconnectDelayMs: 50,
		});
		const ready = once(client, "ready");
		client.start();
		const [info] = (await ready) as [ReadyInfo];

		assert.equal(info.application.interfaceRevision, 2);
		assert.equal(info.outputs.mainOutput.outputDeviceId, "speakers");
		assert.equal(received[0]?.origin, "streamdeck://");
		assert.deepEqual(
			received.map((message) => message.method),
			["getApplicationInfo", "getOutputDevices"],
		);

		const changed = once(client, "outputDeviceChanged");
		const socket = [...server.clients][0];
		socket?.send(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "outputDeviceChanged",
				params: { id: "speakers", outputs: [{ id: "speakers-out", level: 0.4 }] },
			}),
		);
		const [change] = (await changed) as [OutputDeviceChange];
		assert.equal(change.outputs?.[0]?.level, 0.4);

		const meters = once(client, "levelMeterChanged");
		socket?.send(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "levelMeterChanged",
				params: {
					outputDevices: [{ id: "speakers", levelLeftPercentage: 0.33, levelRightPercentage: 0.2 }],
				},
			}),
		);
		const [readings] = (await meters) as [Array<{ id: string; levelLeftPercentage: number }>];
		assert.equal(readings[0]?.levelLeftPercentage, 0.33);

		await client.setLevelMeterSubscription("speakers", true);
		await client.setMainOutput({ outputDeviceId: "headphones", outputId: "headphones-out" });
		await client.setOutputLevel("speakers", "speakers-out", 0.67);

		assert.deepEqual(received.at(-3)?.params, {
			levelMeterChanged: { id: "speakers", isEnabled: true, type: "output" },
		});
		assert.deepEqual(received.at(-2)?.params, {
			mainOutput: { outputDeviceId: "headphones", outputId: "headphones-out" },
		});
		assert.deepEqual(received.at(-1)?.params, {
			outputDevice: {
				id: "speakers",
				outputs: [{ id: "speakers-out", level: 0.67 }],
			},
		});

		const mixes = once(client, "mixesChanged");
		socket?.send(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "mixesChanged",
				params: {
					mixes: [
						{ id: "personal", name: "Personal Mix" },
						{ id: "", name: "skip" },
					],
				},
			}),
		);
		const [mixList] = (await mixes) as [Array<{ id: string; name: string }>];
		assert.deepEqual(mixList, [{ id: "personal", name: "Personal Mix" }]);

		await client.setOutputMix("speakers", "speakers-out", "personal");
		await client.setOutputMix("speakers", "speakers-out", "");
		assert.deepEqual(received.at(-2)?.params, {
			outputDevice: {
				id: "speakers",
				outputs: [{ id: "speakers-out", mixId: "personal" }],
			},
		});
		assert.deepEqual(received.at(-1)?.params, {
			outputDevice: {
				id: "speakers",
				outputs: [{ id: "speakers-out", mixId: "" }],
			},
		});

		const channels = once(client, "channelsChanged");
		socket?.send(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "channelsChanged",
				params: {
					channels: [
						{
							id: "system",
							name: "System",
							level: 1,
							isMuted: false,
							mixes: [{ id: "chat", level: 0.4, isMuted: false }],
						},
					],
				},
			}),
		);
		const [channelList] = (await channels) as [Array<{ id: string; mixes: Array<{ level: number }> }>];
		assert.equal(channelList[0]?.id, "system");
		assert.equal(channelList[0]?.mixes[0]?.level, 0.4);

		const channelUpdate = once(client, "channelChanged");
		socket?.send(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "channelChanged",
				params: { id: "system", mixes: [{ id: "chat", isMuted: true }] },
			}),
		);
		const [channelChange] = (await channelUpdate) as [{ mixes?: Array<{ isMuted?: boolean }> }];
		assert.equal(
			(channelChange as { mixes?: Array<{ isMuted?: boolean }> }).mixes?.[0]?.isMuted,
			true,
		);

		await client.setChannelMixMute("system", "chat", true);
		assert.deepEqual(received.at(-1)?.params, {
			id: "system",
			mixes: [{ id: "chat", isMuted: true }],
		});

		client.stop();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});
});
