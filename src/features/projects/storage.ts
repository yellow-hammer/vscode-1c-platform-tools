/**
 * Хранилище избранных проектов (JSON-файл).
 */

import * as fs from 'node:fs';
import { createProject, type Project } from './project';
import { UNTAGGED_LABEL } from './constants';
import { expandHomePath, updateWithPathSeparatorStr } from './pathUtils';

export interface FavoriteEntry {
	label: string;
	description: string;
}

export class ProjectStorage {
	private items: Project[] = [];

	constructor(private readonly filePath: string) {}

	add(name: string, rootPath: string): void {
		this.items.push(createProject(name, rootPath));
	}

	remove(name: string): Project | undefined {
		const i = this.findIndex(name);
		return i >= 0 ? this.items.splice(i, 1)[0] : undefined;
	}

	rename(before: string, after: string): void {
		const p = this.find(before);
		if (p) {p.name = after;}
	}

	setTags(name: string, tags: string[]): void {
		const p = this.find(name);
		if (p) {p.tags = tags;}
	}

	setEnabled(name: string, enabled: boolean): boolean | undefined {
		const p = this.find(name);
		if (p) {
			p.enabled = enabled;
			return p.enabled;
		}
		return undefined;
	}

	toggleEnabled(name: string): boolean | undefined {
		const p = this.find(name);
		if (p) {
			p.enabled = !p.enabled;
			return p.enabled;
		}
		return undefined;
	}

	hidden(): Project[] {
		return this.items.filter((p) => !p.enabled);
	}

	updatePath(name: string, newPath: string): void {
		const p = this.find(name);
		if (p) {p.rootPath = newPath;}
	}

	hasName(name: string): boolean {
		return this.findIndex(name) >= 0;
	}

	getByName(name: string): Project | undefined {
		return this.find(name);
	}

	hasPath(rootPath: string, expandPath = false): Project | undefined {
		const norm = rootPath.toLowerCase();
		for (const p of this.items) {
			const exp = expandHomePath(p.rootPath);
			if (exp.toLowerCase() === norm || exp === rootPath) {
				return expandPath ? { ...p, rootPath: exp } : p;
			}
		}
		return undefined;
	}

	count(): number {
		return this.items.length;
	}

	load(): string {
		if (!fs.existsSync(this.filePath)) {return '';}
		try {
			const raw = fs.readFileSync(this.filePath, 'utf8');
			const data = JSON.parse(raw) as unknown[];
			if (!Array.isArray(data) || data.length === 0) {return '';}
			const first = data[0];
			if (first && typeof first === 'object' && 'label' in (first as object)) {
				for (const el of data as Array<{ label: string; description: string }>) {
					this.items.push(createProject(el.label, el.description));
				}
				this.persist();
			} else {
				this.items = (data as Array<Partial<Project>>).map((item) => ({
					name: item.name ?? '',
					rootPath: updateWithPathSeparatorStr(item.rootPath ?? ''),
					paths: item.paths ?? [],
					tags: item.tags ?? [],
					enabled: item.enabled ?? true,
				}));
			}
			return '';
		} catch (err) {
			return err instanceof Error ? err.message : String(err);
		}
	}

	save(): void {
		this.persist();
	}

	/** Список для QuickPick: только включённые проекты. */
	entries(): FavoriteEntry[] {
		return this.items
			.filter((p) => p.enabled)
			.map((p) => ({
				label: p.name,
				description: expandHomePath(p.rootPath),
			}));
	}

	allTags(): string[] {
		const set = new Set<string>();
		for (const p of this.items) {
			p.tags.forEach((t) => set.add(t));
		}
		return [...set].sort();
	}

	/** Проекты с одним указанным тегом (или без тегов при tag === ''). */
	byTag(tag: string): FavoriteEntry[] {
		const filtered = this.items.filter(
			(p) => p.enabled && (tag === '' ? p.tags.length === 0 : p.tags.includes(tag))
		);
		return filtered.map((p) => ({
			label: p.name,
			description: expandHomePath(p.rootPath),
		}));
	}

	/** Проекты, удовлетворяющие фильтру тегов (или все, если фильтр пуст). */
	byTags(activeTags: string[]): FavoriteEntry[] {
		if (activeTags.length === 0) {return this.entries();}
		const filtered = this.items.filter(
			(p) =>
				p.enabled &&
				(p.tags.some((t) => activeTags.includes(t)) ||
					(activeTags.includes(UNTAGGED_LABEL) && p.tags.length === 0))
		);
		return filtered.map((p) => ({
			label: p.name,
			description: expandHomePath(p.rootPath),
		}));
	}

	private find(name: string): Project | undefined {
		const i = this.findIndex(name);
		return i >= 0 ? this.items[i] : undefined;
	}

	private findIndex(name: string): number {
		const lower = name.toLowerCase();
		return this.items.findIndex((p) => p.name.toLowerCase() === lower);
	}

	private persist(): void {
		const dir = this.filePath.replace(/[/\\][^/\\]*$/, '');
		if (dir && dir !== this.filePath && !fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, '\t'), 'utf8');
	}

	push(name: string, rootPath: string): void {
		this.add(name, rootPath);
	}
	pop(name: string): Project | undefined {
		return this.remove(name);
	}
	map(): FavoriteEntry[] {
		return this.entries();
	}
	length(): number {
		return this.count();
	}
	disabled(): Project[] {
		return this.hidden();
	}
	updateRootPath(name: string, path: string): void {
		this.updatePath(name, path);
	}
	exists(name: string): boolean {
		return this.hasName(name);
	}
	getProjectByName(name: string): Project | undefined {
		return this.getByName(name);
	}
	existsWithRootPath(rootPath: string, returnExpandedPath = false): Project | undefined {
		return this.hasPath(rootPath, returnExpandedPath);
	}
	getAvailableTags(): string[] {
		return this.allTags();
	}
	getProjectsByTag(tag: string): FavoriteEntry[] {
		return this.byTag(tag);
	}
	getProjectsByTags(tags: string[]): FavoriteEntry[] {
		return this.byTags(tags);
	}
	editTags(name: string, tags: string[]): void {
		this.setTags(name, tags);
	}
}
