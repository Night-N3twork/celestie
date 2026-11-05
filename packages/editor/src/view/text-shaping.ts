type CodeRanges = readonly (readonly [number, number])[];
const rightToLeftRanges: CodeRanges = [
	[0x0590, 0x08ff],
	[0xfb1d, 0xfdff],
	[0xfe70, 0xfefc],
	[0x200f, 0x200f],
	[0x202b, 0x202b],
	[0x202e, 0x202e],
	[0x2067, 0x2067],
	[0x10800, 0x10fff],
	[0x1e800, 0x1efff],
];
const contextualRanges: CodeRanges = [
	[0x0590, 0x08ff],
	[0x0900, 0x0dff],
	[0x0e00, 0x0fff],
	[0x1000, 0x109f],
	[0x1780, 0x18af],
	[0x1a00, 0x1bff],
	[0x200c, 0x200d],
	[0xa800, 0xabff],
	[0xfb1d, 0xfdff],
	[0xfe70, 0xfefc],
	[0x10800, 0x10fff],
	[0x11000, 0x11fff],
	[0x1e800, 0x1efff],
];
const beyondLatin = /[\u0590-\u{10ffff}]/u;
const combiningMark = /\p{M}/u;
function inRanges(text: string, ranges: CodeRanges): boolean {
	if (!beyondLatin.test(text)) return false;
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (ranges.some(([from, to]) => code >= from && code <= to))
			return true;
	}
	return false;
}

export function hasRightToLeft(text: string): boolean {
	return inRanges(text, rightToLeftRanges);
}

export function needsShapedMeasurement(
	text: string,
	ligatures: boolean,
): boolean {
	return (
		(ligatures && /[^\s]{2}/u.test(text)) ||
		combiningMark.test(text) ||
		inRanges(text, contextualRanges)
	);
}

export function isFontFeatureSettings(value: string): boolean {
	return /^\s*"[a-zA-Z0-9]{4}"(\s+(on|off|\d{1,3}))?(\s*,\s*"[a-zA-Z0-9]{4}"(\s+(on|off|\d{1,3}))?)*\s*$/.test(
		value,
	);
}

export function ligatureStyle(value: boolean | string): {
	readonly variant: string;
	readonly features: string;
} {
	if (value === false)
		return { variant: "none", features: '"liga" 0, "calt" 0' };
	if (value === true)
		return { variant: "normal", features: '"liga" 1, "calt" 1' };
	return { variant: "normal", features: value };
}

export function snapToDevicePixels(value: number, ratio: number): number {
	const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
	return Math.max(1, Math.round(value * scale)) / scale;
}

export const calibrationSamples = [
	"The quick brown fox => != <= 0O1lI",
	"\u6f22\u5b57\u304b\u306a\ud55c\uae00",
	"\u0645\u0631\u062d\u0628\u0627 \u05e9\u05dc\u05d5\u05dd",
	"\u0928\u092e\u0938\u094d\u0924\u0947 \u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35",
	"\ud83d\ude00\ud83d\udc4d\ud83c\udffd\u2764\ufe0f",
] as const;
