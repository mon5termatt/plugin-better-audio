import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OutputState } from "./state";
import { OutputVolumeWriter } from "./volume-writer";

describe("OutputVolumeWriter", () => {
	it("keeps the newest dial level when an older notification arrives mid-write", async () => {
		const state = new OutputState();
		state.replaceOutputs({ outputDeviceId: "speakers", outputId: "speakers-out" }, [
			{
				id: "speakers",
				name: "Speakers",
				deviceType: "thirdParty",
				outputs: [{ id: "speakers-out", name: "Speakers", level: 0.2, isMuted: false, mixId: "" }],
			},
		]);

		let release: (() => void) | undefined;
		const sent: number[] = [];
		const writer = new OutputVolumeWriter(
			state,
			async (_deviceId, _outputId, level) => {
				sent.push(level);
				if (sent.length === 1) {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				}
			},
			() => {
				throw new Error("send failed");
			},
		);

		writer.adjust({ outputDeviceId: "speakers", outputId: "speakers-out" }, 1);
		writer.adjust({ outputDeviceId: "speakers", outputId: "speakers-out" }, 1);
		assert.equal(state.currentDetails()?.level, 0.22);

		state.applyDeviceChange({
			id: "speakers",
			outputs: [{ id: "speakers-out", level: 0.21 }],
		});
		writer.restorePending();
		assert.equal(state.currentDetails()?.level, 0.22);

		release?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepEqual(sent, [0.21, 0.22]);
	});
});
