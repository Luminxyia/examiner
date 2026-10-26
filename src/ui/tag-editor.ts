import { AbstractInputSuggest, setIcon, type App } from "obsidian";
import { normaliseTag, normaliseTags } from "../core/tags";

export function renderTagEditor(
	app: App,
	parent: HTMLElement,
	initial: readonly string[],
	knownTags: () => string[],
	onChange: (tags: string[]) => void,
): void {
	let tags = [...initial];
	const container = parent.createDiv({ cls: "examiner-tag-editor" });

	const update = (next: string[]) => {
		tags = next;
		onChange(tags);
		draw();
		container.querySelector<HTMLInputElement>(".examiner-tag-input")?.focus();
	};

	const draw = () => {
		container.empty();
		for (const tag of tags) {
			const chip = container.createSpan({ cls: "examiner-tag" });
			chip.createSpan({ text: tag });
			const remove = chip.createEl("button", { cls: "examiner-tag-remove", attr: { "aria-label": `Remove tag ${tag}` } });
			setIcon(remove, "x");
			remove.addEventListener("click", () => update(tags.filter((t) => t !== tag)));
		}
		const input = container.createEl("input", {
			type: "text",
			cls: "examiner-tag-input",
			attr: { placeholder: "Add a tag", "aria-label": "Add a tag" },
		});
		const add = (raw: string) => {
			input.value = "";
			const next = normaliseTags([...tags, ...raw.split(",")]);
			if (next.length !== tags.length) update(next);
		};
		const suggest = new TagSuggest(app, input, () => {
			const current = new Set(tags.map((tag) => tag.toLowerCase()));
			return normaliseTags(knownTags()).filter((tag) => !current.has(tag.toLowerCase()));
		}, add);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && suggest.isOpen) return;
			if ((event.key === "Enter" || event.key === ",") && input.value.trim() !== "") {
				event.preventDefault();
				add(input.value);
			} else if (event.key === "Backspace" && input.value === "" && tags.length > 0) {
				update(tags.slice(0, -1));
			}
		});
	};

	draw();
}

class TagSuggest extends AbstractInputSuggest<string> {
	isOpen = false;

	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly tags: () => string[],
		private readonly choose: (tag: string) => void,
	) {
		super(app, input);
	}

	protected override getSuggestions(query: string): string[] {
		const normalised = (normaliseTag(query) ?? "").toLowerCase();
		return this.tags()
			.filter((tag) => tag.toLowerCase().includes(normalised))
			.slice(0, 20);
	}

	override renderSuggestion(tag: string, el: HTMLElement): void {
		el.setText(tag);
	}

	override open(): void {
		super.open();
		this.isOpen = true;
	}

	override close(): void {
		super.close();
		this.isOpen = false;
	}

	override selectSuggestion(tag: string): void {
		this.input.value = "";
		this.close();
		this.choose(tag);
	}
}
