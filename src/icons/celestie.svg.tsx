import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & {
	accents?: boolean;
};

export function Icon(props: SVGProps<SVGSVGElement>) {
	return <Celestie accents {...props} />;
}

export function Favicon(props: SVGProps<SVGSVGElement>) {
	return <Celestie accents={false} {...props} />;
}

function Celestie({ accents: showAccents = true, ...props }: Props) {
	const size = 24;
	const mid = [12, 12];
	const radius = [8, 9];

	const colors = {
		star: ["#ffeded", "#ffaded", "#ff4ded"],
		trail: ["#ff8ded", "#ca73ff", "#00aaff"],
		glow: "#ff8ae2",
	};

	const trail = {
		width: 2.75,
		end: -325,
		tail: 0.75,
	};

	function radian(deg: number) {
		return (deg * Math.PI) / 180;
	}
	function coords(deg: number) {
		const sin = Math.sin(radian(deg));
		const y = deg < -270 ? 1 - trail.tail * (1 - sin) : sin;
		return [
			mid[0] + radius[0] * Math.cos(radian(deg)),
			mid[1] + radius[1] * y,
		];
	}

	const head = -35;

	const back = [
		(radius[0] * Math.sin(radian(head))) /
			Math.hypot(
				radius[0] * Math.sin(radian(head)),
				radius[1] * Math.sin(radian(head)),
			),
		(radius[1] * Math.sin(radian(head))) /
			Math.hypot(
				radius[0] * Math.sin(radian(head)),
				radius[1] * Math.sin(radian(head)),
			),
	];

	const star = {
		pos: [coords(head)[0] - back[0] * 0.4, coords(head)[1] - back[1] * 0.4],
		points: 4,
		outer: 4,
		inner: 1.6,
		angle: -90,
	};

	const center: number[][] = [star.pos];
	const detail = 96;
	for (let i = 0; i <= detail; i++) {
		center.push(coords(head + ((trail.end - head) * i) / detail));
	}

	const taper = (line: number[][], width: number) => {
		// imagine if ninja got a LOW TAPER FADE
		const lengths = [0];
		for (let i = 1; i < line.length; i++) {
			const [x0, y0] = line[i - 1];
			const [x1, y1] = line[i];
			lengths.push(lengths[i - 1] + Math.hypot(x1 - x0, y1 - y0));
		}
		const total = lengths[lengths.length - 1];

		const left: number[][] = [];
		const right: number[][] = [];
		line.forEach(([x, y], i) => {
			const [px, py] = line[Math.max(i - 1, 0)];
			const [nx, ny] = line[Math.min(i + 1, line.length - 1)];
			const dl = Math.hypot(nx - px, ny - py);
			const normal = [-(ny - py) / dl, (nx - px) / dl];
			const hw = (width / 2) * (1 - lengths[i] / total);
			left.push([x + normal[0] * hw, y + normal[1] * hw]);
			right.push([x - normal[0] * hw, y - normal[1] * hw]);
		});
		return { left, right };
	};

	const edges = taper(center, trail.width);

	function path(
		[cx, cy]: number[],
		points: number,
		radii: number[],
		inner: number,
		angle = 0,
	) {
		const at = (deg: number, r: number) => [
			cx + r * Math.cos(radian(deg)),
			cy + r * Math.sin(radian(deg)),
		];
		const step = 360 / points;
		const tips = Array.from({ length: points }, (_, i) =>
			at(angle + i * step, radii[i % radii.length]),
		);
		const ctrl = tips.map((tip, i) => {
			const next = tips[(i + 1) % points];
			const chordMid = Math.hypot(
				(tip[0] + next[0]) / 2 - cx,
				(tip[1] + next[1]) / 2 - cy,
			);
			return at(angle + (i + 0.5) * step, 2 * inner - chordMid);
		});
		return `M ${tips[0]} ${tips
			.map((_, i) => `Q ${ctrl[i]} ${tips[(i + 1) % points]}`)
			.join(" ")} Z`;
	}

	function blend(stops: string[], t: number) {
		const rgb = stops.map((hex) =>
			[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)),
		);
		const pos = t * (rgb.length - 1);
		const i = Math.min(Math.floor(pos), rgb.length - 2);
		const f = pos - i;
		const c = rgb[i].map((v, k) => Math.round(v + (rgb[i + 1][k] - v) * f));
		return `rgb(${c.join(",")})`;
	}

	const points = (pts: number[][]) =>
		pts.map(([x, y]) => `${x},${y}`).join(" ");

	const outline = points([...edges.left, ...[...edges.right].reverse()]);

	const segments = center.slice(1, -1).map((_, i) => {
		const t = i / (center.length - 3);
		const a = center[i];
		const b = center[Math.min(i + 2, center.length - 1)];
		const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const n = [(-(b[1] - a[1]) / d) * 3, ((b[0] - a[0]) / d) * 3];
		return {
			color: blend(colors.trail, t),
			points: points([
				[a[0] + n[0], a[1] + n[1]],
				[b[0] + n[0], b[1] + n[1]],
				[b[0] - n[0], b[1] - n[1]],
				[a[0] - n[0], a[1] - n[1]],
			]),
		};
	});

	const accents = !showAccents
		? []
		: [
				{ pos: [14, 14], outer: 1.25, color: colors.trail[1] },
				{ pos: [10, 9], outer: 1, color: colors.trail[2] },
				{ pos: [9, 16], outer: 0.75, color: colors.trail[0] },
			];

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			{...props}
		>
			<title>Celestie</title>
			<defs>
				<radialGradient
					id="core"
					gradientUnits="userSpaceOnUse"
					cx={star.pos[0]}
					cy={star.pos[1]}
					r={star.outer}
				>
					<stop offset="0" stopColor={colors.star[0]} />
					<stop offset="0.35" stopColor={colors.star[1]} />
					<stop offset="1" stopColor={colors.star[2]} />
				</radialGradient>
				<clipPath id="trail">
					<polygon points={outline} />
				</clipPath>
				<filter
					id="glow"
					x="-50%"
					y="-50%"
					width="200%"
					height="200%"
				>
					<feGaussianBlur stdDeviation="0.9" />
				</filter>
			</defs>

			<g clipPath="url(#trail)">
				{segments.map((s) => (
					<polygon key={s.points} points={s.points} fill={s.color} />
				))}
			</g>

			{accents.map((a) => (
				<path
					key={`${a.pos}`}
					d={path(a.pos, 4, [a.outer], a.outer * 0.4, -90)}
					fill={a.color}
				/>
			))}

			<circle
				cx={star.pos[0]}
				cy={star.pos[1]}
				r={2.2}
				fill={colors.glow}
				opacity={0.55}
				filter="url(#glow)"
			/>
			<path
				d={path(
					star.pos,
					star.points,
					[star.outer],
					star.inner,
					star.angle,
				)}
				fill="url(#core)"
			/>
		</svg>
	);
}
