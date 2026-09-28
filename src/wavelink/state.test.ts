import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OutputState } from "./state";
import type { OutputDevice } from "./types";

const speakers: OutputDevice = {
	id: "speakers",
	name: "Speakers",
	deviceType: "thirdParty",
	outputs: [
		{
			id: "speakers-out",
			name: "Speakers",
			level: 0.2,
			isMuted: false,
			mixId: "",
		},
	],
};

describe("OutputState", () => {
	it("merges a partial volume notification without dropping the rest of the output", () => {
		const state = new OutputState();
		state.replaceOutputs({ outputDeviceId: "speakers", outputId: "speakers-out" }, [speakers]);

		const known = state.applyDeviceChange({
			id: "speakers",
			name: "Speakers",
			deviceType: "thirdParty",
			outputs: [{ id: "speakers-out", name: "Speakers", level: 0.21 }],
		});

		assert.equal(known, true);
		const details = state.currentDetails();
		assert.equal(details?.level, 0.21);
		assert.equal(details?.isMuted, false);
		assert.equal(details?.name, "Speakers");
	});

	it("asks for a refresh when the device is not cached", () => {
		const state = new OutputState();
		assert.equal(state.applyDeviceChange({ id: "missing", outputs: [{ id: "out", level: 0.4 }] }), false);
	});

	it("keeps the live level meter for the current main output", () => {
		const state = new OutputState();
		state.replaceOutputs({ outputDeviceId: "speakers", outputId: "speakers-out" }, [speakers]);
		state.applyOutputMeters([
			{ id: "speakers", levelLeftPercentage: 0.42, levelRightPercentage: 0.4 },
			{ id: "dock", levelLeftPercentage: 0.1, levelRightPercentage: 0.1 },
		]);

		assert.equal(state.currentMeter(), 0.42);
		assert.deepEqual(state.currentLevels(), { left: 0.42, right: 0.4 });

		state.applyOutputMeters([{ id: "speakers", levelLeftPercentage: 0.42, levelRightPercentage: 0.55 }]);
		assert.equal(state.currentMeter(), 0.55);
		assert.deepEqual(state.currentLevels(), { left: 0.42, right: 0.55 });
	});

	it("uses the Wave XLR Pro output id when matching a level meter", () => {
		const state = new OutputState();
		state.replaceOutputs({ outputDeviceId: "xlr", outputId: "mix-a" }, [
			{
				id: "xlr",
				name: "Wave XLR Pro",
				deviceType: "waveXLRPro",
				outputs: [{ id: "mix-a", name: "Mix A", level: 1, isMuted: false, mixId: "" }],
			},
		]);
		state.applyOutputMeters([
			{ id: "xlr", subId: "mix-b", levelLeftPercentage: 0.9, levelRightPercentage: 0.9 },
			{ id: "xlr", subId: "mix-a", levelLeftPercentage: 0.25, levelRightPercentage: 0.2 },
		]);

		assert.equal(state.currentMeter(), 0.25);
	});

	it("updates one channel mix mute without dropping that mix's level", () => {
		const state = new OutputState();
		state.replaceChannels([
			{
				id: "system",
				name: "System",
				level: 1,
				isMuted: false,
				mixes: [
					{ id: "personal", level: 0.8, isMuted: false },
					{ id: "chat", level: 0.4, isMuted: false },
				],
			},
		]);

		state.applyChannelChange({ id: "system", mixes: [{ id: "chat", isMuted: true }] });

		const channel = state.findChannelByName("System");
		assert.equal(channel?.mixes.find((mix) => mix.id === "personal")?.level, 0.8);
		assert.equal(channel?.mixes.find((mix) => mix.id === "chat")?.level, 0.4);
		assert.equal(channel?.mixes.find((mix) => mix.id === "chat")?.isMuted, true);
		assert.equal(channel?.level, 1);
	});
});
