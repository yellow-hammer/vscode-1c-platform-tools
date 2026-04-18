/**
 * Список недавно открытых проектов (по порядку использования).
 */

const STORAGE_KEY = '1c-platform-tools.projects.recent';
const MAX_ITEMS = 10;

export class ProjectsStack {
	private recent: string[] = [];

	constructor(
		private readonly read: (key: string) => string | undefined,
		private readonly write: (key: string, value: string) => Thenable<void>
	) {
		const stored = read(STORAGE_KEY);
		if (stored) {
			try {
				const parsed = JSON.parse(stored);
				this.recent = Array.isArray(parsed) ? parsed : [];
			} catch {
				this.recent = [];
			}
		}
	}

	/** Добавляет проект в начало списка недавних. */
	addRecent(name: string): void {
		const idx = this.recent.indexOf(name);
		if (idx >= 0) {this.recent.splice(idx, 1);}
		this.recent.unshift(name);
		if (this.recent.length > MAX_ITEMS) {
			this.recent = this.recent.slice(0, MAX_ITEMS);
		}
		void this.write(STORAGE_KEY, JSON.stringify(this.recent));
	}

	remove(name: string): void {
		const idx = this.recent.indexOf(name);
		if (idx >= 0) {
			this.recent.splice(idx, 1);
			void this.write(STORAGE_KEY, JSON.stringify(this.recent));
		}
	}

	rename(oldName: string, newName: string): void {
		const idx = this.recent.indexOf(oldName);
		if (idx >= 0) {
			this.recent[idx] = newName;
			void this.write(STORAGE_KEY, JSON.stringify(this.recent));
		}
	}

	size(): number {
		return this.recent.length;
	}

	/** Элемент по индексу (0 — самый недавний). */
	at(index: number): string {
		return this.recent[index] ?? '';
	}

	push(name: string): void {
		this.addRecent(name);
	}
	pop(name: string): void {
		this.remove(name);
	}
	length(): number {
		return this.size();
	}
	getItem(index: number): string {
		return this.at(index);
	}
}
