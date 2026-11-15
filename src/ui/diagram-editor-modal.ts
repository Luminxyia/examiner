import { ButtonComponent, DropdownComponent, Modal, setIcon, setTooltip, type App } from "obsidian";
import { isValidPointName, parseDiagram, shapeAnchors, type Diagram, type DiagramPointInfo, type Placement, type ShapeSource } from "../core/diagram";
import { CONNECTED_SYMBOLS, NAMED_SYMBOLS, PLACED_SYMBOLS } from "../core/diagram-symbols";
import {
	addToDiagram,
	formatNumber,
	hasFlag,
	lineText,
	lineUsesPoint,
	nextPointName,
	nextSymbolName,
	readLabel,
	readNumberOption,
	readPlacement,
	removeLine,
	removeSelection,
	removeShapeLine,
	renamePoint,
	replaceLine,
	setFlag,
	setLabel,
	setNumberOption,
	setPlacement,
	setPointPosition,
	setQuotedToken,
	movePoints,
	wordsInLine,
	type NewPoint,
} from "../core/diagram-edit";
import { renderDiagramView, type DiagramViewOptions } from "./diagram";

const SVG_NS = "http://www.w3.org/2000/svg";
const CANVAS_WIDTH = 560;
const CANVAS_HEIGHT = 380;
const GRID_STEP = 0.5;
const HANDLE_RADIUS = 5;
const FRAME_MARGIN = 1.5;
const MIN_FRAME_WIDTH = 8;
const MIN_FRAME_HEIGHT = 5;
const TYPING_PAUSE_MS = 1000;
const FLAG_NAMES: Record<string, string> = { thick: "Thick", dashed: "Dashed", closed: "Closed" };

interface Tool {
	id: string;
	icon: string;
	label: string;
	minimum: number;
	maximum: number;
	build: (names: string[], diagram: Diagram) => string | null;
}

interface PendingPoint {
	name: string;
	x: number;
	y: number;
	isNew: boolean;
}

const MANY = Number.POSITIVE_INFINITY;
const NAMED_PREFIXES: Record<string, string> = { npn: "Q", pnp: "Q", potentiometer: "RV", opamp: "U" };

const DRAWING_TOOLS: Tool[] = [
	{ id: "point", icon: "dot", label: "Point", minimum: 1, maximum: 1, build: () => null },
	{ id: "line", icon: "spline", label: "Line", minimum: 2, maximum: MANY, build: (names) => `line ${names.join(" ")}` },
	{ id: "wire", icon: "cable", label: "Wire", minimum: 2, maximum: MANY, build: (names) => `wire ${names.join(" ")}` },
	{ id: "rectangle", icon: "square", label: "Rectangle", minimum: 2, maximum: 2, build: ([a, b]) => `rectangle ${a} ${b}` },
	{ id: "circle", icon: "circle", label: "Circle", minimum: 1, maximum: 1, build: ([a]) => `circle at ${a} radius 1` },
	{ id: "arrow", icon: "move-right", label: "Arrow", minimum: 2, maximum: 2, build: ([a, b]) => `arrow from ${a} to ${b}` },
	{ id: "dimension", icon: "ruler", label: "Dimension", minimum: 2, maximum: 2, build: ([a, b]) => `dimension ${a} ${b}` },
	{ id: "angle", icon: "triangle", label: "Angle", minimum: 3, maximum: 3, build: ([a, b, c]) => `angle ${a} ${b} ${c}` },
	{
		id: "distributed",
		icon: "chevrons-down",
		label: "Distributed load",
		minimum: 2,
		maximum: 2,
		build: ([a, b]) => `distributed from ${a} to ${b} down length 1`,
	},
	{ id: "moment", icon: "rotate-cw", label: "Moment", minimum: 1, maximum: 1, build: ([a]) => `moment at ${a} radius 0.6 clockwise` },
	{ id: "ground", icon: "arrow-down-to-line", label: "Ground", minimum: 2, maximum: 2, build: ([a, b]) => `ground ${a} ${b}` },
	{ id: "fill", icon: "paint-bucket", label: "Fill", minimum: 3, maximum: MANY, build: (names) => `fill ${names.join(" ")} with hatch` },
	{ id: "label", icon: "type", label: "Label", minimum: 1, maximum: 1, build: ([a]) => `label "${a ?? ""}" at ${a}` },
];

