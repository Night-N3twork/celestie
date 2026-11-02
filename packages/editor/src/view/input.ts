export function findTextChange(before: string, after: string) {
	if (before === after) return null;

	let start = 0;

	while (
		start < before.length &&
		start < after.length &&
		before[start] === after[start]
	) {
		start++;
	}

	if (before[start - 1] === "\r" && before[start] === "\n") {
		start--;
	}

	let oldEnd = before.length;
	let newEnd = after.length;

	while (
		oldEnd > start &&
		newEnd > start &&
		before[oldEnd - 1] === after[newEnd - 1]
	) {
		oldEnd--;
		newEnd--;
	}

	if (before[oldEnd - 1] === "\r" && before[oldEnd] === "\n") {
		oldEnd++;
		newEnd++;
	}

	return {
		from: start,
		to: oldEnd,
		text: after.slice(start, newEnd),
	};
}
