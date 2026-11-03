export function copyText(text: string): string {
	const parts: string[] = [];
	for (let start = 0; start < text.length; start += 4096) {
		const units = new Uint16Array(Math.min(4096, text.length - start));
		for (let index = 0; index < units.length; index++)
			units[index] = text.charCodeAt(start + index);
		parts.push(String.fromCharCode(...units));
	}
	return parts.join("");
}
