/**
 * Редактор хуков команд (custom editor поверх `.1cpt/hooks.json`).
 *
 * Слева команды, у которых заданы хуки, справа три раздела шагов: до команды,
 * после команды и при ошибке. Шаг - командная строка, поэтому полотно со
 * связями здесь ни к чему: ветвления у хуков нет, есть порядок.
 *
 * Каркас общий с редактором пайплайнов: список слева, панель действий сверху,
 * панель сохранения снизу. Правки живут в форме, файл меняется по кнопке.
 */

import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { invalidateHooksCache, runHookPhaseDry } from '../../shared/commandHooks';
import { readCommandCatalog, CommandCatalogEntry } from '../../shared/commandCatalog';
import {
	normalizeHooks,
	serializeHooks,
	HOOKS_WILDCARD,
	HooksModel,
} from '../../shared/hooks/hooksModel';
import { chromeScript, chromeStyles, saveBarHtml, CHROME_LABELS } from '../editors/webviewChrome';
import { registerFormPanel } from '../editors/formPanels';

const log = logger.scope('hooks');

export const HOOKS_EDITOR_VIEW_TYPE = '1c-platform-tools.hooksEditor';

/** Сообщения из формы в расширение */
type WebviewMessage =
	| { type: 'save'; data: HooksModel['hooks'] }
	| { type: 'pickCommand' }
	| { type: 'dryRun'; commandId: string; phase: 'pre' | 'post' | 'onError' }
	| { type: 'error'; message: string }
	| { type: 'openJson' };

/** Модель для формы */
interface EditorModel {
	hooks: HooksModel['hooks'];
	catalog: CommandCatalogEntry[];
	error?: string;
}

export class HooksEditorProvider implements vscode.CustomTextEditorProvider {
	/** Открытые формы: команда открытия просит выделить нужную команду */
	private static readonly panels = new Set<vscode.WebviewPanel>();

	/** Команда, которую нужно выделить, когда форма откроется */
	private static pending: string | undefined;

	/**
	 * Просит форму выделить команду с хуками.
	 *
	 * @param commandId - Идентификатор команды расширения
	 */
	static revealCommand(commandId: string): void {
		if (HooksEditorProvider.panels.size === 0) {
			HooksEditorProvider.pending = commandId;
			return;
		}
		for (const panel of HooksEditorProvider.panels) {
			void panel.webview.postMessage({ type: 'select', commandId });
		}
	}

