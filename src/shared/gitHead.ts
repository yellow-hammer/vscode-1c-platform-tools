/**
 * Чтение текущей ветки git по файлу `.git/HEAD`.
 *
 * Файл читается напрямую (без запуска git): мгновенно, синхронно и не требует
 * git в PATH. Поддерживаются обычный каталог `.git` и файл-ссылка `.git`
 * с `gitdir:` (worktree, подмодуль).
 */

import * as path from 'node:path';
import * as fsSync from 'node:fs';
import { branchDirNameFromHead, parseGitHead } from './launchVariables';

/**
 * Каталог git-данных проекта: `.git` либо путь из файла-ссылки `gitdir:`.
 *
 * @param root - Корень проекта
 * @returns Абсолютный путь к каталогу git-данных или undefined вне репозитория
 */
function resolveGitDir(root: string): string | undefined {
	const dotGit = path.join(root, '.git');
	let stats: fsSync.Stats;
	try {
		stats = fsSync.statSync(dotGit);
	} catch {
		return undefined;
	}
	if (stats.isDirectory()) {
		return dotGit;
	}
	// worktree/подмодуль: .git — файл вида `gitdir: <путь>`
	try {
		const content = fsSync.readFileSync(dotGit, 'utf8');
		const match = /^gitdir:\s*(.+)\s*$/m.exec(content);
		if (match) {
			const gitDir = match[1].trim();
			return path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
		}
	} catch {
		// нечитаемый .git — репозиторием не считаем
	}
	return undefined;
}

/**
 * Имя каталога текущей ветки git для подстановки `${gitBranch}`.
 *
 * Значение вычисляется на момент вызова — переключение ветки подхватывается
 * следующей командой без перезагрузки окна. Для отсоединённого HEAD
 * возвращаются первые 8 символов хэша коммита.
 *
 * @param root - Корень проекта
 * @returns Имя каталога ветки или undefined вне репозитория git
 */
export function readGitBranchDirName(root: string): string | undefined {
	const gitDir = resolveGitDir(root);
	if (!gitDir) {
		return undefined;
	}
	try {
		const head = fsSync.readFileSync(path.join(gitDir, 'HEAD'), 'utf8');
		return branchDirNameFromHead(parseGitHead(head));
	} catch {
		return undefined;
	}
}
