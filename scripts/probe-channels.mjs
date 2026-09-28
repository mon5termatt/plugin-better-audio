import { readFileSync } from "node:fs";
import { WebSocket } from "ws";

const SYSTEM = "PCM_OUT_00_V_08_SD5";
const PERSONAL = "PCM_IN_01_V_00_SD1";
const CHAT = "PCM_IN_01_V_02_SD2";

const info = JSON.parse(
	readFileSync(
		`${process.env.LOCALAPPDATA}/Packages/Elgato.WaveLink_g54w8ztgkx496/LocalState/ws-info.json`,
		"utf8",
	),
);
const ws = new WebSocket(`ws://127.0.0.1:${info.port}`, { origin: "streamdeck://", handshakeTimeout: 1500 });
let id = 0;
const pending = new Map();

function call(method, params) {
	const requestId = ++id;
	return new Promise((resolve, reject) => {
		pending.set(requestId, { resolve, reject });
		const message = { id: requestId, jsonrpc: "2.0", method };
		if (params !== undefined) message.params = params;
		ws.send(JSON.stringify(message));
		setTimeout(() => {
			if (pending.has(requestId)) {
				pending.delete(requestId);
				reject(new Error(`timeout ${method}`));
			}
		}, 4000);
	});
}

ws.on("message", (data) => {
	const message = JSON.parse(String(data));
	if (!message.id || !pending.has(message.id)) return;
	const waiter = pending.get(message.id);
	pending.delete(message.id);
	if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
	else waiter.resolve(message.result ?? null);
});

async function mixes() {
	const result = await call("getChannels");
	const channel = result.channels.find((entry) => entry.id === SYSTEM);
	return channel.mixes.map((mix) => mix.id);
}

async function tryPayload(label, params) {
	const before = await mixes();
	try {
		await call("setChannel", params);
	} catch (error) {
		console.log(label, "error", error.message, "still", await mixes());
		return;
	}
	const after = await mixes();
	console.log(label, before.join(","), "->", after.join(","));
	if (after.join(",") !== before.join(",")) {
		await call("setChannel", { id: SYSTEM, mixId: PERSONAL });
		await call("setChannel", { id: SYSTEM, mixes: [{ id: CHAT, isInMix: false }, { id: PERSONAL, isInMix: true }] });
		console.log(label, "restore attempt", (await mixes()).join(","));
	}
}

ws.on("open", async () => {
	try {
		console.log("start", (await mixes()).join(","));
		await tryPayload("mixId", { id: SYSTEM, mixId: CHAT });
		await tryPayload("isInMix", { id: SYSTEM, mixes: [{ id: CHAT, isInMix: true }] });
		await tryPayload("isRouted", { id: SYSTEM, mixes: [{ id: CHAT, isRouted: true }] });
		console.log("end", (await mixes()).join(","));
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	} finally {
		ws.close();
	}
});