function symbolTool(symbol: string): Tool | null {
	if (CONNECTED_SYMBOLS.has(symbol)) {
		return { id: symbol, icon: "", label: symbol, minimum: 2, maximum: 2, build: ([a, b]) => `${symbol} from ${a} to ${b}` };
	}
	if (symbol === "pulley") {
		return { id: symbol, icon: "", label: symbol, minimum: 1, maximum: 1, build: ([a]) => `pulley at ${a} radius 0.5` };
	}
	if (PLACED_SYMBOLS.has(symbol)) {
		return { id: symbol, icon: "", label: symbol, minimum: 1, maximum: 1, build: ([a]) => `${symbol} at ${a}` };
	}
	if (NAMED_SYMBOLS.has(symbol)) {
		return {
			id: symbol,
			icon: "",
			label: symbol,
			minimum: 1,
			maximum: 1,
			build: ([a], diagram) => {
				const taken = new Set<string>();
				for (const shape of diagram.shapes) {
					if (shape.kind === "named-symbol") taken.add(shape.name);
				}
				const name = nextSymbolName(NAMED_PREFIXES[symbol] ?? "X", taken);
				return `${symbol} ${name} at ${a}`;
			},
		};
	}
	return null;
}

type Selection = { kind: "point"; name: string } | { kind: "shape"; line: number } | { kind: "many"; points: string[]; lines: number[] } | null;

const MARQUEE_MIN_PIXELS = 4;

interface Frame {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface RenderOptions {
	refit: boolean;
	updateText: boolean;
	updatePanel: boolean;
}

export class DiagramEditorModal extends Modal {
	private text: string;
	private diagram: Diagram;
	private readonly undoStack: string[] = [];
	private readonly redoStack: string[] = [];
	private selection: Selection = null;
	private frame: Frame = { minX: 0, minY: 0, maxX: MIN_FRAME_WIDTH, maxY: MIN_FRAME_HEIGHT };
	private draggedPoint: string | null = null;
	private lastTypingAt = 0;
	private svg: SVGSVGElement | null = null;
	private canvasEl!: HTMLElement;
	private panelEl!: HTMLElement;
	private textArea!: HTMLTextAreaElement;
	private errorsEl!: HTMLElement;
	private undoButton!: HTMLElement;
	private redoButton!: HTMLElement;
	private tool: Tool | null = null;
	private pending: PendingPoint[] = [];
	private readonly toolButtons = new Map<string, HTMLElement>();
	private symbolMenu!: DropdownComponent;

	private readonly onPointerMove = (event: PointerEvent) => this.dragTo(event);
	private readonly onPointerUp = (event: PointerEvent) => this.endDrag(event);
	private marqueeStart: { x: number; y: number; clientX: number; clientY: number } | null = null;
	private marqueeEl: SVGRectElement | null = null;
	private groupDrag: { startText: string; startX: number; startY: number; points: NewPoint[]; lastDx: number; lastDy: number } | null = null;

	private readonly onEscape = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
			target.blur();
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (!this.escape()) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};

	constructor(
		app: App,
		source: string,
		private readonly onSave: (source: string) => void,
	) {
		super(app);
		this.text = source;
		this.diagram = parseDiagram(source);
	}

