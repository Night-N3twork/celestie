import { Icon as Logo } from "@icons/celestie.svg";
import type { ButtonOptions } from "./Button";

const items = {
	logo: { size: "sm", name: "Celestie", svg: Logo },
	file: { size: "sm", name: "File", text: true },
	edit: { size: "sm", name: "Edit", text: true },
	view: { size: "sm", name: "View", text: true },
	help: { size: "sm", name: "Help", text: true },
	new: { size: "sm", name: "New File", text: true },
} satisfies Record<string, ButtonOptions>;
export type ItemName = keyof typeof items;
export default items;
