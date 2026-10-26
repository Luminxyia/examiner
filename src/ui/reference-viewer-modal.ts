import { loadPdfJs, Modal } from "obsidian";
import type ExaminerPlugin from "../main";
import { attachmentKind, attachmentMimeType } from "../storage/attachments";
import { textButton } from "./shared";

interface PdfViewport {
	width: number;
	height: number;
}

interface PdfPage {
	getViewport(options: { scale: number }): PdfViewport;
	render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
}

interface PdfDocument {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPage>;
	destroy(): Promise<void>;
}

interface PdfJs {
	getDocument(source: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

export class ReferenceViewerModal extends Modal {
	private renderToken = 0;
	private objectUrl: string | null = null;
	private pdf: PdfDocument | null = null;

	constructor(
		private readonly plugin: ExaminerPlugin,
		private readonly examId: string,
		private readonly names: readonly string[],
		private index = 0,
	) {
		super(plugin.app);
	}

	override onOpen(): void {
		this.modalEl.addClass("examiner-reference-modal");
		this.scope.register([], "ArrowLeft", () => {
			this.move(-1);
			return false;
		});
		this.scope.register([], "ArrowRight", () => {
			this.move(1);
			return false;
		});
		void this.render();
	}

	override onClose(): void {
		this.renderToken++;
		this.release();
		this.contentEl.empty();
	}

	private release(): void {
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
		const pdf = this.pdf;
		this.pdf = null;
		if (pdf) void pdf.destroy().catch(() => undefined);
	}

	private move(offset: number): void {
		const next = this.index + offset;
		if (next < 0 || next >= this.names.length) return;
		this.index = next;
		void this.render();
	}

	private async render(): Promise<void> {
		const token = ++this.renderToken;
		this.release();
		const name = this.names[this.index] ?? "";
		this.setTitle(name);
		const { contentEl } = this;
		contentEl.empty();

		if (this.names.length > 1) {
			const nav = contentEl.createDiv({ cls: "examiner-reference-nav" });
			const previous = textButton(nav, "Previous");
			previous.disabled = this.index === 0;
			previous.addEventListener("click", () => this.move(-1));
			nav.createSpan({ cls: "examiner-muted examiner-small", text: `${this.index + 1} of ${this.names.length}` });
			const next = textButton(nav, "Next");
			next.disabled = this.index === this.names.length - 1;
			next.addEventListener("click", () => this.move(1));
		}

		const viewer = contentEl.createDiv({ cls: "examiner-reference-viewer" });
		const status = viewer.createDiv({ cls: "examiner-muted examiner-small", text: "Loading…" });
		const fail = (error: unknown) => {
			if (token !== this.renderToken) return;
			console.error(`Examiner: could not display ${name}`, error);
			viewer.empty();
			viewer.createDiv({ cls: "examiner-error-text", text: "This file could not be displayed. It may have been removed or damaged." });
		};

		try {
			const data = await this.plugin.attachments.read(this.examId, name);
			if (token !== this.renderToken) return;
			if (attachmentKind(name) === "image") {
				this.objectUrl = URL.createObjectURL(new Blob([data], { type: attachmentMimeType(name) }));
				const image = viewer.createEl("img", { cls: "examiner-reference-image", attr: { src: this.objectUrl, alt: name } });
				image.addEventListener("load", () => status.remove());
				image.addEventListener("error", () => fail(new Error("The image could not be decoded.")));
				return;
			}
			const pdfjs = (await loadPdfJs()) as PdfJs;
			const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
			if (token !== this.renderToken) {
				void pdf.destroy().catch(() => undefined);
				return;
			}
			this.pdf = pdf;
			status.remove();
			const ratio = window.devicePixelRatio || 1;
			for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
				const page = await pdf.getPage(pageNumber);
				if (token !== this.renderToken) return;
				const width = viewer.clientWidth || 800;
				const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
				const canvas = viewer.createEl("canvas", { cls: "examiner-reference-page" });
				canvas.width = Math.floor(viewport.width);
				canvas.height = Math.floor(viewport.height);
				const context = canvas.getContext("2d");
				if (!context) throw new Error("The page could not be drawn.");
				await page.render({ canvasContext: context, viewport }).promise;
			}
		} catch (error) {
			fail(error);
		}
	}
}
