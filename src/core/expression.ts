export class ExpressionError extends Error {
	constructor(
		message: string,
		readonly position?: number,
	) {
		super(message);
		this.name = "ExpressionError";
	}
}

export type Expression =
	| { type: "number"; value: number }
	| { type: "variable"; name: string; position: number }
	| { type: "constant"; name: string }
	| { type: "negate"; operand: Expression }
	| { type: "binary"; operator: "+" | "-" | "*" | "/" | "^"; left: Expression; right: Expression; position: number }
	| { type: "call"; name: string; args: Expression[]; position: number };

export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const CONSTANTS: Readonly<Record<string, number>> = {
	pi: Math.PI,
	e: Math.E,
};

interface MathFunction {
	minArgs: number;
	maxArgs: number;
	description: string;
	apply: (args: number[]) => number;
}

function requireDomain(condition: boolean, message: string): void {
	if (!condition) throw new ExpressionError(message);
}

export const FUNCTIONS: Readonly<Record<string, MathFunction>> = {
	sqrt: {
		minArgs: 1, maxArgs: 1, description: "Square root",
		apply: ([x]) => {
			requireDomain(x >= 0, `sqrt(${x}) is undefined: the argument must not be negative`);
			return Math.sqrt(x);
		},
	},
	cbrt: { minArgs: 1, maxArgs: 1, description: "Cube root", apply: ([x]) => Math.cbrt(x) },
	abs: { minArgs: 1, maxArgs: 1, description: "Absolute value", apply: ([x]) => Math.abs(x) },
	sin: { minArgs: 1, maxArgs: 1, description: "Sine (radians)", apply: ([x]) => Math.sin(x) },
	cos: { minArgs: 1, maxArgs: 1, description: "Cosine (radians)", apply: ([x]) => Math.cos(x) },
	tan: { minArgs: 1, maxArgs: 1, description: "Tangent (radians)", apply: ([x]) => Math.tan(x) },
	asin: {
		minArgs: 1, maxArgs: 1, description: "Inverse sine, in radians",
		apply: ([x]) => {
			requireDomain(x >= -1 && x <= 1, `asin(${x}) is undefined: the argument must be between -1 and 1`);
			return Math.asin(x);
		},
	},
	acos: {
		minArgs: 1, maxArgs: 1, description: "Inverse cosine, in radians",
		apply: ([x]) => {
			requireDomain(x >= -1 && x <= 1, `acos(${x}) is undefined: the argument must be between -1 and 1`);
			return Math.acos(x);
		},
	},
	atan: { minArgs: 1, maxArgs: 1, description: "Inverse tangent, in radians", apply: ([x]) => Math.atan(x) },
	deg: { minArgs: 1, maxArgs: 1, description: "Convert radians to degrees", apply: ([x]) => (x * 180) / Math.PI },
	rad: { minArgs: 1, maxArgs: 1, description: "Convert degrees to radians", apply: ([x]) => (x * Math.PI) / 180 },
	ln: {
		minArgs: 1, maxArgs: 1, description: "Natural logarithm",
		apply: ([x]) => {
			requireDomain(x > 0, `ln(${x}) is undefined: the argument must be greater than 0`);
			return Math.log(x);
		},
	},
	log: {
		minArgs: 1, maxArgs: 2, description: "Logarithm, base 10 by default: log(x) or log(x, base)",
		apply: ([x, base]) => {
			requireDomain(x > 0, `log(${x}) is undefined: the argument must be greater than 0`);
			if (base === undefined) return Math.log10(x);
			requireDomain(base > 0 && base !== 1, `log base ${base} is invalid: it must be greater than 0 and not 1`);
			return Math.log(x) / Math.log(base);
		},
	},
	exp: { minArgs: 1, maxArgs: 1, description: "e raised to a power", apply: ([x]) => Math.exp(x) },
	floor: { minArgs: 1, maxArgs: 1, description: "Round down to an integer", apply: ([x]) => Math.floor(x) },
	ceil: { minArgs: 1, maxArgs: 1, description: "Round up to an integer", apply: ([x]) => Math.ceil(x) },
	round: {
		minArgs: 1, maxArgs: 1, description: "Round to the nearest integer, halves away from zero",
		apply: ([x]) => Math.sign(x) * Math.round(Math.abs(x)),
	},
	min: { minArgs: 1, maxArgs: Infinity, description: "Smallest argument", apply: (args) => Math.min(...args) },
	max: { minArgs: 1, maxArgs: Infinity, description: "Largest argument", apply: (args) => Math.max(...args) },
};

type Token =
	| { kind: "number"; value: number; position: number }
	| { kind: "variable"; name: string; position: number }
	| { kind: "name"; name: string; position: number }
	| { kind: "symbol"; symbol: string; position: number }
	| { kind: "end"; position: number };

