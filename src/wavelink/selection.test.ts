import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	chooseNextMix,
	chooseNextOutput,
	decodeOutput,
	encodeOutput,
	meterLayout,
	meterStyle,
	nextMixMute,
	stepForTarget,
	stepLevel,
	toggledMixId,
	volumeStepPercent,
} from "./selection";
import type { OutputTarget } from "./types";

const headphones: OutputTarget = { outputDeviceId: "headphones", outputId: "headphones-out" };
const monitors: OutputTarget = { outputDeviceId: "monitors", outputId: "monitors-out" };

describe("stepLevel", () => {
	it("moves one percent per tick and clamps", () => {
		assert.equal(stepLevel(0.67, 1), 0.68);
		assert.equal(stepLevel(0.67, -2), 0.65);
		assert.equal(stepLevel(0.2, 5), 0.25);
		assert.equal(stepLevel(0.99, 5), 1);
		assert.equal(stepLevel(0.01, -5), 0);
	});

	it("uses the configured percent per tick", () => {
		assert.equal(volumeStepPercent(undefined), 1);
		assert.equal(volumeStepPercent("5"), 5);
		assert.equal(volumeStepPercent(40), 10);
		assert.equal(stepLevel(0.67, 1, 5), 0.72);
		assert.equal(stepLevel(0.03, -1, 5), 0);
	});

	it("uses the step saved for the live output", () => {
		assert.equal(stepForTarget(headphones, headphones, monitors, 2, 5, 1), 2);
		assert.equal(stepForTarget(monitors, headphones, monitors, 2, 5, 1), 5);
		assert.equal(stepForTarget(undefined, headphones, monitors, undefined, undefined, 2), 2);
	});
});

describe("meterStyle", () => {
	it("keeps the arc unless stereo bars are selected", () => {
		assert.equal(meterStyle(undefined), "arc");
		assert.equal(meterStyle("arc"), "arc");
		assert.equal(meterStyle("bars"), "bars");
		assert.equal(meterLayout("arc"), "layouts/main-output.json");
		assert.equal(meterLayout("bars"), "layouts/main-output-bars.json");
	});
});

describe("chooseNextOutput", () => {
	it("toggles between the two configured outputs", () => {
		assert.deepEqual(chooseNextOutput(headphones, headphones, monitors), monitors);
		assert.deepEqual(chooseNextOutput(monitors, headphones, monitors), headphones);
	});

	it("selects output A when the live main output is something else", () => {
		assert.deepEqual(chooseNextOutput({ outputDeviceId: "other", outputId: "other" }, headphones, monitors), headphones);
	});

	it("does not switch when the only configured output is already selected", () => {
		assert.equal(chooseNextOutput(headphones, headphones, undefined), undefined);
		assert.equal(chooseNextOutput(undefined, undefined, undefined), undefined);
	});

	it("selects the only configured output when it is not current", () => {
		assert.deepEqual(chooseNextOutput(monitors, headphones, undefined), headphones);
	});
});

describe("chooseNextMix", () => {
	it("switches between the two mixes and falls back to mix A", () => {
		assert.equal(chooseNextMix("personal", "personal", "chat"), "chat");
		assert.equal(chooseNextMix("chat", "personal", "chat"), "personal");
		assert.equal(chooseNextMix("", "personal", "chat"), "personal");
		assert.equal(chooseNextMix("personal", "personal", undefined), undefined);
	});
});

describe("toggledMixId", () => {
	it("routes to the mix, and clears it when that mix is already routed", () => {
		assert.equal(toggledMixId("", "personal"), "personal");
		assert.equal(toggledMixId("chat", "personal"), "personal");
		assert.equal(toggledMixId("personal", "personal"), "");
		assert.equal(toggledMixId("personal", ""), undefined);
	});
});

describe("nextMixMute", () => {
	it("mutes a heard mix and unmutes a muted one", () => {
		assert.equal(nextMixMute(false), true);
		assert.equal(nextMixMute(true), false);
	});
});

describe("output encoding", () => {
	it("round-trips device and output ids", () => {
		const encoded = encodeOutput(headphones);
		assert.equal(encoded, "headphones|headphones-out");
		assert.deepEqual(decodeOutput(encoded), headphones);
	});

	it("keeps Windows endpoint ids intact", () => {
		const target = {
			outputDeviceId: "{0.0.0.00000000}.{9f2fef34-e17a-4a33-84bb-ccf3d24b6fd9}",
			outputId: "{0.0.0.00000000}.{9f2fef34-e17a-4a33-84bb-ccf3d24b6fd9}",
		};
		assert.deepEqual(decodeOutput(encodeOutput(target)), target);
	});
});
