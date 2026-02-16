/**
 * Сканирование workspace на комментарии-метки (например TODO, FIXME, XXX, HACK, BUG).
 * Используется панелью «Список дел» (todoPanelView).
 * @module todoScanner
 */

import * as vscode from 'vscode';
import { logger } from './logger';

/** Одна найденная метка в коде (тег, строка, URI, текст). */
export interface TodoEntry {
	uri: vscode.Uri;
	line: number;
	tag: string;
	message: string;
	/** Содержимое строки в файле. */
	lineContent: string;
}

const DEFAULT_TAGS = ['TODO', 'FIXME', 'XXX', 'HACK', 'BUG'];
const DEFAULT_INCLUDE = ['**/*.bsl', '**/*.os', '**/*.md', '**/*.feature'];
const DEFAULT_EXCLUDE = ['oscript_modules', 'out', '.git', 'vendor', 'build'];

function isUriExcluded(uri: vscode.Uri, excludeSegments: string[]): boolean {
	const pathNorm = uri.fsPath.replaceAll('\\', '/');
	return excludeSegments.some(
		(seg) => pathNorm.includes(`/${seg}/`) || pathNorm.endsWith(`/${seg}`)
	);
}

function buildTagRegex(tags: string[]): RegExp {
	const escaped = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
	return new RegExp(String.raw`\b(${escaped})\b\s*:?\s*(.*)`, 'i');
}

/**
 * Проверяет, что вхождение тега допустимо для типа файла:
 * .md — любой текст; .feature — только строки-комментарии (#); остальные — после // или <!--.
 */
function isCommentLine(uri: vscode.Uri, line: string, tagMatchIndex: number): boolean {
	const ext = (uri.fsPath.split('.').pop() ?? '').toLowerCase();
	if (ext === 'md') {return true;}
	if (ext === 'feature') {
		if (!line.trimStart().startsWith('#')) {return false;}
		const before = line.slice(0, tagMatchIndex).trim();
		return before === '' || before === '#' || before.startsWith('# ');
	}
	const before = line.slice(0, tagMatchIndex).trim();
	return before.endsWith('//') || before.startsWith('//') || before.includes('<!--');
}

function scanFile(uri: vscode.Uri, content: string, regex: RegExp): TodoEntry[] {
	const entries: TodoEntry[] = [];
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = regex.exec(line);
		if (match && isCommentLine(uri, line, line.indexOf(match[1]))) {
			entries.push({
				uri,
				line: i + 1,
				tag: match[1].toUpperCase(),
				message: (match[2] ?? '').trim(),
				lineContent: line.trimEnd(),
			});
		}
	}
	return entries;
}

/**
 * Сканирует workspace на комментарии-метки по настройкам 1c-platform-tools (include, exclude, tags).
 * @returns Отсортированный по пути и номеру строки массив записей
 */
export async function scanWorkspaceForTodos(): Promise<TodoEntry[]> {
	const config = vscode.workspace.getConfiguration('1c-platform-tools');
	const includePatterns = config.get<string[]>('todo.include') ?? DEFAULT_INCLUDE;
	const excludeSegments = config.get<string[]>('todo.exclude') ?? DEFAULT_EXCLUDE;
	const tags = config.get<string[]>('todo.tags') ?? DEFAULT_TAGS;

	const regex = buildTagRegex(tags);
	// Объединяем расширения в один glob при возможности; без лимита на число файлов
	const extFromPattern = (p: string): string | null => {
		const m = p.match(/^\*\*\/\*\.(\w+)$/);
		return m ? m[1].toLowerCase() : null;
	};
	const exts = includePatterns.map(extFromPattern).filter((e): e is string => e !== null);
	const singleGlob = exts.length === includePatterns.length && exts.length > 0
		? `**/*.{${exts.join(',')}}`
		: null;
	const files = singleGlob !== null
		? await vscode.workspace.findFiles(singleGlob)
		: await (async () => {
			const seen = new Set<string>();
			for (const p of includePatterns) {
				const found = await vscode.workspace.findFiles(p);
				for (const u of found) { seen.add(u.fsPath); }
			}
			return Array.from(seen).map((fp) => vscode.Uri.file(fp));
		})();
	const filteredFiles = files.filter((uri) => !isUriExcluded(uri, excludeSegments));

	const allEntries: TodoEntry[] = [];
	for (const uri of filteredFiles) {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
			allEntries.push(...scanFile(uri, content, regex));
		} catch (err) {
			logger.debug(`Не удалось прочитать файл ${uri.fsPath}: ${String(err)}`);
		}
	}

	allEntries.sort((a, b) => {
		const pathCompare = a.uri.fsPath.localeCompare(b.uri.fsPath);
		return pathCompare === 0 ? a.line - b.line : pathCompare;
	});
	return allEntries;
}
