/**
 * @file Пошаговое руководство «Начало работы»: встроенный walkthrough VS Code либо Webview.
 *
 * @remarks
 * - **Cursor** — Webview (встроенная страница Welcome/walkthrough недоступна).
 * - **VS Code** — `workbench.action.openWalkthrough`; при гонке с регистрацией категории —
 *   отложенный вызов и при ошибке команды тот же сценарий во Webview.
 * Контент шагов читается из `contributes.walkthroughs` и `walkthrough/*.md`.
 *
 * @see {@link https://github.com/yellow-hammer/vscode-1c-platform-tools/blob/main/.cursor/rules/get-started-cursor-fallback.mdc}
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { fillWebviewTemplate, loadWebviewTemplate } from '../../shared/webviewTemplate';

const log = logger.scope('walkthrough');

const WELCOMED_KEY = '1c-platform-tools.getStarted.welcomed';

/** Локальный id первого walkthrough в `package.json` (`contributes.walkthroughs`). */
const GET_STARTED_WALKTHROUGH_LOCAL_ID = '1c-platform-tools.getStarted';

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Полный идентификатор категории для `workbench.action.openWalkthrough`. */
function getGetStartedWalkthroughCategoryId(context: vscode.ExtensionContext): string {
	return `${context.extension.id}#${GET_STARTED_WALKTHROUGH_LOCAL_ID}`;
}

/** Опции открытия встроенного walkthrough во вкладке Welcome. */
export type OpenGetStartedOptions = {
	/** Пауза перед вызовом команды (мс); снижает гонку с реестром Getting Started. */
	scheduleDelayMs?: number;
};

interface WalkthroughStep {
	title: string;
	shortDescription: string;
	extendedContent: string;
	image: string;
	commands: Array<[label: string, command: string, keys?: string]>;
}

const CMD_PREFIX = '](command:';

/** Линейный разбор ссылок `[подпись](command:id)` в описании шага (без тяжёлого regex). */
function parseCommandsFromDescription(description: string): Array<[string, string]> {
	const commands: Array<[string, string]> = [];
	let i = 0;
	const len = description.length;
	while (i < len) {
		const openBracket = description.indexOf('[', i);
		if (openBracket === -1) {
			break;
		}
		const closeBracket = description.indexOf(']', openBracket + 1);
		if (closeBracket === -1) {
			break;
		}
		const cmdPrefixIdx = description.indexOf(CMD_PREFIX, closeBracket);
		if (cmdPrefixIdx !== closeBracket) {
			i = closeBracket + 1;
			continue;
		}
		const cmdValueStart = cmdPrefixIdx + CMD_PREFIX.length;
		const closeParen = description.indexOf(')', cmdValueStart);
		if (closeParen === -1) {
			break;
		}
		const label = description.slice(openBracket + 1, closeBracket).trim();
		const cmd = description.slice(cmdValueStart, closeParen).trim();
		commands.push([label, cmd]);
		i = closeParen + 1;
	}
	return commands;
}

function extractShortDescription(description: string): string {
	const idx = description.indexOf('\n\n[');
	return idx >= 0 ? description.slice(0, idx).trim() : description.trim();
}

function extractImageFromMarkdown(md: string): string {
	const m = /!\[.*?\]\((?:images\/)?([^)]+)\)/.exec(md);
	return m ? m[1] : '';
}

/**
 * Текст шага для webview: без заголовка файла и без разметки изображения.
 *
 * Заголовок дублирует название шага в списке слева, а картинка выводится
 * отдельно справа: в тексте они выглядели бы сырой разметкой.
 *
 * @param md - Содержимое файла шага
 * @returns Текст для показа
 */
export function extractExtendedContentFromMarkdown(md: string): string {
	return md
		.split('\n')
		.filter((line, index) => !(index === 0 && line.startsWith('# ')) && !line.trim().startsWith('!['))
		.join('\n')
		.trim();
}

interface WalkthroughData {
	title: string;
	description: string;
	steps: WalkthroughStep[];
}

interface PackageWalkthrough {
	title?: string;
	description?: string;
	steps?: Array<{ title: string; description: string; media?: { markdown?: string } }>;
}

interface PackageKeybinding {
	command: string;
	key: string;
	mac?: string;
}

type PackageWithContributes = {
	contributes?: { walkthroughs?: PackageWalkthrough[]; keybindings?: PackageKeybinding[] };
};

