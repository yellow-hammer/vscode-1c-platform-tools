/**
 * «Начало работы» — открывает встроенное пошаговое руководство (Welcome: Open Walkthrough).
 * В Cursor использует fallback — Webview, т.к. workbench.action.openWalkthrough
 * ссылается на walkThrough://vscode_getting_started_page, который отсутствует в Cursor.
 * Данные берутся динамически из package.json и walkthrough/*.md — без дублирования.
 *
 * @see .cursor/rules/get-started-cursor-fallback.mdc — правила fallback для Cursor
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from './logger';

const WELCOMED_KEY = '1c-platform-tools.getStarted.welcomed';

const WALKTHROUGH_ID = 'yellow-hammer.1c-platform-tools#1c-platform-tools.getStarted';

/** Шаг для Webview (собран из package.json + walkthrough/*.md) */
interface WalkthroughStep {
	title: string;
	shortDescription: string;
	extendedContent: string;
	image: string;
	commands: Array<[label: string, command: string]>;
}

const CMD_PREFIX = '](command:';

/** Парсит [Label](command:cmdId) из строки description. Линейный парсер без regex — защита от ReDoS. */
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

/** Извлекает короткое описание (до первых ссылок) */
function extractShortDescription(description: string): string {
	const idx = description.indexOf('\n\n[');
	return idx >= 0 ? description.slice(0, idx).trim() : description.trim();
}

/** Извлекает путь к изображению из первой строки markdown: # ![Alt](images/xxx.svg) */
function extractImageFromMarkdown(md: string): string {
	const m = /!\[.*?\]\((?:images\/)?([^)]+)\)/.exec(md);
	return m ? m[1] : 'placeholder.svg';
}

/** Извлекает расширенный контент из markdown (без первой строки с изображением) */
function extractExtendedContentFromMarkdown(md: string): string {
	const lines = md.split('\n');
	const skipFirst = lines[0].startsWith('# ![') ? 1 : 0;
	return lines.slice(skipFirst).join('\n').trim();
}

/** Результат загрузки walkthrough */
interface WalkthroughData {
	title: string;
	description: string;
	steps: WalkthroughStep[];
}

/** Тип walkthrough из package.json (contributes.walkthroughs) */
interface PackageWalkthrough {
	title?: string;
	description?: string;
	steps?: Array<{ title: string; description: string; media?: { markdown?: string } }>;
}

type PackageWithContributes = { contributes?: { walkthroughs?: PackageWalkthrough[] } };

/** Извлекает walkthroughs из package.json (contributes.walkthroughs) */
function getWalkthroughs(pkg: PackageWithContributes | undefined): PackageWalkthrough[] | undefined {
	return pkg?.contributes?.walkthroughs;
}

/**
 * Загружает шаги walkthrough из package.json (API или файл) и walkthrough/*.md.
 * walkthroughs находятся в contributes.walkthroughs.
 */
