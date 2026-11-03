export interface UriComponents {
	readonly scheme: string;
	readonly authority?: string;
	readonly path?: string;
	readonly query?: string;
	readonly fragment?: string;
}

function normalizePath(path: string): string {
	const absolute = path.startsWith("/");
	const parts: string[] = [];
	for (const piece of path.split("/")) {
		if (!piece || piece === ".") continue;
		if (piece === "..") parts.pop();
		else parts.push(piece);
	}
	const result = (absolute ? "/" : "") + parts.join("/");
	return absolute && parts.length === 1 && /^[a-z]:$/i.test(parts[0] ?? "")
		? `${result}/`
		: result;
}

export class Uri {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;
	constructor(components: UriComponents) {
		if (!/^[a-z][a-z0-9+.-]*$/i.test(components.scheme))
			throw new Error("URI requires a valid scheme.");
		this.scheme = components.scheme.toLowerCase();
		this.authority =
			this.scheme === "file"
				? (components.authority ?? "").toLowerCase()
				: (components.authority ?? "");
		const path = components.path ?? "";
		this.path =
			this.scheme === "file"
				? normalizePath(
						path.replace(
							/^\/([A-Z]):/,
							(_, drive: string) => `/${drive.toLowerCase()}:`,
						),
					)
				: path;
		if (this.authority && this.path && !this.path.startsWith("/"))
			throw new Error("An authority URI requires an absolute path.");
		this.query = components.query ?? "";
		this.fragment = components.fragment ?? "";
		Object.freeze(this);
	}
	static parse(value: string): Uri {
		const match =
			/^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(
				value,
			);
		if (!match?.[1]) throw new Error("Invalid document URI.");
		return new Uri({
			scheme: match[1],
			authority: decodeURIComponent(match[2] ?? ""),
			path: decodeURIComponent(match[3] ?? ""),
			query: decodeURIComponent(match[4] ?? ""),
			fragment: decodeURIComponent(match[5] ?? ""),
		});
	}
	static file(value: string): Uri {
		let path = value.replace(/\\/g, "/");
		let authority = "";
		if (path.startsWith("//")) {
			const end = path.indexOf("/", 2);
			authority = path.slice(2, end < 0 ? undefined : end).toLowerCase();
			path = end < 0 ? "/" : path.slice(end);
		} else if (/^[a-z]:\//i.test(path))
			path = `/${path[0]?.toLowerCase()}${path.slice(1)}`;
		else if (!path.startsWith("/"))
			throw new Error("File URI requires an absolute path.");
		return new Uri({
			scheme: "file",
			authority,
			path: normalizePath(path),
		});
	}
	with(change: Partial<UriComponents>): Uri {
		return new Uri({ ...this, ...change });
	}
	static joinPath(base: Uri, ...parts: readonly string[]): Uri {
		return base.with({
			path: normalizePath([base.path, ...parts].join("/")),
		});
	}
	toString(): string {
		const path = this.path
			.split("/")
			.map((part) => encodeURIComponent(part).replace(/%3A/gi, ":"))
			.join("/");
		return `${this.scheme}:${this.authority || this.scheme === "file" ? `//${encodeURIComponent(this.authority).replace(/%3A/gi, ":").replace(/%40/g, "@")}` : ""}${path}${this.query ? `?${encodeURIComponent(this.query).replace(/%3D/g, "=").replace(/%26/g, "&")}` : ""}${this.fragment ? `#${encodeURIComponent(this.fragment)}` : ""}`;
	}
	get fsPath(): string {
		return this.scheme === "file" && /^\/[a-z]:/i.test(this.path)
			? this.path.slice(1).replace(/\//g, "\\")
			: this.authority
				? `//${this.authority}${this.path}`
				: this.path;
	}
	toJSON(): UriComponents {
		return {
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
		};
	}
}
