import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { levelBarImage, levelMeterImage, meterFrame, meterStep, volumeLineImage, volumeNeedleImage } from "./level-meter";

describe("level meter artwork", () => {
	it("reveals the arc from silence to full scale", () => {
		assert.equal(meterStep(0), 0);
		assert.equal(meterStep(0.5), 50);
		assert.equal(meterStep(1), 100);
		assert.equal(meterFrame(0.505), 101);
		assert.equal(svg(levelMeterImage(0)).includes("<path"), false);
		assert.match(svg(levelMeterImage(0.5)), /49 2/);
		assert.match(svg(levelMeterImage(1)), /91.6 29.14/);
		assert.match(svg(levelMeterImage(1)), /#3BB455/);
		assert.match(svg(levelMeterImage(1)), /#FF3C4E/);
	});

	it("fills a stereo bar from the left", () => {
		assert.equal(svg(levelBarImage(0)).includes("<rect"), false);
		assert.match(svg(levelBarImage(0.5)), /width="48"/);
		assert.match(svg(levelBarImage(1)), /width="96"/);
	});

	it("draws the volume line to the output percentage", () => {
		assert.equal(svg(volumeLineImage(0)).includes("<rect"), false);
		assert.match(svg(volumeLineImage(0.5)), /width="48"/);
		assert.match(svg(volumeLineImage(1)), /width="96"/);
	});

	it("places the volume tick from the left stop to the right stop", () => {
		assert.match(svg(volumeNeedleImage(0)), /rotate\(-60 36 36\)/);
		assert.match(svg(volumeNeedleImage(0.5)), /rotate\(0 36 36\)/);
		assert.match(svg(volumeNeedleImage(1)), /rotate\(60 36 36\)/);
	});
});

function svg(dataUri: string): string {
	const encoded = dataUri.slice("data:image/svg+xml;base64,".length);
	return Buffer.from(encoded, "base64").toString("utf8");
}
