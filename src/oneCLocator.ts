/**
 * Локатор проектов 1С:
 * кэш в файле (globalStoragePath), загрузка при создании, сканирование через fs.readdirSync.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { minimatch } from 'minimatch';

import { expandHomePath, expandWithGlobPatterns, updateWithPathSeparator } from './projectsPathUtils';

const PACKAGEDEF = 'packagedef';
const CACHE_FILENAME = 'projects_cache_1c.json';

interface CacheShape {
	paths: string[];
	baseFolders: string[];
	ignorePatterns: string[];
}

export class OneCLocator {
	public projectList: string[] = [];
	private alreadyLocated = false;
	private baseFolders: string[] = [];
	private maxDepth = 0;
	private ignoredFolders: string[] = [];
	private useCachedProjects = true;
	private readonly cacheFilePath: string;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.cacheFilePath = path.join(context.globalStoragePath, CACHE_FILENAME);
		this.refreshConfig();
		this.initializeCfg();
	}

	private getPathDepth(p: string): number {
		let depth = p.split(path.sep).length;
		if (p.endsWith(path.sep)) {
			depth--;
		}
		return depth;
	}

	private isMaxDepthReached(currentDepth: number, initialDepth: number): boolean {
		return this.maxDepth > 0 && currentDepth - initialDepth > this.maxDepth;
	}

	private isFolderIgnored(folderName: string): boolean {
		const matches = this.ignoredFolders.filter((f) => minimatch(folderName, f, { matchBase: true }));
		return matches.length > 0;
	}

	private refreshConfig(): void {
		const config = vscode.workspace.getConfiguration('1c-platform-tools');
		const folders = config.get<string[]>('projects.baseFolders');
		this.baseFolders = Array.isArray(folders) ? folders.filter((p): p is string => typeof p === 'string' && p.length > 0) : [];
		const patterns = config.get<string[]>('projects.ignorePatterns');
		this.ignoredFolders = Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
		this.maxDepth = config.get<number>('projects.maxDepthRecursion', 0);
		this.useCachedProjects = config.get<boolean>('projects.cacheBetweenSessions', true);
	}

	private initializeCfg(): void {
		if (!this.useCachedProjects || !fs.existsSync(this.cacheFilePath)) {
			return;
		}
		try {
			const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
			const data = JSON.parse(raw) as CacheShape;
			if (Array.isArray(data.paths) && Array.isArray(data.baseFolders) && Array.isArray(data.ignorePatterns)) {
				this.projectList = data.paths.map((p) => path.normalize(p));
				this.alreadyLocated = true;
			}
		} catch {
			this.deleteCacheFile();
		}
	}

	private updateCacheFile(): void {
		this.alreadyLocated = true;
		try {
			const dir = path.dirname(this.cacheFilePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(
				this.cacheFilePath,
				JSON.stringify(
					{
						paths: this.projectList,
						baseFolders: this.baseFolders,
						ignorePatterns: this.ignoredFolders,
					} satisfies CacheShape,
					null,
					'\t'
				),
				'utf8'
			);
		} catch {
			// ignore
		}
	}

	public isAlreadyLocated(): boolean {
		return this.alreadyLocated;
	}

	public deleteCacheFile(): void {
		if (fs.existsSync(this.cacheFilePath)) {
			try {
				fs.unlinkSync(this.cacheFilePath);
			} catch {
				// ignore
			}
		}
	}

	private scanDir(dir: string, initialDepth: number, seen: Set<string>): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		const hasPackagedef = entries.some((e) => !e.isDirectory() && e.name === PACKAGEDEF);
		if (hasPackagedef) {
			const norm = path.normalize(dir);
			if (!seen.has(norm)) {
				seen.add(norm);
				this.projectList.push(norm);
			}
		}
		for (const e of entries) {
			if (!e.isDirectory()) {
				continue;
			}
			if (this.isFolderIgnored(e.name)) {
				continue;
			}
			const childPath = path.join(dir, e.name);
			if (this.isMaxDepthReached(this.getPathDepth(childPath), initialDepth)) {
				continue;
			}
			this.scanDir(childPath, initialDepth, seen);
		}
	}

	public async locateProjects(): Promise<string[]> {
		this.refreshConfig();
		let projectsDirList = this.baseFolders.map((p) => expandHomePath(p));
		projectsDirList = await expandWithGlobPatterns(projectsDirList);
		projectsDirList = updateWithPathSeparator(projectsDirList);
		this.baseFolders = projectsDirList.slice();

		if (projectsDirList.length === 0) {
			this.projectList = [];
			return [];
		}

		if (this.alreadyLocated && this.useCachedProjects) {
			return this.projectList;
		}

		this.projectList = [];
		const seen = new Set<string>();

		for (const projectBasePath of projectsDirList) {
			if (!fs.existsSync(projectBasePath)) {
				continue;
			}
			const stat = fs.statSync(projectBasePath);
			if (!stat.isDirectory()) {
				continue;
			}
			const initialDepth = this.getPathDepth(projectBasePath);
			this.scanDir(projectBasePath, initialDepth, seen);
		}

		this.projectList.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
		this.updateCacheFile();
		return this.projectList;
	}

	public async refreshProjects(forceRefresh: boolean): Promise<boolean> {
		this.refreshConfig();
		this.projectList = [];
		this.deleteCacheFile();
		this.alreadyLocated = false;
		await this.locateProjects();
		return true;
	}
}