/** Подпись сочетания как в редакторе: на macOS берётся поле mac. */
function keybindingLabel(command: string, bindings: readonly PackageKeybinding[]): string | undefined {
	const own = bindings.find((binding) => binding.command === command);
	const raw = own
		? process.platform === 'darwin' && own.mac
			? own.mac
			: own.key
		: command === 'workbench.view.debug'
			? process.platform === 'darwin'
				? 'shift+cmd+d'
				: 'ctrl+shift+d'
			: undefined;
	if (!raw) {
		return undefined;
	}
	const names: Record<string, string> = {
		ctrl: 'Ctrl',
		alt: 'Alt',
		shift: 'Shift',
		cmd: 'Cmd',
		meta: 'Cmd',
	};
	return raw
		.split('+')
		.map((part) => names[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
		.join('+');
}

function getWalkthroughs(pkg: PackageWithContributes | undefined): PackageWalkthrough[] | undefined {
	return pkg?.contributes?.walkthroughs;
}

/** Собирает данные первого walkthrough из `package.json` и связанных `.md`. */
async function loadWalkthroughData(context: vscode.ExtensionContext): Promise<WalkthroughData> {
	let pkg = context.extension?.packageJSON as PackageWithContributes | undefined;

	if (!getWalkthroughs(pkg)?.length) {
		const pkgPath = path.join(context.extensionUri.fsPath, 'package.json');
		try {
			const pkgContent = await fs.readFile(pkgPath, 'utf-8');
			pkg = JSON.parse(pkgContent) as PackageWithContributes;
			log.debug('загружен из файла package.json');
		} catch (err) {
			log.warn(`не найден в API и при чтении ${pkgPath}: ${String(err)}`);
			pkg = {};
		}
	}

	const walkthrough = getWalkthroughs(pkg)?.[0];
	const extPath = context.extensionUri.fsPath;
	const steps: WalkthroughStep[] = [];

	if (!walkthrough?.steps?.length) {
		return {
			title: walkthrough?.title ?? 'Начало работы с 1C: Platform Tools',
			description: walkthrough?.description ?? 'Проект, зависимости и панели расширения, затем отладка, тесты и агенты.',
			steps,
		};
	}

	for (const step of walkthrough.steps) {
		const bindings = pkg?.contributes?.keybindings ?? [];
		const commands = parseCommandsFromDescription(step.description).map(
			([label, command]): [string, string, string?] => [label, command, keybindingLabel(command, bindings)]
		);
		const shortDescription = extractShortDescription(step.description);

		let extendedContent = '';
		let image = '';

		const mdPath = step.media?.markdown;
		if (mdPath) {
			const fullPath = path.join(extPath, mdPath);
			try {
				const mdContent = await fs.readFile(fullPath, 'utf-8');
				image = extractImageFromMarkdown(mdContent);
				extendedContent = extractExtendedContentFromMarkdown(mdContent);
			} catch {
				/* нет файла md */
			}
		}

		steps.push({
			title: step.title,
			shortDescription,
			extendedContent,
			image,
			commands,
		});
	}

	return {
		title: walkthrough.title ?? 'Начало работы с 1C: Platform Tools',
		description: walkthrough.description ?? 'Пошаговое знакомство с панелями расширения.',
		steps,
	};
}

function isCursor(): boolean {
	return vscode.env.appName.toLowerCase().includes('cursor');
}

function escapeHtml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * Разметка шага в HTML: жирный, код, ссылки, переводы строк.
 *
 * Ссылка на документацию в webview никуда не ведёт, поэтому от неё остаётся
 * только подпись: путь к файлу репозитория читателю бесполезен.
 *
 * @param s - Текст в markdown
 * @returns HTML для вставки в страницу
 */
export function simpleMarkdownToHtml(s: string): string {
	const inline = (line: string): string =>
		escapeHtml(line)
			.replaceAll(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replaceAll(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replaceAll(/`(.+?)`/g, '<code>$1</code>');
	let html = '';
	let inList = false;
	s.split('\n').forEach((line, index) => {
		const item = /^\s*[-*]\s+(.*)$/.exec(line);
		if (item) {
			html += (inList ? '' : '<ul>') + `<li>${inline(item[1])}</li>`;
			inList = true;
			return;
		}
		if (inList) {
			html += '</ul>';
			inList = false;
		} else if (index > 0) {
			html += '<br>';
		}
		html += inline(line);
	});
	return inList ? html + '</ul>' : html;
}

async function buildWalkthroughWebviewContent(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	steps: WalkthroughStep[],
	walkthroughTitle: string,
	walkthroughDescription: string
): Promise<string> {
	const imagesBaseUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'walkthrough', 'images')
	);

	const stepsForNav = steps.map(
		(step, i) => `
		<button class="nav-step" data-step="${i}" title="${escapeHtml(step.title)}">
			<span class="nav-num">${i + 1}</span>
			<span class="nav-title">${escapeHtml(step.title)}</span>
		</button>`
	).join('');

	const stepsContent = steps.map(
		(step, i) => {
			const commandsHtml = step.commands
				.map(([label, cmd, keys]) => {
					const tip = keys
						? `<div class="cmd-tip">Совет: используйте сочетание клавиш <span class="cmd-keys">${escapeHtml(keys)}</span></div>`
						: '';
					return `<div class="cmd"><button class="cmd-btn" data-command="${escapeHtml(cmd)}">${escapeHtml(label)}</button>${tip}</div>`;
				})
				.join('');
			return `
		<div class="step-content" data-step="${i}" ${i > 0 ? 'style="display:none"' : ''}>
			<h2>${escapeHtml(step.title)}</h2>
			<p class="lead">${escapeHtml(step.shortDescription)}</p>
			<div class="extended">${simpleMarkdownToHtml(step.extendedContent)}</div>
			<div class="commands">${commandsHtml}</div>
		</div>`;
		}
	).join('');

	const template = await loadWebviewTemplate(extensionUri, 'get-started.html');
	return fillWebviewTemplate(template, {
		WALKTHROUGH_TITLE: escapeHtml(walkthroughTitle),
		WALKTHROUGH_DESCRIPTION: escapeHtml(walkthroughDescription),
		STEPS_NAV: stepsForNav,
		STEPS_CONTENT: stepsContent,
		IMAGES_BASE: imagesBaseUri.toString(),
		IMAGE_NAMES: JSON.stringify(steps.map((s) => s.image)),
	});
}

/**
 * VS Code: `workbench.action.openWalkthrough`, при неудаче — повтор через 400 мс, затем Webview.
 *
 * @param scheduleDelayMs - ожидание перед первой попыткой (мс)
 */
async function openBuiltinWalkthroughWithFallback(
	context: vscode.ExtensionContext,
	scheduleDelayMs: number
): Promise<void> {
	if (scheduleDelayMs > 0) {
		await sleep(scheduleDelayMs);
	}
	const categoryId = getGetStartedWalkthroughCategoryId(context);
	const tryOpen = (): Thenable<unknown> =>
		vscode.commands.executeCommand('workbench.action.openWalkthrough', categoryId, false);
	try {
		await tryOpen();
	} catch (error) {
		log.warn(`открытие: ${String(error)}, повтор через 400 мс`);
		await sleep(400);
		try {
			await tryOpen();
		} catch (retryError) {
			log.warn(`открытие: ${String(retryError)}, открываем Webview`);
			await openWalkthroughWebview(context);
		}
	}
}

/** Webview с тем же сценарием, что и встроенный walkthrough (Cursor и запасной путь в VS Code). */
async function openWalkthroughWebview(context: vscode.ExtensionContext): Promise<void> {
	const { steps, title: walkthroughTitle, description: walkthroughDescription } =
		await loadWalkthroughData(context);

	if (steps.length === 0) {
		void vscode.window.showWarningMessage('Walkthrough: шаги не найдены в package.json');
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'1cPlatformToolsGetStarted',
		walkthroughTitle,
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, 'walkthrough', 'images'),
			],
		}
	);

	panel.webview.html = await buildWalkthroughWebviewContent(
		panel.webview,
		context.extensionUri,
		steps,
		walkthroughTitle,
		walkthroughDescription
	);

	panel.webview.onDidReceiveMessage(
		(msg: { type: string; command?: string }) => {
			if (msg.type === 'runCommand' && msg.command) {
				void vscode.commands.executeCommand(msg.command);
			}
		},
		undefined,
		context.subscriptions
	);
}

/**
 * Открывает руководство «Начало работы».
 *
 * @param context - контекст расширения
 * @param options - при автопоказе укажите `scheduleDelayMs` (см. {@link OpenGetStartedOptions})
 */
export function openGetStartedWalkthrough(
	context: vscode.ExtensionContext,
	options?: OpenGetStartedOptions
): void {
	if (isCursor()) {
		void openWalkthroughWebview(context);
		return;
	}
	const scheduleDelayMs = options?.scheduleDelayMs ?? 0;
	void openBuiltinWalkthroughWithFallback(context, scheduleDelayMs);
}

/** Регистрирует команду `1c-platform-tools.help.openGetStarted`. */
export function registerGetStarted(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('1c-platform-tools.help.openGetStarted', () => {
			openGetStartedWalkthrough(context);
		})
	);
}

/**
 * Однократный автопоказ после установки (флаг в `globalState`).
 *
 * @param context - контекст расширения
 */
export function showGetStartedOnFirstRun(context: vscode.ExtensionContext): void {
	if (context.globalState.get(WELCOMED_KEY)) {
		return;
	}
	void context.globalState.update(WELCOMED_KEY, true);
	openGetStartedWalkthrough(context, { scheduleDelayMs: 750 });
}
