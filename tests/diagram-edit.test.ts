import { describe, expect, it } from "vitest";
import { parseDiagram } from "../src/core/diagram";
import {
	findDiagramBlocks,
	formatNumber,
	hasFlag,
	insertDiagramBlock,
	lineUsesPoint,
	readLabel,
	readNumberOption,
	readPlacement,
	removeLine,
	renamePoint,
	replaceDiagramBlock,
	setFlag,
	setLabel,
	setNumberOption,
	setPlacement,
	setPointPosition,
	setQuotedToken,
	replaceNoteBlock,
	removeShapeLine,
	removeSelection,
	movePoints,
	wordsInLine,
	addToDiagram,
	nextPointName,
	nextSymbolName,
} from "../src/core/diagram-edit";

const SOURCE = ["point A at 0, 0", "point B at 4, 0", 'line A B thick label "beam"', "dimension A B below"].join("\n");

function optionStartOf(source: string, line: number): number {
	const diagram = parseDiagram(source);
	const found = diagram.sources.find((entry) => entry.line === line);
	if (found === undefined) throw new Error(`No shape on line ${line}`);
	return found.optionStart;
}

describe("source information", () => {
	it("records points with their lines", () => {
		expect(parseDiagram(SOURCE).points).toEqual([
			{ name: "A", x: 0, y: 0, line: 1 },
			{ name: "B", x: 4, y: 0, line: 2 },
		]);
	});

	it("records each shape's line, command and options", () => {
		const sources = parseDiagram(SOURCE).sources;
		expect(sources[0]).toMatchObject({ line: 3, command: "line", optionStart: 3 });
		expect(sources[1]).toMatchObject({ line: 4, command: "dimension", optionStart: 3, options: ["placement", "label"] });
	});
});

describe("numbers", () => {
	it("rounds to two places without trailing zeros", () => {
		expect(formatNumber(1.5)).toBe("1.5");
		expect(formatNumber(2.004)).toBe("2");
		expect(formatNumber(-0.001)).toBe("0");
	});
});

describe("points", () => {
	it("moves a point", () => {
		expect(setPointPosition(SOURCE, "B", 5.25, -1)).toContain("point B at 5.25, -1");
	});

	it("renames a point everywhere it is used", () => {
		const renamed = renamePoint(SOURCE, "A", "P1");
		expect(renamed).toContain("point P1 at 0, 0");
		expect(renamed).toContain('line P1 B thick label "beam"');
		expect(renamed).toContain("dimension P1 B below");
	});

	it("leaves label text alone when renaming", () => {
		expect(renamePoint('label "A" at A', "A", "C")).toBe('label "A" at C');
	});

	it("finds lines that use a point", () => {
		expect(lineUsesPoint("line A B", "B")).toBe(true);
		expect(lineUsesPoint('label "B" at A', "B")).toBe(false);
	});

	it("removes a line", () => {
		expect(removeLine(SOURCE, 4).split("\n")).toHaveLength(3);
	});
});

describe("options", () => {
	const line = 'line A B thick label "beam"';
	const start = optionStartOf(SOURCE, 3);

	it("reads and replaces a label", () => {
		expect(readLabel(line, start)).toBe("beam");
		expect(setLabel(line, start, "frame")).toBe('line A B thick label "frame"');
		expect(setLabel(line, start, "")).toBe("line A B thick");
	});

	it("swaps double quotes in labels for single quotes", () => {
		expect(setLabel("line A B", 3, 'say "hi"')).toBe(`line A B label "say 'hi'"`);
	});

	it("turns flags on and off", () => {
		expect(hasFlag(line, start, "thick")).toBe(true);
		expect(setFlag(line, start, "thick", false)).toBe('line A B label "beam"');
		expect(setFlag(line, start, "dashed", true)).toBe('line A B thick label "beam" dashed');
	});

	it("sets placement without touching directions before the options", () => {
		const load = "distributed from A to B left length 1 label \"w\" right";
		const loadStart = optionStartOf(`point A at 0, 0\npoint B at 0, 4\n${load}`, 3);
		expect(readPlacement(load, loadStart)).toBe("right");
		expect(setPlacement(load, loadStart, "above")).toBe('distributed from A to B left length 1 label "w" above');
		expect(setPlacement(load, loadStart, null)).toBe('distributed from A to B left length 1 label "w"');
	});

	it("reads and sets number options", () => {
		const support = "pin-support at A angle 90";
		expect(readNumberOption(support, 3, "angle")).toBe(90);
		expect(setNumberOption(support, 3, "angle", 45.5)).toBe("pin-support at A angle 45.5");
		expect(setNumberOption(support, 3, "size", 0.5)).toBe("pin-support at A angle 90 size 0.5");
		expect(setNumberOption(support, 3, "angle", null)).toBe("pin-support at A");
	});

	it("changes the text of a label command", () => {
		expect(setQuotedToken('label "A" at A below', 1, "Joint A")).toBe('label "Joint A" at A below');
	});
});

