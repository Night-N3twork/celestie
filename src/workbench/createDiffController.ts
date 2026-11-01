import { createSignal } from "solid-js";

export interface DiffReview {
	id: string;
	fileId: string;
	path: string;
	before: string;
	after: string;
	beforeLabel: string;
	afterLabel: string;
	canOpen: boolean;
}
export function createDiffController() {
	const [reviews, setReviews] = createSignal<DiffReview[]>([]);
	const [activeId, activate] = createSignal<string>();
	return {
		reviews,
		activeId,
		activate,
		active: () => reviews().find((review) => review.id === activeId()),
		open(review: DiffReview) {
			setReviews((items) => [
				...items.filter((item) => item.id !== review.id),
				review,
			]);
			activate(review.id);
		},
		close(id: string) {
			const remaining = reviews().filter((review) => review.id !== id);
			setReviews(remaining);
			if (activeId() === id) activate(remaining.at(-1)?.id);
		},
	};
}
