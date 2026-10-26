export class LoadState {
	ready = false;
	error: string | null = null;
	private running: Promise<boolean> | null = null;
	private readonly listeners = new Set<() => void>();

	get loading(): boolean {
		return this.running !== null;
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	run(task: () => Promise<unknown>): Promise<boolean> {
		this.running ??= this.attempt(task).finally(() => {
			this.running = null;
		});
		return this.running;
	}

	private async attempt(task: () => Promise<unknown>): Promise<boolean> {
		if (this.error !== null) this.update(false, null);
		try {
			await task();
		} catch (error) {
			this.update(false, error instanceof Error ? error.message : String(error));
			return false;
		}
		this.update(true, null);
		return true;
	}

	private update(ready: boolean, error: string | null): void {
		this.ready = ready;
		this.error = error;
		for (const listener of this.listeners) listener();
	}
}