	/**
	 * Регистрирует редактор хуков.
	 *
	 * @returns Disposable регистрации
	 */
	static register(): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			HOOKS_EDITOR_VIEW_TYPE,
			new HooksEditorProvider(),
			{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
		);
	}

	/**
	 * Открывает документ формой.
	 *
	 * @param document - Файл хуков
	 * @param webviewPanel - Панель редактора
	 */
	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = buildHtml();

		const post = (): void => {
			void webviewPanel.webview.postMessage({ type: 'model', model: this.buildModel(document) });
		};

		const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() === document.uri.toString()) {
				post();
			}
		});
		HooksEditorProvider.panels.add(webviewPanel);
		registerFormPanel(webviewPanel);
		webviewPanel.onDidDispose(() => {
			HooksEditorProvider.panels.delete(webviewPanel);
			subscription.dispose();
		});

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			if (message.type === 'save') {
				await this.save(document, message.data);
				// Правка действует со следующей команды, а не после перезагрузки окна
				const folder = vscode.workspace.getWorkspaceFolder(document.uri);
				if (folder) {
					invalidateHooksCache(folder.uri.fsPath);
				}
				void webviewPanel.webview.postMessage({ type: 'saved' });
				post();
				// Дерево команд показывает сохранённое: обновляем сразу, не дожидаясь наблюдателя за файлами
				await vscode.commands.executeCommand('1c-platform-tools.tools.refresh');
				return;
			}
			if (message.type === 'dryRun') {
				const folder = vscode.workspace.getWorkspaceFolder(document.uri);
				if (!folder) {
					return;
				}
				await document.save();
				invalidateHooksCache(folder.uri.fsPath);
				const result = await runHookPhaseDry(folder.uri.fsPath, message.commandId, message.phase);
				void webviewPanel.webview.postMessage({ type: 'dryRunResult', ...result });
				return;
			}
			if (message.type === 'pickCommand') {
				const commandId = await pickCommand(this.buildModel(document));
				if (commandId !== undefined) {
					void webviewPanel.webview.postMessage({ type: 'addCommand', commandId });
				}
				return;
			}
			if (message.type === 'error') {
				log.error(`Ошибка формы редактора: ${message.message}`);
				return;
			}
			if (message.type === 'openJson') {
				await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
			}
		});

		post();

		if (HooksEditorProvider.pending !== undefined) {
			void webviewPanel.webview.postMessage({ type: 'select', commandId: HooksEditorProvider.pending });
			HooksEditorProvider.pending = undefined;
		}
	}

	/**
	 * Строит модель формы по тексту документа.
	 *
	 * @param document - Файл хуков
	 * @returns Модель с хуками и каталогом команд
	 */
	private buildModel(document: vscode.TextDocument): EditorModel {
		const catalog = readCommandCatalog();
		const text = document.getText().trim();
		if (text === '') {
			return { hooks: {}, catalog };
		}
		try {
			return { hooks: normalizeHooks(JSON.parse(text)).hooks, catalog };
		} catch (error) {
			return {
				hooks: {},
				catalog,
				error: `Файл не разбирается как JSON: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Записывает хуки в документ и сохраняет его.
	 *
	 * @param document - Файл хуков
	 * @param hooks - Новое содержимое
	 */
	private async save(document: vscode.TextDocument, hooks: HooksModel['hooks']): Promise<void> {
		const next = serializeHooks(normalizeHooks({ hooks }));
		if (next === document.getText()) {
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), next);
		await vscode.workspace.applyEdit(edit);
		await document.save();
	}
}

/**
 * Спрашивает команду, на которую вешаются хуки.
 *
 * @param model - Текущая модель формы
 * @returns Идентификатор команды или undefined, если выбор отменён
 */
async function pickCommand(model: EditorModel): Promise<string | undefined> {
	const items: Array<vscode.QuickPickItem & { id: string }> = [
		{
			id: HOOKS_WILDCARD,
			label: 'Все команды',
			description: HOOKS_WILDCARD,
			detail: 'Шаги выполняются вокруг каждой команды расширения',
		},
		...model.catalog
			.filter((entry) => model.hooks[entry.id] === undefined)
			.map((entry) => ({
				id: entry.id,
				label: entry.title ?? entry.id,
				description: entry.category,
				detail: entry.id,
			})),
	];
	const picked = await vscode.window.showQuickPick(items, {
		title: 'Хуки команды',
		placeHolder: 'Выберите команду расширения',
		matchOnDetail: true,
	});
	return picked?.id;
}

/** HTML формы: рендер модели в инлайн-скрипте, правки уходят в extension. */
function buildHtml(): string {
	const nonce = Math.random().toString(36).slice(2);
	return /* html */ `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
${chromeStyles()}
	.chrome-body { grid-template-columns: 280px minmax(0, 1fr); }
	.main { overflow: auto; padding: 14px 18px 30px; }
	.command-id { font-family: var(--vscode-editor-font-family); font-size: 0.8em;
		color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
	.phase { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px 12px; margin-bottom: 14px;
		border-left: 4px solid var(--phase); }
	.phase h3 { font-size: 0.95em; margin: 0 0 3px; display: flex; align-items: center; gap: 8px; }
	.phase h3 button { margin-left: auto; }
	.phase .note { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
	.step { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
	.step .order { width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; margin-top: 5px;
		background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
		display: flex; align-items: center; justify-content: center; font-size: 0.72em; }
	.step .grow { flex: 1; min-width: 0; }
	.step .options { display: flex; gap: 14px; align-items: center; margin-top: 5px; font-size: 0.82em;
		color: var(--vscode-descriptionForeground); }
	.step .options label { display: flex; gap: 5px; align-items: center; cursor: pointer; }
	.step .options input[type=number] { width: 74px; }
	.step .options input[type=checkbox] { width: auto; }
	.dry-run { margin: 8px 0 0; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; font-size: 0.82em;
		font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background, #00000030);
		border-left: 3px solid var(--ok); }
	.dry-run.failed { border-left-color: var(--fail); }
</style>
</head>
<body>
<div class="chrome">
	<div class="toolbar">
		<span class="title" id="title"></span>
		<button id="jsonButton" title="Открыть файл как обычный JSON">${CHROME_LABELS.json}</button>
	</div>
	<div class="chrome-body">
		<div class="side left">
			<h2>Команды с хуками <button class="round" id="addButton" title="Добавить команду">${CHROME_LABELS.add}</button></h2>
			<div id="list"></div>
		</div>
		<div class="main" id="details"></div>
	</div>
	${saveBarHtml()}
</div>
<script nonce="${nonce}">
const PHASES = [
	{ id: 'pre', title: 'До команды', note: 'Выполняется перед запуском команды. Ошибка шага отменяет команду.', color: '#4EC9B0' },
	{ id: 'post', title: 'После команды', note: 'Выполняется после успешного завершения команды.', color: '#569CD6' },
	{ id: 'onError', title: 'При ошибке', note: 'Выполняется, если команда завершилась с ошибкой.', color: 'var(--fail)' },
];

let catalog = [];
let modelError;
let baseline = {};
let draft = {};
let selectedCommand;
/** Итог проверки фазы: показывается под её шагами */
let dryRunPhase;
let dryRunOutput;

${chromeScript()}

window.addEventListener('message', (event) => {
	const data = event.data;
	if (data.type === 'model') {
		catalog = data.model.catalog;
		modelError = data.model.error;
		const dirty = isDirty();
		baseline = data.model.hooks;
		if (!dirty) { draft = JSON.parse(JSON.stringify(baseline)); }
		renderAll();
		return;
	}
	if (data.type === 'dryRunResult') {
		dryRunOutput = { phase: dryRunPhase, success: data.success, output: data.output };
		renderAll();
		return;
	}
	if (data.type === 'saved') {
		saveStatus = ${JSON.stringify(CHROME_LABELS.saved)};
		saveStatusKind = 'ok';
		renderAll();
		return;
	}
	if (data.type === 'select') {
		if (draft[data.commandId]) {
			selectedCommand = data.commandId;
			renderAll();
		}
		return;
	}
	if (data.type === 'addCommand') {
		if (!draft[data.commandId]) { draft[data.commandId] = { pre: [{ command: '' }] }; }
		selectedCommand = data.commandId;
		commit();
	}
});

document.getElementById('addButton').addEventListener('click', () => post({ type: 'pickCommand' }));

function entry() { return selectedCommand ? draft[selectedCommand] : undefined; }

function commandTitle(commandId) {
	if (commandId === '*') { return 'Все команды'; }
	const found = catalog.find((item) => item.id === commandId);
	return (found && found.title) || commandId;
}

function removeCommand(commandId) {
	delete draft[commandId];
	if (selectedCommand === commandId) {
		const ids = Object.keys(draft);
		selectedCommand = ids.length ? ids[0] : undefined;
	}
	commit();
}

function renderAll() {
	const ids = Object.keys(draft);
	if (selectedCommand && !draft[selectedCommand]) { selectedCommand = undefined; }
	if (!selectedCommand && ids.length > 0) { selectedCommand = ids[0]; }
	document.getElementById('title').textContent = selectedCommand ? commandTitle(selectedCommand) : 'Хуки команд';
	renderList(ids);
	renderDetails();
	renderSaveBar();
}

function renderList(ids) {
	const host = document.getElementById('list');
	host.textContent = '';
	if (ids.length === 0) {
		host.appendChild(hint('Хуков нет. Добавьте команду кнопкой ＋: к ней можно прицепить шаги до, после и при ошибке.'));
		return;
	}
	for (const commandId of ids) {
		host.appendChild(listItem({
			title: commandTitle(commandId),
			subtitle: describe(draft[commandId]) || commandId,
			active: commandId === selectedCommand,
			onSelect: () => { selectedCommand = commandId; renderAll(); },
			onRemove: () => removeCommand(commandId),
		}));
	}
}

function describe(hookEntry) {
	const labels = { pre: 'до', post: 'после', onError: 'при ошибке' };
	return PHASES
		.filter((phase) => (hookEntry[phase.id] || []).length > 0)
		.map((phase) => labels[phase.id] + ' ' + hookEntry[phase.id].length)
		.join(', ');
}

function renderDetails() {
	const host = document.getElementById('details');
	host.textContent = '';

	if (modelError) {
		const error = document.createElement('div');
		error.className = 'error';
		error.textContent = modelError;
		host.appendChild(error);
		return;
	}

	const hookEntry = entry();
	if (!hookEntry) {
		host.appendChild(hint('Хуки выполняются вокруг команд расширения: подготовить каталог перед сборкой, отправить уведомление после прогона тестов, собрать артефакты при ошибке. Шаг - командная строка, выполняется в корне проекта.'));
		return;
	}

	const id = document.createElement('div');
	id.className = 'command-id';
	id.textContent = selectedCommand;
	host.appendChild(id);

	for (const phase of PHASES) { host.appendChild(renderPhase(phase, hookEntry)); }
	host.appendChild(hint('Шаг выполняется в оболочке из корня проекта. Переменные окружения команды доступны шагу: путь проекта, идентификатор команды и её аргументы.'));
}

function renderPhase(phase, hookEntry) {
	const block = document.createElement('div');
	block.className = 'phase';
	block.style.setProperty('--phase', phase.color);

	const caption = document.createElement('h3');
	caption.textContent = phase.title;
	const check = document.createElement('button');
	check.textContent = 'Проверить';
	check.title = 'Выполнить шаги этой фазы, не запуская саму команду';
	check.addEventListener('click', () => {
		if (isDirty() || pendingEdit) { save(); }
		dryRunPhase = phase.id;
		post({ type: 'dryRun', commandId: selectedCommand, phase: phase.id });
	});
	caption.appendChild(check);

	const add = document.createElement('button');
	add.textContent = '＋ Шаг';
	add.addEventListener('click', () => {
		hookEntry[phase.id] = [...(hookEntry[phase.id] || []), { command: '' }];
		commit();
	});
	caption.appendChild(add);
	block.appendChild(caption);

	const note = document.createElement('div');
	note.className = 'note';
	note.textContent = phase.note;
	block.appendChild(note);

	const steps = hookEntry[phase.id] || [];
	if (steps.length === 0) {
		block.appendChild(empty('Шагов нет'));
		return block;
	}

	steps.forEach((step, index) => block.appendChild(renderStep(phase, hookEntry, step, index)));
	if (dryRunOutput && dryRunOutput.phase === phase.id) {
		const result = document.createElement('pre');
		result.className = 'dry-run' + (dryRunOutput.success ? '' : ' failed');
		result.textContent = dryRunOutput.output;
		block.appendChild(result);
	}
	return block;
}

function renderStep(phase, hookEntry, step, index) {
	const row = document.createElement('div');
	row.className = 'step';

	const order = document.createElement('span');
	order.className = 'order';
	order.textContent = index + 1;
	row.appendChild(order);

	const grow = document.createElement('div');
	grow.className = 'grow';
	const input = document.createElement('input');
	input.type = 'text';
	input.value = step.command || '';
	input.placeholder = 'Командная строка, например npm run build';
	input.addEventListener('change', () => { step.command = input.value; commit(); });
	grow.appendChild(input);

	const options = document.createElement('div');
	options.className = 'options';

	const continueLabel = document.createElement('label');
	const continueBox = document.createElement('input');
	continueBox.type = 'checkbox';
	continueBox.checked = step.continueOnError === true;
	continueBox.addEventListener('change', () => {
		if (continueBox.checked) { step.continueOnError = true; } else { delete step.continueOnError; }
		commit();
	});
	continueLabel.appendChild(continueBox);
	continueLabel.append('продолжать после ошибки');
	options.appendChild(continueLabel);

	const timeoutLabel = document.createElement('label');
	const timeoutInput = document.createElement('input');
	timeoutInput.type = 'number';
	timeoutInput.value = step.timeout === undefined ? '' : step.timeout;
	timeoutInput.placeholder = '30';
	timeoutInput.addEventListener('change', () => {
		const parsed = Number(timeoutInput.value);
		if (Number.isFinite(parsed) && parsed > 0) { step.timeout = parsed; } else { delete step.timeout; }
		commit();
	});
	timeoutLabel.append('таймаут, с');
	timeoutLabel.appendChild(timeoutInput);
	options.appendChild(timeoutLabel);

	grow.appendChild(options);
	row.appendChild(grow);

	row.appendChild(iconButton('↑', 'Выше', () => move(phase, hookEntry, index, -1)));
	row.appendChild(iconButton('↓', 'Ниже', () => move(phase, hookEntry, index, 1)));
	const remove = iconButton('✕', 'Удалить шаг', () => {
		hookEntry[phase.id].splice(index, 1);
		if (hookEntry[phase.id].length === 0) { delete hookEntry[phase.id]; }
		commit();
	});
	remove.classList.add('danger');
	row.appendChild(remove);
	return row;
}

function move(phase, hookEntry, index, delta) {
	const steps = hookEntry[phase.id];
	const target = index + delta;
	if (!steps || target < 0 || target >= steps.length) { return; }
	const [step] = steps.splice(index, 1);
	steps.splice(target, 0, step);
	commit();
}

function iconButton(text, title, onClick) {
	const button = document.createElement('button');
	button.className = 'icon';
	button.textContent = text;
	button.title = title;
	button.addEventListener('click', onClick);
	return button;
}
</script>
</body>
</html>`;
}