const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/;
const VARIABLE_PATTERN = /^\{\s*([^{}]*?)\s*\}/;

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < source.length) {
		const char = source.charAt(i);
		if (/\s/.test(char)) {
			i++;
			continue;
		}
		const rest = source.slice(i);
		const numberMatch = NUMBER_PATTERN.exec(rest);
		if (numberMatch) {
			tokens.push({ kind: "number", value: Number(numberMatch[0]), position: i });
			i += numberMatch[0].length;
			continue;
		}
		if (char === "{") {
			const variableMatch = VARIABLE_PATTERN.exec(rest);
			if (!variableMatch) throw new ExpressionError("Unclosed variable reference: missing }", i);
			const name = variableMatch[1] ?? "";
			if (!VARIABLE_NAME_PATTERN.test(name)) {
				throw new ExpressionError(`"${variableMatch[0]}" is not a valid variable reference`, i);
			}
			tokens.push({ kind: "variable", name, position: i });
			i += variableMatch[0].length;
			continue;
		}
		const nameMatch = NAME_PATTERN.exec(rest);
		if (nameMatch) {
			tokens.push({ kind: "name", name: nameMatch[0], position: i });
			i += nameMatch[0].length;
			continue;
		}
		if ("+-*/^(),".includes(char)) {
			tokens.push({ kind: "symbol", symbol: char, position: i });
			i++;
			continue;
		}
		if (char === "×" || char === "·") {
			tokens.push({ kind: "symbol", symbol: "*", position: i });
			i++;
			continue;
		}
		if (char === "÷") {
			tokens.push({ kind: "symbol", symbol: "/", position: i });
			i++;
			continue;
		}
		if (char === "−") {
			tokens.push({ kind: "symbol", symbol: "-", position: i });
			i++;
			continue;
		}
		throw new ExpressionError(`Unexpected character "${char}"`, i);
	}
	tokens.push({ kind: "end", position: source.length });
	return tokens;
}

class Parser {
	private index = 0;

	constructor(private readonly tokens: Token[]) {}

	parse(): Expression {
		if (this.peek().kind === "end") throw new ExpressionError("The expression is empty", 0);
		const expression = this.parseSum();
		const next = this.peek();
		if (next.kind !== "end") {
			throw new ExpressionError(`Unexpected ${describeToken(next)}. Use * for multiplication.`, next.position);
		}
		return expression;
	}

	private peek(): Token {
		return this.tokens[this.index];
	}

	private next(): Token {
		const token = this.peek();
		if (token.kind !== "end") this.index++;
		return token;
	}

	private isSymbol(symbol: string): boolean {
		const token = this.peek();
		return token.kind === "symbol" && token.symbol === symbol;
	}

	private expectSymbol(symbol: string): void {
		const token = this.peek();
		if (!this.isSymbol(symbol)) {
			throw new ExpressionError(`Expected "${symbol}" but found ${describeToken(token)}`, token.position);
		}
		this.index++;
	}

	private parseSum(): Expression {
		let left = this.parseProduct();
		while (this.isSymbol("+") || this.isSymbol("-")) {
			const token = this.next() as Extract<Token, { kind: "symbol" }>;
			const right = this.parseProduct();
			left = { type: "binary", operator: token.symbol as "+" | "-", left, right, position: token.position };
		}
		return left;
	}

	private parseProduct(): Expression {
		let left = this.parseUnary();
		while (this.isSymbol("*") || this.isSymbol("/")) {
			const token = this.next() as Extract<Token, { kind: "symbol" }>;
			const right = this.parseUnary();
			left = { type: "binary", operator: token.symbol as "*" | "/", left, right, position: token.position };
		}
		return left;
	}

	private parseUnary(): Expression {
		if (this.isSymbol("-")) {
			this.next();
			return { type: "negate", operand: this.parseUnary() };
		}
		if (this.isSymbol("+")) {
			this.next();
			return this.parseUnary();
		}
		return this.parsePower();
	}

	private parsePower(): Expression {
		const base = this.parsePrimary();
		if (this.isSymbol("^")) {
			const token = this.next();
			const exponent = this.parseUnary();
			return { type: "binary", operator: "^", left: base, right: exponent, position: token.position };
		}
		return base;
	}

	private parsePrimary(): Expression {
		const token = this.next();
		switch (token.kind) {
			case "number":
				return { type: "number", value: token.value };
			case "variable":
				return { type: "variable", name: token.name, position: token.position };
			case "name":
				return this.parseName(token);
			case "symbol":
				if (token.symbol === "(") {
					const inner = this.parseSum();
					this.expectSymbol(")");
					return inner;
				}
				throw new ExpressionError(`Unexpected ${describeToken(token)}`, token.position);
			case "end":
				throw new ExpressionError("The expression ends unexpectedly", token.position);
		}
	}