	override onOpen(): void {
		this.modalEl.addClass("examiner-diagram-editor-modal");
		this.setTitle("Diagram");
		const content = this.contentEl;
		const main = content.createDiv({ cls: "examiner-diagram-editor-main" });
		const drawingColumn = main.createDiv({ cls: "examiner-diagram-editor-drawing" });
		const codeColumn = main.createDiv({ cls: "examiner-diagram-editor-code" });

		const toolbar = drawingColumn.createDiv({ cls: "examiner-diagram-editor-toolbar" });
		this.undoButton = this.iconButton(toolbar, "undo-2", "Undo", () => this.undo());
		this.redoButton = this.iconButton(toolbar, "redo-2", "Redo", () => this.redo());
		this.iconButton(toolbar, "rotate-ccw", "Reset", () => this.reset());
		toolbar.createDiv({ cls: "examiner-diagram-editor-divider" });
		this.toolButtons.set("select", this.iconButton(toolbar, "mouse-pointer-2", "Select", () => this.chooseTool(null)));
		for (const tool of DRAWING_TOOLS) {
			this.toolButtons.set(tool.id, this.iconButton(toolbar, tool.icon, tool.label, () => this.chooseTool(tool)));
		}
		const symbols: Record<string, string> = { "": "Symbol" };
		for (const name of [...CONNECTED_SYMBOLS.keys(), ...PLACED_SYMBOLS.keys(), ...NAMED_SYMBOLS.keys()]) symbols[name] = name;
		this.symbolMenu = new DropdownComponent(toolbar).addOptions(symbols).onChange((name) => {
			if (name === "") this.chooseTool(null);
			else this.chooseTool(symbolTool(name));
		});

		this.canvasEl = drawingColumn.createDiv({ cls: "examiner-diagram-editor-canvas" });
		this.panelEl = drawingColumn.createDiv({ cls: "examiner-diagram-editor-panel" });

		codeColumn.createDiv({ cls: "examiner-diagram-editor-heading", text: "Code preview" });
		this.textArea = codeColumn.createEl("textarea", { cls: "examiner-diagram-editor-text", attr: { spellcheck: "false" } });
		this.textArea.setAttribute("aria-label", "Code preview");
		this.textArea.addEventListener("input", () => this.typed());
		this.errorsEl = codeColumn.createDiv({ cls: "examiner-diagram-errors examiner-error-text" });

		const footer = content.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(footer).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				this.onSave(this.text);
				this.close();
			});

		this.scope.register(["Mod"], "z", (event) => this.shortcut(event, () => this.undo()));
		this.scope.register(["Mod", "Shift"], "z", (event) => this.shortcut(event, () => this.redo()));
		this.scope.register(["Mod"], "y", (event) => this.shortcut(event, () => this.redo()));
		this.scope.register([], "Delete", (event) => this.shortcut(event, () => this.deleteSelection()));
		this.scope.register([], "Backspace", (event) => this.shortcut(event, () => this.deleteSelection()));
		this.scope.register([], "Enter", (event) => this.shortcut(event, () => this.finishPending()));
		activeWindow.addEventListener("keydown", this.onEscape, true);

		this.chooseTool(null);
		this.render({ refit: true, updateText: true, updatePanel: true });
	}

	override onClose(): void {
		this.stopListening();
		activeWindow.removeEventListener("keydown", this.onEscape, true);
		this.contentEl.empty();
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const button = parent.createDiv({ cls: "clickable-icon", attr: { role: "button", "aria-label": label } });
		setIcon(button, icon);
		setTooltip(button, label);
		button.addEventListener("click", onClick);
		return button;
	}

	private chooseTool(tool: Tool | null): void {
		this.tool = tool;
		this.pending = [];
		this.selection = null;
		let symbolValue = "";
		if (tool !== null && tool.icon === "") symbolValue = tool.id;
		this.symbolMenu.setValue(symbolValue);
		for (const [id, button] of this.toolButtons) {
			let active = tool === null && id === "select";
			if (tool !== null && tool.id === id && tool.icon !== "") active = true;
			button.toggleClass("is-active", active);
		}
		this.render({ refit: false, updateText: false, updatePanel: true });
	}

	private escape(): boolean {
		if (this.pending.length > 0) {
			this.pending = [];
			this.render({ refit: false, updateText: false, updatePanel: false });
			return false;
		}
		if (this.tool !== null) {
			this.chooseTool(null);
			return false;
		}
		if (this.selection !== null) {
			this.deleteSelection();
			return false;
		}
		return true;
	}

	private addPending(point: PendingPoint): void {
		const tool = this.tool;
		if (tool === null) return;
		const last = this.pending[this.pending.length - 1];
		if (last !== undefined && last.name === point.name) return;
		if (tool.id === "point" && !point.isNew) return;
		this.pending.push(point);
		if (this.pending.length >= tool.maximum) {
			this.finishPending();
			return;
		}
		this.render({ refit: false, updateText: false, updatePanel: false });
	}

	private finishPending(): void {
		const tool = this.tool;
		if (tool === null || this.pending.length < tool.minimum) return;
		const names = this.pending.map((point) => point.name);
		const newPoints = this.pending.filter((point) => point.isNew);
		const shapeLine = tool.build(names, this.diagram);
		this.pending = [];
		const next = addToDiagram(this.text, newPoints, shapeLine);
		if (shapeLine === null) {
			const created = newPoints[0];
			if (created !== undefined) this.selection = { kind: "point", name: created.name };
		} else {
			this.selection = { kind: "shape", line: next.split(/\r?\n/).length };
		}
		this.change(next, this.pointsOutside(newPoints));
	}

	private pointsOutside(points: readonly PendingPoint[]): boolean {
		for (const point of points) {
			if (point.x < this.frame.minX || point.x > this.frame.maxX) return true;
			if (point.y < this.frame.minY || point.y > this.frame.maxY) return true;
		}
		return false;
	}

	private takenNames(): Set<string> {
		const taken = new Set<string>();
		for (const point of this.diagram.points) taken.add(point.name);
		for (const point of this.pending) taken.add(point.name);
		return taken;
	}

	private placeAt(event: PointerEvent): void {
		const units = this.pointerToUnits(event);
		if (units === null) return;
		let x = units.x;
		let y = units.y;
		if (!event.altKey) {
			x = Math.round(x / GRID_STEP) * GRID_STEP;
			y = Math.round(y / GRID_STEP) * GRID_STEP;
		}
		const sameSpot = (point: { x: number; y: number }) => formatNumber(point.x) === formatNumber(x) && formatNumber(point.y) === formatNumber(y);
		const existing = this.diagram.points.find(sameSpot);
		if (existing !== undefined) {
			this.addPending({ name: existing.name, x: existing.x, y: existing.y, isNew: false });
			return;
		}
		const waiting = this.pending.find(sameSpot);
		if (waiting !== undefined) {
			this.addPending(waiting);
			return;
		}
		this.addPending({ name: nextPointName(this.takenNames()), x, y, isNew: true });
	}

	private shortcut(event: KeyboardEvent, action: () => void): boolean {
		const target = event.target;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
		action();
		return false;
	}

	private change(next: string, refit: boolean): void {
		if (next === this.text) return;
		this.undoStack.push(this.text);
		this.redoStack.length = 0;
		this.text = next;
		this.diagram = parseDiagram(next);
		this.render({ refit, updateText: true, updatePanel: true });
	}

	private typed(): void {
		const now = Date.now();
		if (now - this.lastTypingAt > TYPING_PAUSE_MS) {
			this.undoStack.push(this.text);
			this.redoStack.length = 0;
		}
		this.lastTypingAt = now;
		this.text = this.textArea.value;
		this.diagram = parseDiagram(this.text);
		this.render({ refit: true, updateText: false, updatePanel: true });
	}

	private undo(): void {
		const previous = this.undoStack.pop();
		if (previous === undefined) return;
		this.redoStack.push(this.text);
		this.text = previous;
		this.diagram = parseDiagram(previous);
		this.render({ refit: true, updateText: true, updatePanel: true });
	}

	private redo(): void {
		const next = this.redoStack.pop();
		if (next === undefined) return;
		this.undoStack.push(this.text);
		this.text = next;
		this.diagram = parseDiagram(next);
		this.render({ refit: true, updateText: true, updatePanel: true });
	}

	private render(options: RenderOptions): void {
		this.dropMissingSelection();
		if (options.refit) this.fitFrame();
		if (options.updateText) this.textArea.value = this.text;
		this.renderCanvas();
		if (options.updatePanel) this.renderPanel();
		this.renderErrors();
		this.undoButton.toggleClass("is-disabled", this.undoStack.length === 0);
		this.redoButton.toggleClass("is-disabled", this.redoStack.length === 0);
	}

	private dropMissingSelection(): void {
		const selection = this.selection;
		if (selection === null) return;
		if (selection.kind === "point" && this.findPoint(selection.name) === undefined) this.selection = null;
		if (selection.kind === "shape" && this.findSource(selection.line) === undefined) this.selection = null;
		if (selection.kind === "many") {
			const points = selection.points.filter((name) => this.findPoint(name) !== undefined);
			const lines = selection.lines.filter((line) => this.findSource(line) !== undefined);
			if (points.length === 0 && lines.length === 0) this.selection = null;
			else this.selection = { kind: "many", points, lines };
		}
	}

	private isPointSelected(name: string): boolean {
		const selection = this.selection;
		if (selection === null) return false;
		if (selection.kind === "point") return selection.name === name;
		if (selection.kind === "many") return selection.points.includes(name);
		return false;
	}

	private selectedLines(): number[] {
		const selection = this.selection;
		if (selection === null) return [];
		if (selection.kind === "shape") return [selection.line];
		if (selection.kind === "many") return selection.lines;
		return [];
	}

	private findPoint(name: string): DiagramPointInfo | undefined {
		return this.diagram.points.find((point) => point.name === name);
	}

	private findSource(line: number): ShapeSource | undefined {
		return this.diagram.sources.find((source) => source.line === line);
	}

	private fitFrame(): void {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const point of this.diagram.points) {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
		if (!Number.isFinite(minX)) {
			minX = 0;
			minY = 0;
			maxX = 0;
			maxY = 0;
		}
		minX -= FRAME_MARGIN;
		minY -= FRAME_MARGIN;
		maxX += FRAME_MARGIN;
		maxY += FRAME_MARGIN;
		const width = maxX - minX;
		const height = maxY - minY;
		if (width < MIN_FRAME_WIDTH) {
			const extra = (MIN_FRAME_WIDTH - width) / 2;
			minX -= extra;
			maxX += extra;
		}
		if (height < MIN_FRAME_HEIGHT) {
			const extra = (MIN_FRAME_HEIGHT - height) / 2;
			minY -= extra;
			maxY += extra;
		}
		const scale = this.frameScale({ minX, minY, maxX, maxY });
		const canvasUnitsWide = CANVAS_WIDTH / scale;
		const canvasUnitsHigh = CANVAS_HEIGHT / scale;
		const centreX = (minX + maxX) / 2;
		const centreY = (minY + maxY) / 2;
		this.frame = {
			minX: centreX - canvasUnitsWide / 2,
			maxX: centreX + canvasUnitsWide / 2,
			minY: centreY - canvasUnitsHigh / 2,
			maxY: centreY + canvasUnitsHigh / 2,
		};
	}

	private frameScale(frame: Frame): number {
		const width = frame.maxX - frame.minX;
		const height = frame.maxY - frame.minY;
		return Math.min(CANVAS_WIDTH / width, CANVAS_HEIGHT / height);
	}

	private pointOutsideFrame(): boolean {
		for (const point of this.diagram.points) {
			if (point.x < this.frame.minX || point.x > this.frame.maxX) return true;
			if (point.y < this.frame.minY || point.y > this.frame.maxY) return true;
		}
		return false;
	}

	private view(): DiagramViewOptions {
		const scale = this.frameScale(this.frame);
		return {
			scale,
			viewBox: {
				x: this.frame.minX * scale,
				y: -this.frame.maxY * scale,
				width: (this.frame.maxX - this.frame.minX) * scale,
				height: (this.frame.maxY - this.frame.minY) * scale,
			},
		};
	}

	private renderCanvas(): void {
		this.canvasEl.empty();
		const view = this.view();
		const svg = renderDiagramView(this.canvasEl, this.diagram, view);
		this.svg = svg;
		svg.insertBefore(this.gridElement(view.scale), svg.firstChild);
		this.markSelectedShape(svg);
		this.addHandles(svg, view.scale);
		this.addPendingPreview(svg, view.scale);
		svg.addEventListener("pointerdown", (event) => this.canvasPressed(event));
		svg.addEventListener("dblclick", () => this.finishPending());
		svg.classList.toggle("is-drawing", this.tool !== null);
	}

	private svgChild<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
		const element = activeDocument.createElementNS(SVG_NS, tag);
		for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
		parent.appendChild(element);
		return element;
	}

	private gridElement(scale: number): SVGGElement {
		const grid = activeDocument.createElementNS(SVG_NS, "g");
		grid.setAttribute("class", "examiner-diagram-grid");
		const top = -this.frame.maxY * scale;
		const bottom = -this.frame.minY * scale;
		const left = this.frame.minX * scale;
		const right = this.frame.maxX * scale;
		for (let x = Math.ceil(this.frame.minX / GRID_STEP) * GRID_STEP; x <= this.frame.maxX; x += GRID_STEP) {
			const major = Math.abs(x - Math.round(x)) < 0.001;
			this.svgChild(grid, "line", { x1: x * scale, y1: top, x2: x * scale, y2: bottom, class: major ? "is-major" : "" });
		}
		for (let y = Math.ceil(this.frame.minY / GRID_STEP) * GRID_STEP; y <= this.frame.maxY; y += GRID_STEP) {
			const major = Math.abs(y - Math.round(y)) < 0.001;
			this.svgChild(grid, "line", { x1: left, y1: -y * scale, x2: right, y2: -y * scale, class: major ? "is-major" : "" });
		}
		return grid;
	}

	private markSelectedShape(svg: SVGSVGElement): void {
		for (const line of this.selectedLines()) {
			svg.querySelectorAll(`[data-line="${line}"]`).forEach((element) => element.classList.add("is-selected"));
		}
	}

	private addHandles(svg: SVGSVGElement, scale: number): void {
		const layer = this.svgChild(svg, "g", { class: "examiner-diagram-handles" });
		for (const point of this.diagram.points) {
			let cls = "examiner-diagram-handle";
			if (this.isPointSelected(point.name)) cls += " is-selected";
			const handle = this.svgChild(layer, "circle", { cx: point.x * scale, cy: -point.y * scale, r: HANDLE_RADIUS, class: cls });
			const title = this.svgChild(handle, "title", {});
			title.textContent = point.name;
			handle.addEventListener("pointerdown", (event) => {
				event.stopPropagation();
				event.preventDefault();
				const selection = this.selection;
				const inGroup = selection !== null && selection.kind === "many" && this.selectedGroupPoints().includes(point.name);
				if (this.tool === null && inGroup) this.startGroupDrag(event, this.selectedGroupPoints());
				else if (this.tool === null) this.startDrag(point.name);
				else this.addPending({ name: point.name, x: point.x, y: point.y, isNew: false });
			});
		}
	}

	private addPendingPreview(svg: SVGSVGElement, scale: number): void {
		if (this.pending.length === 0) return;
		const layer = this.svgChild(svg, "g", { class: "examiner-diagram-pending" });
		const points = this.pending.map((point) => `${point.x * scale},${-point.y * scale}`).join(" ");
		if (this.pending.length > 1) this.svgChild(layer, "polyline", { points, class: "examiner-diagram-preview" });
		for (const point of this.pending) {
			this.svgChild(layer, "circle", { cx: point.x * scale, cy: -point.y * scale, r: HANDLE_RADIUS, class: "examiner-diagram-handle is-selected" });
		}
	}

	private canvasPressed(event: PointerEvent): void {
		if (this.tool !== null) {
			this.placeAt(event);
			return;
		}
		const target = event.target;
		let found: Element | null = null;
		if (target instanceof Element) found = target.closest("[data-line]");
		const line = Number(found?.getAttribute("data-line") ?? "0");
		if (line > 0 && this.findSource(line) !== undefined) {
			const selection = this.selection;
			if (selection !== null && selection.kind === "many" && selection.lines.includes(line)) {
				this.startGroupDrag(event, this.selectedGroupPoints());
				return;
			}
			this.selection = { kind: "shape", line };
			this.startGroupDrag(event, this.pointsOfLine(line));
			return;
		}
		this.startMarquee(event);
	}

	private pointsOfLine(line: number): string[] {
		const known = new Set(this.diagram.points.map((point) => point.name));
		const names: string[] = [];
		for (const word of wordsInLine(lineText(this.text, line))) {
			if (known.has(word) && !names.includes(word)) names.push(word);
		}
		return names;
	}

	private selectedGroupPoints(): string[] {
		const names: string[] = [];
		const selection = this.selection;
		if (selection === null || selection.kind !== "many") return names;
		for (const name of selection.points) {
			if (!names.includes(name)) names.push(name);
		}
		for (const line of selection.lines) {
			for (const name of this.pointsOfLine(line)) {
				if (!names.includes(name)) names.push(name);
			}
		}
		return names;
	}

	private startGroupDrag(event: PointerEvent, names: readonly string[]): void {
		const units = this.pointerToUnits(event);
		if (units === null) return;
		const points: NewPoint[] = [];
		for (const name of names) {
			const point = this.findPoint(name);
			if (point !== undefined) points.push({ name, x: point.x, y: point.y });
		}
		this.groupDrag = { startText: this.text, startX: units.x, startY: units.y, points, lastDx: 0, lastDy: 0 };
		this.undoStack.push(this.text);
		this.redoStack.length = 0;
		activeWindow.addEventListener("pointermove", this.onPointerMove);
		activeWindow.addEventListener("pointerup", this.onPointerUp);
		this.render({ refit: false, updateText: false, updatePanel: true });
	}

	private moveGroup(event: PointerEvent): void {
		const drag = this.groupDrag;
		const units = this.pointerToUnits(event);
		if (drag === null || units === null) return;
		let dx = units.x - drag.startX;
		let dy = units.y - drag.startY;
		if (!event.altKey) {
			dx = Math.round(dx / GRID_STEP) * GRID_STEP;
			dy = Math.round(dy / GRID_STEP) * GRID_STEP;
		}
		if (formatNumber(dx) === formatNumber(drag.lastDx) && formatNumber(dy) === formatNumber(drag.lastDy)) return;
		drag.lastDx = dx;
		drag.lastDy = dy;
		const moved = drag.points.map((point) => ({ name: point.name, x: point.x + dx, y: point.y + dy }));
		this.text = movePoints(drag.startText, moved);
		this.diagram = parseDiagram(this.text);
		this.render({ refit: false, updateText: true, updatePanel: false });
	}

	private endGroupDrag(): void {
		const drag = this.groupDrag;
		this.groupDrag = null;
		if (drag === null) return;
		if (this.text === drag.startText) this.undoStack.pop();
		this.render({ refit: this.pointOutsideFrame(), updateText: true, updatePanel: true });
	}

	private startMarquee(event: PointerEvent): void {
		const units = this.pointerToUnits(event);
		if (units === null) return;
		this.selection = null;
		this.render({ refit: false, updateText: false, updatePanel: true });
		this.marqueeStart = { x: units.x, y: units.y, clientX: event.clientX, clientY: event.clientY };
		const scale = this.frameScale(this.frame);
		if (this.svg !== null) {
			this.marqueeEl = this.svgChild(this.svg, "rect", { x: units.x * scale, y: -units.y * scale, width: 0, height: 0, class: "examiner-diagram-marquee" });
		}
		activeWindow.addEventListener("pointermove", this.onPointerMove);
		activeWindow.addEventListener("pointerup", this.onPointerUp);
	}

	private marqueeBox(event: PointerEvent): { minX: number; minY: number; maxX: number; maxY: number } | null {
		const start = this.marqueeStart;
		const units = this.pointerToUnits(event);
		if (start === null || units === null) return null;
		return {
			minX: Math.min(start.x, units.x),
			maxX: Math.max(start.x, units.x),
			minY: Math.min(start.y, units.y),
			maxY: Math.max(start.y, units.y),
		};
	}

	private updateMarquee(event: PointerEvent): void {
		const box = this.marqueeBox(event);
		const rect = this.marqueeEl;
		if (box === null || rect === null) return;
		const scale = this.frameScale(this.frame);
		rect.setAttribute("x", String(box.minX * scale));
		rect.setAttribute("y", String(-box.maxY * scale));
		rect.setAttribute("width", String((box.maxX - box.minX) * scale));
		rect.setAttribute("height", String((box.maxY - box.minY) * scale));
	}

	private finishMarquee(event: PointerEvent): void {
		const start = this.marqueeStart;
		const box = this.marqueeBox(event);
		this.marqueeStart = null;
		this.marqueeEl = null;
		if (start === null || box === null) return;
		const movedX = Math.abs(event.clientX - start.clientX);
		const movedY = Math.abs(event.clientY - start.clientY);
		if (movedX < MARQUEE_MIN_PIXELS && movedY < MARQUEE_MIN_PIXELS) {
			this.render({ refit: false, updateText: false, updatePanel: true });
			return;
		}
		const inside = (point: { x: number; y: number }) => point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
		const points = this.diagram.points.filter(inside).map((point) => point.name);
		const lines: number[] = [];
		this.diagram.shapes.forEach((shape, index) => {
			const source = this.diagram.sources[index];
			if (source === undefined) return;
			if (shapeAnchors(shape).every(inside)) lines.push(source.line);
		});
		if (points.length > 0 || lines.length > 0) this.selection = { kind: "many", points, lines };
		this.render({ refit: false, updateText: false, updatePanel: true });
	}

	private startDrag(name: string): void {
		this.selection = { kind: "point", name };
		this.draggedPoint = name;
		this.undoStack.push(this.text);
		this.redoStack.length = 0;
		activeWindow.addEventListener("pointermove", this.onPointerMove);
		activeWindow.addEventListener("pointerup", this.onPointerUp);
		this.render({ refit: false, updateText: false, updatePanel: true });
	}

	private stopListening(): void {
		activeWindow.removeEventListener("pointermove", this.onPointerMove);
		activeWindow.removeEventListener("pointerup", this.onPointerUp);
	}

	private pointerToUnits(event: PointerEvent): { x: number; y: number } | null {
		const svg = this.svg;
		if (svg === null) return null;
		const matrix = svg.getScreenCTM();
		if (matrix === null) return null;
		const screenPoint = svg.createSVGPoint();
		screenPoint.x = event.clientX;
		screenPoint.y = event.clientY;
		const local = screenPoint.matrixTransform(matrix.inverse());
		const scale = this.frameScale(this.frame);
		return { x: local.x / scale, y: -local.y / scale };
	}

	private dragTo(event: PointerEvent): void {
		if (this.marqueeStart !== null) {
			this.updateMarquee(event);
			return;
		}
		if (this.groupDrag !== null) {
			this.moveGroup(event);
			return;
		}
		const name = this.draggedPoint;
		if (name === null) return;
		const units = this.pointerToUnits(event);
		if (units === null) return;
		let x = units.x;
		let y = units.y;
		if (!event.altKey) {
			x = Math.round(x / GRID_STEP) * GRID_STEP;
			y = Math.round(y / GRID_STEP) * GRID_STEP;
		}
		const point = this.findPoint(name);
		if (point !== undefined && formatNumber(point.x) === formatNumber(x) && formatNumber(point.y) === formatNumber(y)) return;
		this.text = setPointPosition(this.text, name, x, y);
		this.diagram = parseDiagram(this.text);
		this.render({ refit: false, updateText: true, updatePanel: false });
	}

	private endDrag(event: PointerEvent): void {
		this.stopListening();
		if (this.marqueeStart !== null) {
			this.finishMarquee(event);
			return;
		}
		if (this.groupDrag !== null) {
			this.endGroupDrag();
			return;
		}
		if (this.draggedPoint === null) return;
		this.draggedPoint = null;
		const lastSaved = this.undoStack[this.undoStack.length - 1];
		if (lastSaved === this.text) this.undoStack.pop();
		this.render({ refit: this.pointOutsideFrame(), updateText: true, updatePanel: true });
	}

	private renderErrors(): void {
		this.errorsEl.empty();
		for (const error of this.diagram.errors) this.errorsEl.createDiv({ text: `Line ${error.line}: ${error.message}` });
	}

	private renderPanel(): void {
		this.panelEl.empty();
		const selection = this.selection;
		if (selection === null) return;
		if (selection.kind === "point") {
			const point = this.findPoint(selection.name);
			if (point !== undefined) this.renderPointPanel(point);
			return;
		}
		if (selection.kind === "many") {
			this.renderManyPanel(selection.points.length, selection.lines.length);
			return;
		}
		const source = this.findSource(selection.line);
		if (source !== undefined) this.renderShapePanel(source);
	}

	private field(label: string): HTMLElement {
		const field = this.panelEl.createEl("label", { cls: "examiner-field" });
		field.createSpan({ cls: "examiner-field-label", text: label });
		return field;
	}

	private textField(label: string, value: string, onCommit: (value: string, input: HTMLInputElement) => void): HTMLInputElement {
		const input = this.field(label).createEl("input", { type: "text", value });
		input.spellcheck = false;
		input.addEventListener("change", () => onCommit(input.value, input));
		return input;
	}

	private numberField(label: string, value: number | null, onCommit: (value: number | null) => void): void {
		let shown = "";
		if (value !== null) shown = formatNumber(value);
		this.textField(label, shown, (text, input) => {
			if (text.trim() === "") {
				onCommit(null);
				return;
			}
			const number = Number(text.trim().replace(/[−–]/g, "-"));
			if (!Number.isFinite(number)) {
				input.addClass("examiner-invalid");
				return;
			}
			onCommit(number);
		});
	}

	private deleteButton(onClick: () => void, disabled: boolean): void {
		const button = new ButtonComponent(this.panelEl).setButtonText("Delete").setDestructive().onClick(onClick);
		button.setDisabled(disabled);
	}

	private renderPointPanel(point: DiagramPointInfo): void {
		this.panelEl.createDiv({ cls: "examiner-diagram-editor-heading", text: `Point ${point.name}` });
		this.textField("Name", point.name, (value, input) => {
			const name = value.trim();
			if (name === point.name) return;
			if (!isValidPointName(name) || this.findPoint(name) !== undefined) {
				input.addClass("examiner-invalid");
				return;
			}
			this.selection = { kind: "point", name };
			this.change(renamePoint(this.text, point.name, name), false);
		});
		this.numberField("X", point.x, (value) => {
			if (value === null) return;
			this.change(setPointPosition(this.text, point.name, value, point.y), true);
		});
		this.numberField("Y", point.y, (value) => {
			if (value === null) return;
			this.change(setPointPosition(this.text, point.name, point.x, value), true);
		});
		this.deleteButton(() => this.deletePoint(point), this.pointInUse(point));
	}

	private pointInUse(point: DiagramPointInfo): boolean {
		const lines = this.text.split(/\r?\n/);
		for (let index = 0; index < lines.length; index++) {
			if (index + 1 === point.line) continue;
			if (lineUsesPoint(lines[index] ?? "", point.name)) return true;
		}
		return false;
	}

	private deletePoint(point: DiagramPointInfo): void {
		if (this.pointInUse(point)) return;
		this.selection = null;
		this.change(removeLine(this.text, point.line), false);
	}

	private renderShapePanel(source: ShapeSource): void {
		const raw = lineText(this.text, source.line);
		const update = (next: string) => this.change(replaceLine(this.text, source.line, next), false);
		this.panelEl.createDiv({ cls: "examiner-diagram-editor-heading", text: source.command });

		if (source.command === "label") {
			const tokenText = readLabelCommandText(raw);
			this.textField("Text", tokenText, (value) => update(setQuotedToken(raw, 1, value)));
		}
		if (source.options.includes("label")) {
			this.textField("Label", readLabel(raw, source.optionStart) ?? "", (value) => update(setLabel(raw, source.optionStart, value)));
		}
		if (source.options.includes("placement")) {
			const field = this.field("Placement");
			new DropdownComponent(field)
				.addOptions({ "": "Automatic", above: "Above", below: "Below", left: "Left", right: "Right" })
				.setValue(readPlacement(raw, source.optionStart) ?? "")
				.onChange((value) => {
					let placement: Placement | null = null;
					if (value !== "") placement = value as Placement;
					update(setPlacement(raw, source.optionStart, placement));
				});
		}
		for (const flag of ["thick", "dashed", "closed"] as const) {
			if (!source.options.includes(flag)) continue;
			const field = this.panelEl.createEl("label", { cls: "examiner-diagram-editor-check" });
			const box = field.createEl("input", { type: "checkbox" });
			box.checked = hasFlag(raw, source.optionStart, flag);
			field.createSpan({ text: FLAG_NAMES[flag] ?? flag });
			box.addEventListener("change", () => update(setFlag(raw, source.optionStart, flag, box.checked)));
		}
		if (source.options.includes("angle")) {
			this.numberField("Angle", readNumberOption(raw, source.optionStart, "angle"), (value) => update(setNumberOption(raw, source.optionStart, "angle", value)));
		}
		if (source.options.includes("size")) {
			this.numberField("Size", readNumberOption(raw, source.optionStart, "size"), (value) => update(setNumberOption(raw, source.optionStart, "size", value)));
		}
		this.textField("Line", raw, (value) => update(value));
		this.deleteButton(() => this.deleteShape(source), false);
	}

	private deleteShape(source: ShapeSource): void {
		this.selection = null;
		this.change(removeShapeLine(this.text, source.line), false);
	}

	private reset(): void {
		this.selection = null;
		this.pending = [];
		this.change("", true);
	}

	private renderManyPanel(pointCount: number, shapeCount: number): void {
		let shapes = `${shapeCount} shapes`;
		if (shapeCount === 1) shapes = "1 shape";
		let points = `${pointCount} points`;
		if (pointCount === 1) points = "1 point";
		this.panelEl.createDiv({ cls: "examiner-diagram-editor-heading", text: `${shapes}, ${points}` });
		this.deleteButton(() => this.deleteSelection(), false);
	}

	private deleteSelection(): void {
		const selection = this.selection;
		if (selection === null) return;
		if (selection.kind === "many") {
			this.selection = null;
			this.change(removeSelection(this.text, selection.lines, selection.points), false);
			return;
		}
		if (selection.kind === "shape") {
			const source = this.findSource(selection.line);
			if (source !== undefined) this.deleteShape(source);
			return;
		}
		const point = this.findPoint(selection.name);
		if (point !== undefined) this.deletePoint(point);
	}
}

function readLabelCommandText(line: string): string {
	const match = /"([^"]*)"/.exec(line);
	if (match === null) return "";
	return match[1] ?? "";
}
