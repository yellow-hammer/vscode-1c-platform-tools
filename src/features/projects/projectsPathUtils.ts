/**
 * Утилиты путей для списка проектов: expandHomePath, expandWithGlobPatterns, нормализация разделителей.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { glob } from 'glob';

const homeDir = os.homedir();
const HOME_TILDE = '~';
const HOME_VAR = '$home';

export function expandHomePath(inputPath: string): string {
	if (inputPath.startsWith(HOME_VAR)) {
		return path.normalize(path.join(homeDir, inputPath.slice(HOME_VAR.length)));
	}
	if (inputPath.startsWith(HOME_TILDE)) {
		return path.normalize(path.join(homeDir, inputPath.slice(HOME_TILDE.length)));
	}
	return inputPath;
}

export function updateWithPathSeparator(items: string[]): string[] {
	return items.map((p) => (path.sep === '\\' ? p.replaceAll('/', '\\') : p.replaceAll('\\', '/')));
}

function hasGlobPattern(value: string): boolean {
	return /[*?[\]{}()!]/.test(value);
}

/**
 * Разворачивает baseFolders: пути с glob-паттернами (например D:\dev\*)
 * заменяются на список реальных каталогов; ~ и $home раскрываются.
 */
export async function expandWithGlobPatterns(baseFolders: string[]): Promise<string[]> {
	const resolved: string[] = [];
	for (const base of baseFolders ?? []) {
		const expanded = expandHomePath(base);
		if (hasGlobPattern(expanded)) {
			try {
				const matches = await glob(expanded, { windowsPathsNoEscape: true });
				for (const match of matches) {
					try {
						if (fs.existsSync(match) && fs.statSync(match).isDirectory()) {
							resolved.push(path.normalize(match));
						}
					} catch {
						// пропускаем
					}
				}
			} catch {
				// игнорируем ошибки glob
			}
		} else {
			try {
				if (fs.existsSync(expanded)) {
					const stat = fs.statSync(expanded);
					if (stat.isDirectory()) {
						resolved.push(path.normalize(expanded));
					}
				}
			} catch {
				// пропускаем
			}
		}
	}
	return resolved;
}
