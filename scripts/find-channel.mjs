import fs from "node:fs";

const text = fs
	.readFileSync("C:/Program Files/WindowsApps/Elgato.WaveLink_3.4.0.4530_x64__g54w8ztgkx496/Elgato.WaveLink.dll")
	.toString("latin1");

function around(needle) {
	const index = text.indexOf(needle);
	console.log("\n====", needle, index);
	if (index < 0) return;
	console.log(text.slice(Math.max(0, index - 300), index + 700).replace(/[^\x20-\x7e]+/g, "\n"));
}

around("MixRefPropInit");
around("SetChannelRequestPropInit");
around("includeMixes");
around("SetMixRoutingFor");
around("RemoveFromMix");