	private parseName(token: Extract<Token, { kind: "name" }>): Expression {
		if (this.isSymbol("(")) {
			const fn = FUNCTIONS[token.name];
			if (!fn) throw new ExpressionError(`Unknown function "${token.name}"`, token.position);
			this.next();
			const args: Expression[] = [];
			if (!this.isSymbol(")")) {
				args.push(this.parseSum());
				while (this.isSymbol(",")) {
					this.next();
					args.push(this.parseSum());
				}
			}
			this.expectSymbol(")");
			if (args.length < fn.minArgs || args.length > fn.maxArgs) {
				throw new ExpressionError(`${token.name}() ${describeArity(fn)}, but got ${args.length}`, token.position);
			}
			return { type: "call", name: token.name, args, position: token.position };
		}
		if (token.name in CONSTANTS) return { type: "constant", name: token.name };
		if (token.name in FUNCTIONS) {
			throw new ExpressionError(`${token.name} is a function and needs parentheses, for example ${token.name}(x)`, token.position);
		}
		throw new ExpressionError(
			`Unknown name "${token.name}". Variables must be written in braces, for example {${token.name}}`,
			token.position,
		);
	}
}

function describeArity(fn: MathFunction): string {
	if (fn.maxArgs === Infinity) return `needs at least ${fn.minArgs} argument${fn.minArgs === 1 ? "" : "s"}`;
	if (fn.minArgs === fn.maxArgs) return `takes ${fn.minArgs} argument${fn.minArgs === 1 ? "" : "s"}`;
	return `takes ${fn.minArgs} to ${fn.maxArgs} arguments`;
}

function describeToken(token: Token): string {
	switch (token.kind) {
		case "number":
			return `number ${token.value}`;
		case "variable":
			return `variable {${token.name}}`;
		case "name":
			return `"${token.name}"`;
		case "symbol":
			return `"${token.symbol}"`;
		case "end":
			return "end of expression";
	}
}

export function parseExpression(source: string): Expression {
	return new Parser(tokenize(source)).parse();
}

export function referencedVariables(expression: Expression): string[] {
	const names = new Set<string>();
	const visit = (node: Expression): void => {
		switch (node.type) {
			case "variable":
				names.add(node.name);
				break;
			case "negate":
				visit(node.operand);
				break;
			case "binary":
				visit(node.left);
				visit(node.right);
				break;
			case "call":
				node.args.forEach(visit);
				break;
			case "number":
			case "constant":
				break;
		}
	};
	visit(expression);
	return [...names];
}

export type Scope = ReadonlyMap<string, number>;

export function evaluate(expression: Expression, scope: Scope): number {
	return checkFinite(evaluateNode(expression, scope));
}

function evaluateNode(node: Expression, scope: Scope): number {
	switch (node.type) {
		case "number":
			return node.value;
		case "constant":
			return CONSTANTS[node.name];
		case "variable": {
			const value = scope.get(node.name);
			if (value === undefined) throw new ExpressionError(`{${node.name}} has no value at this point`, node.position);
			return value;
		}
		case "negate":
			return -evaluateNode(node.operand, scope);
		case "binary":
			return checkFinite(applyOperator(node, evaluateNode(node.left, scope), evaluateNode(node.right, scope)), node.position);
		case "call": {
			const fn = FUNCTIONS[node.name];
			const args = node.args.map((arg) => evaluateNode(arg, scope));
			try {
				return checkFinite(fn.apply(args), node.position);
			} catch (error) {
				if (error instanceof ExpressionError && error.position === undefined) {
					throw new ExpressionError(error.message, node.position);
				}
				throw error;
			}
		}
	}
}

function applyOperator(node: Extract<Expression, { type: "binary" }>, left: number, right: number): number {
	switch (node.operator) {
		case "+":
			return left + right;
		case "-":
			return left - right;
		case "*":
			return left * right;
		case "/":
			if (right === 0) throw new ExpressionError("Division by zero", node.position);
			return left / right;
		case "^":
			if (left === 0 && right < 0) throw new ExpressionError("Division by zero: 0 raised to a negative power", node.position);
			if (left < 0 && !Number.isInteger(right)) {
				throw new ExpressionError(`${left}^${right} is not a real number`, node.position);
			}
			return Math.pow(left, right);
	}
}

function checkFinite(value: number, position?: number): number {
	if (Number.isNaN(value)) throw new ExpressionError("The result is not a real number", position);
	if (!Number.isFinite(value)) throw new ExpressionError("The result is too large to represent", position);
	return value;
}
