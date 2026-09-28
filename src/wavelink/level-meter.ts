const METER_FRAMES = 200;
const METER_CENTER_X = 49;
const METER_CENTER_Y = 49;
const METER_OUTER_RADIUS = 47;
const METER_INNER_RADIUS = 43;
const METER_SWEEP = 130;

const NEEDLE_CENTER_X = 36;
const NEEDLE_CENTER_Y = 36;
const NEEDLE_SWEEP = 120;

const BAR_WIDTH = 96;
const BAR_HEIGHT = 12;

const meterImages = new Map<number, string>();
const barImages = new Map<number, string>();
const volumeLineImages = new Map<number, string>();
const needleImages = new Map<number, string>();

/**
 * Green-to-red arc used as the live Wave Link level meter.
 * The arc is revealed from the left as `level` goes from 0 to 1.
 */
export function levelMeterImage(level: number): string {
	const key = meterFrame(level);
	const cached = meterImages.get(key);
	if (cached) {
		return cached;
	}

	const portion = key / METER_FRAMES;
	const path = portion > 0 ? revealArc(portion) : "";
	const image = svgDataUri(`<svg width="98" height="40" viewBox="0 0 98 40" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="level" x1="6" y1="20" x2="92" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3BB455"/><stop offset="0.6" stop-color="#3BB455"/><stop offset="0.8" stop-color="#FBDB00"/><stop offset="0.95" stop-color="#FF3C4E"/></linearGradient></defs>${path ? `<path fill="url(#level)" d="${path}"/>` : ""}</svg>`);
	meterImages.set(key, image);
	return image;
}

/** Horizontal green-to-red bar for one stereo channel. */
export function levelBarImage(level: number): string {
	const key = meterFrame(level);
	const cached = barImages.get(key);
	if (cached) {
		return cached;
	}

	const width = Math.round((key / METER_FRAMES) * BAR_WIDTH);
	const fill =
		width > 0
			? `<rect x="0" y="0" width="${width}" height="${BAR_HEIGHT}" rx="${Math.min(2, width / 2)}" fill="url(#level)"/>`
			: "";
	const image = svgDataUri(
		`<svg width="${BAR_WIDTH}" height="${BAR_HEIGHT}" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="level" x1="0" y1="0" x2="${BAR_WIDTH}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3BB455"/><stop offset="0.6" stop-color="#3BB455"/><stop offset="0.8" stop-color="#FBDB00"/><stop offset="0.95" stop-color="#FF3C4E"/></linearGradient></defs>${fill}</svg>`,
	);
	barImages.set(key, image);
	return image;
}

/** Thin line under the stereo bars. Its length is the output volume. */
export function volumeLineImage(level: number): string {
	const key = meterStep(level);
	const cached = volumeLineImages.get(key);
	if (cached) {
		return cached;
	}

	const width = Math.round((key / 100) * BAR_WIDTH);
	const fill = width > 0 ? `<rect x="0" y="0" width="${width}" height="4" rx="1" fill="white"/>` : "";
	const image = svgDataUri(
		`<svg width="${BAR_WIDTH}" height="4" viewBox="0 0 ${BAR_WIDTH} 4" xmlns="http://www.w3.org/2000/svg">${fill}</svg>`,
	);
	volumeLineImages.set(key, image);
	return image;
}

/** White tick that marks the output volume on the same arc. */
export function volumeNeedleImage(level: number): string {
	const key = meterStep(level);
	const cached = needleImages.get(key);
	if (cached) {
		return cached;
	}

	const degrees = (key / 100) * NEEDLE_SWEEP - NEEDLE_SWEEP / 2;
	const image = svgDataUri(`<svg width="72" height="27" viewBox="0 0 72 27" xmlns="http://www.w3.org/2000/svg">
		<g transform="rotate(${round(degrees)} ${NEEDLE_CENTER_X} ${NEEDLE_CENTER_Y})">
			<rect x="35" y="2" width="2" height="10" rx="1" fill="white"/>
		</g>
	</svg>`);
	needleImages.set(key, image);
	return image;
}

export function meterArcPath(): string {
	return revealArc(1);
}

function revealArc(portion: number): string {
	const start = -METER_SWEEP / 2;
	const end = start + METER_SWEEP * portion;
	const outerStart = point(METER_CENTER_X, METER_CENTER_Y, METER_OUTER_RADIUS, start);
	const outerEnd = point(METER_CENTER_X, METER_CENTER_Y, METER_OUTER_RADIUS, end);
	const innerEnd = point(METER_CENTER_X, METER_CENTER_Y, METER_INNER_RADIUS, end);
	const innerStart = point(METER_CENTER_X, METER_CENTER_Y, METER_INNER_RADIUS, start);
	const large = end - start > 180 ? 1 : 0;

	return [
		`M${coord(outerStart.x)} ${coord(outerStart.y)}`,
		`A${METER_OUTER_RADIUS} ${METER_OUTER_RADIUS} 0 ${large} 1 ${coord(outerEnd.x)} ${coord(outerEnd.y)}`,
		`L${coord(innerEnd.x)} ${coord(innerEnd.y)}`,
		`A${METER_INNER_RADIUS} ${METER_INNER_RADIUS} 0 ${large} 0 ${coord(innerStart.x)} ${coord(innerStart.y)}`,
		"Z",
	].join(" ");
}

/** Half-percent frames, so the arc can move between whole percents. */
export function meterFrame(level: number): number {
	if (!Number.isFinite(level)) {
		return 0;
	}

	return Math.round(Math.min(1, Math.max(0, level)) * METER_FRAMES);
}

export function meterStep(level: number): number {
	return Math.round(meterFrame(level) / 2);
}

function point(cx: number, cy: number, radius: number, degreesFromUp: number): { x: number; y: number } {
	const radians = (degreesFromUp * Math.PI) / 180;
	return {
		x: cx + radius * Math.sin(radians),
		y: cy - radius * Math.cos(radians),
	};
}

function coord(value: number): string {
	return (Math.round(value * 100) / 100).toString();
}

function round(value: number): string {
	return (Math.round(value * 10) / 10).toString();
}

function svgDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