describe("blocks", () => {
	const note = "Intro\n```examiner-diagram\npoint A at 0, 0\n```\nMiddle\n```examiner-diagram\n```\nEnd";

	it("finds every diagram block", () => {
		const blocks = findDiagramBlocks(note);
		expect(blocks.map((block) => block.source)).toEqual(["point A at 0, 0", ""]);
	});

	it("replaces one block's text", () => {
		const blocks = findDiagramBlocks(note);
		const second = blocks[1];
		if (second === undefined) throw new Error("missing block");
		expect(replaceDiagramBlock(note, second, "point B at 1, 1")).toBe(
			"Intro\n```examiner-diagram\npoint A at 0, 0\n```\nMiddle\n```examiner-diagram\npoint B at 1, 1\n```\nEnd",
		);
	});

	it("inserts a block on its own lines", () => {
		expect(insertDiagramBlock("ab", 1, "point A at 0, 0")).toBe("a\n```examiner-diagram\npoint A at 0, 0\n```\nb");
		expect(insertDiagramBlock("", 0, "")).toBe("```examiner-diagram\n```");
	});
});

describe("note blocks", () => {
	it("replaces the body between the fences", () => {
		const note = "Title\n```examiner-diagram\npoint A at 0, 0\n```\nEnd";
		expect(replaceNoteBlock(note, 1, 3, "point B at 1, 1\nline A B")).toBe("Title\n```examiner-diagram\npoint B at 1, 1\nline A B\n```\nEnd");
	});

	it("keeps Windows line endings", () => {
		const note = "```examiner-diagram\r\npoint A at 0, 0\r\n```";
		expect(replaceNoteBlock(note, 0, 2, "")).toBe("```examiner-diagram\r\n```");
	});

	it("refuses when the block has moved", () => {
		expect(replaceNoteBlock("Title\nText\n```", 0, 2, "x")).toBeNull();
	});
});

describe("adding", () => {
	it("puts new points after the last point and the shape at the end", () => {
		const source = "point A at 0, 0\nline A A\n";
		expect(addToDiagram(source, [{ name: "B", x: 1.5, y: -2 }], "line A B")).toBe("point A at 0, 0\npoint B at 1.5, -2\nline A A\nline A B");
	});

	it("starts an empty diagram", () => {
		expect(addToDiagram("", [{ name: "A", x: 0, y: 0 }], null)).toBe("point A at 0, 0");
	});

	it("picks the next free names", () => {
		expect(nextPointName(new Set(["A", "B", "D"]))).toBe("C");
		expect(nextPointName(new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")))).toBe("A1");
		expect(nextSymbolName("Q", new Set(["Q1", "Q2"]))).toBe("Q3");
	});
});

describe("deleting shapes", () => {
	const source = ["point A at 0, 0", "point B at 2, 0", "point C at 2, 2", "point D at 5, 5", "resistor from A to B", "wire B C"].join("\n");

	it("removes points only the deleted shape used", () => {
		expect(removeShapeLine(source, 5)).toBe(["point B at 2, 0", "point C at 2, 2", "point D at 5, 5", "wire B C"].join("\n"));
	});

	it("keeps points that other shapes still use", () => {
		expect(removeShapeLine(source, 6)).toBe(["point A at 0, 0", "point B at 2, 0", "point D at 5, 5", "resistor from A to B"].join("\n"));
	});

	it("keeps label points used by a label line", () => {
		expect(removeShapeLine('point A at 0, 0\nline A A\nlabel "A" at A', 2)).toBe('point A at 0, 0\nlabel "A" at A');
	});
});

describe("deleting a selection", () => {
	const source = ["point A at 0, 0", "point B at 2, 0", "point C at 2, 2", "point D at 5, 5", "resistor from A to B", "wire B C", "line C D"].join("\n");

	it("removes several shapes and their unused points in one go", () => {
		expect(removeSelection(source, [5, 6], [])).toBe(["point C at 2, 2", "point D at 5, 5", "line C D"].join("\n"));
	});

	it("removes selected points unless another shape still uses them", () => {
		expect(removeSelection(source, [5], ["A", "B", "D"])).toBe(["point B at 2, 0", "point C at 2, 2", "point D at 5, 5", "wire B C", "line C D"].join("\n"));
	});

	it("removes a lone selected point", () => {
		expect(removeSelection("point A at 0, 0\npoint B at 1, 1\nline B B", [], ["A"])).toBe("point B at 1, 1\nline B B");
	});
});

describe("moving several points", () => {
	it("moves each named point", () => {
		const source = "point A at 0, 0\npoint B at 1, 0\nline A B";
		expect(movePoints(source, [{ name: "A", x: 0.5, y: 1 }, { name: "B", x: 1.5, y: 1 }])).toBe("point A at 0.5, 1\npoint B at 1.5, 1\nline A B");
	});

	it("lists the unquoted words after the command", () => {
		expect(wordsInLine('resistor from A to B label "R1"')).toEqual(["from", "A", "to", "B", "label"]);
	});
});