async function loadWalkthroughData(context: vscode.ExtensionContext): Promise<WalkthroughData> {
	let pkg = context.extension?.packageJSON as PackageWithContributes | undefined;

	if (!getWalkthroughs(pkg)?.length) {
		const pkgPath = path.join(context.extensionUri.fsPath, 'package.json');
		try {
			const pkgContent = await fs.readFile(pkgPath, 'utf-8');
			pkg = JSON.parse(pkgContent) as PackageWithContributes;
			logger.debug('Walkthrough: загружен из файла package.json');
		} catch (err) {
			logger.warn(`Walkthrough: не найден в API и при чтении ${pkgPath}: ${String(err)}`);
			pkg = {};
		}
	}

	const walkthrough = getWalkthroughs(pkg)?.[0];
	const extPath = context.extensionUri.fsPath;
	const steps: WalkthroughStep[] = [];

	if (!walkthrough?.steps?.length) {
		return {
			title: walkthrough?.title ?? 'Начало работы с 1C: Platform Tools',
			description: walkthrough?.description ?? 'Шесть шагов: проект, зависимости, панель команд, служебные файлы, панель проектов, список дел.',
			steps,
		};
	}

	for (const step of walkthrough.steps) {
		const commands = parseCommandsFromDescription(step.description);
		const shortDescription = extractShortDescription(step.description);

		let extendedContent = '';
		let image = 'placeholder.svg';

		const mdPath = step.media?.markdown;
		if (mdPath) {
			const fullPath = path.join(extPath, mdPath);
			try {
				const mdContent = await fs.readFile(fullPath, 'utf-8');
				image = extractImageFromMarkdown(mdContent);
				extendedContent = extractExtendedContentFromMarkdown(mdContent);
			} catch {
				// файл не найден — оставляем пустой контент
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
		description: walkthrough.description ?? 'Шесть шагов: проект, зависимости, панель команд, служебные файлы, панель проектов, список дел.',
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

/** Преобразует псевдо-Markdown в простой HTML (жирный, код) */
function simpleMarkdownToHtml(s: string): string {
	return escapeHtml(s)
		.replaceAll(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replaceAll(/`(.+?)`/g, '<code>$1</code>')
		.replaceAll('\n', '<br>');
}

function buildWalkthroughWebviewContent(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	steps: WalkthroughStep[],
	walkthroughTitle: string,
	walkthroughDescription: string
): string {
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
				.map(
					([label, cmd]) =>
						`<button class="cmd-btn" data-command="${escapeHtml(cmd)}">${escapeHtml(label)}</button>`
				)
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

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		* { box-sizing: border-box; }
		body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); line-height: 1.5; background: var(--vscode-editor-background); }
		.layout { display: flex; min-height: 100vh; }
		.left { flex: 1; min-width: 0; padding: 1.5em 1.5em 2em; overflow-y: auto; }
		.right { width: 340px; flex-shrink: 0; padding: 1.5em; background: var(--vscode-sideBar-background); border-left: 1px solid var(--vscode-widget-border); }
		.nav { display: flex; flex-direction: column; gap: 0.25em; margin-bottom: 1.5em; }
		.nav-step {
			display: flex; align-items: center; gap: 0.6em;
			padding: 0.5em 0.75em; border: none; border-radius: 6px;
			background: transparent; color: var(--vscode-foreground);
			cursor: pointer; text-align: left; font-size: 0.9em;
		}
		.nav-step:hover { background: var(--vscode-list-hoverBackground); }
		.nav-step.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
		.nav-num {
			width: 1.4em; height: 1.4em; display: flex; align-items: center; justify-content: center;
			background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
			border-radius: 50%; font-size: 0.85em; font-weight: 600; flex-shrink: 0;
		}
		.nav-step.active .nav-num { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
		.nav-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.step-content h2 { font-size: 1.25em; margin: 0 0 0.5em; }
		.step-content .lead { color: var(--vscode-descriptionForeground); margin: 0 0 0.75em; }
		.step-content .extended { margin-bottom: 1em; color: var(--vscode-foreground); font-size: 0.95em; }
		.step-content .extended strong { font-weight: 600; }
		.step-content .extended code { background: var(--vscode-textCodeBlock-background); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
		.commands { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.75em; }
		.cmd-btn {
			background: var(--vscode-button-background); color: var(--vscode-button-foreground);
			border: none; padding: 0.45em 0.9em; border-radius: 4px;
			cursor: pointer; font-size: 0.9em;
		}
		.cmd-btn:hover { opacity: 0.92; }
		.media img {
			width: 100%; max-width: 300px; height: auto; border-radius: 6px;
			border: 1px solid var(--vscode-widget-border);
		}
		.right .media { margin-top: 0; }
		.right .media img { max-width: 100%; }
	</style>
</head>
<body>
	<div class="layout">
		<div class="left">
			<h1 style="font-size:1.35em;margin:0 0 0.5em">${escapeHtml(walkthroughTitle)}</h1>
			<p style="color:var(--vscode-descriptionForeground);margin:0 0 1.5em">${escapeHtml(walkthroughDescription)}</p>
			<div class="nav">${stepsForNav}</div>
			${stepsContent}
		</div>
		<div class="right">
			<div class="media" id="right-media">
				<img src="${imagesBaseUri}/${steps[0]?.image ?? 'placeholder.svg'}" alt="Шаг 1" />
			</div>
		</div>
	</div>
	<script>
		(function() {
			const vscode = acquireVsCodeApi();
			const steps = document.querySelectorAll('.step-content');
			const rightMedia = document.getElementById('right-media');
			const imagesBase = '${imagesBaseUri}';
			const imageNames = ${JSON.stringify(steps.map(s => s.image))};

			function showStep(i) {
				steps.forEach((s, idx) => { s.style.display = idx === i ? 'block' : 'none'; });
				document.querySelectorAll('.nav-step').forEach((b, idx) => { b.classList.toggle('active', idx === i); });
				if (rightMedia && imageNames[i]) {
					rightMedia.innerHTML = '<img src="' + imagesBase + '/' + imageNames[i] + '" alt="Шаг ' + (i+1) + '" />';
				}
			}
			document.querySelectorAll('.nav-step').forEach((btn, i) => {
				btn.addEventListener('click', () => showStep(i));
			});
			document.querySelectorAll('.cmd-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					vscode.postMessage({ type: 'runCommand', command: btn.dataset.command });
				});
			});
			showStep(0);
		})();
	</script>
</body>
</html>`;
}

/** Открывает walkthrough в Webview (fallback для Cursor) */
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

	panel.webview.html = buildWalkthroughWebviewContent(
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

/** Открывает пошаговое руководство «Начало работы» в панели приветствия */
export function openGetStartedWalkthrough(context: vscode.ExtensionContext): void {
	if (isCursor()) {
		void openWalkthroughWebview(context);
		return;
	}
	void vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID);
}

export function registerGetStarted(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('1c-platform-tools.getStarted.open', () => {
			openGetStartedWalkthrough(context);
		})
	);
}

/** Открыть «Начало работы» (walkthrough) при первом запуске после установки расширения */
export function showGetStartedOnFirstRun(context: vscode.ExtensionContext): void {
	if (context.globalState.get(WELCOMED_KEY)) {
		return;
	}
	void context.globalState.update(WELCOMED_KEY, true);
	setImmediate(() => openGetStartedWalkthrough(context));
}
