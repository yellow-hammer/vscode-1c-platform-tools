import * as vscode from 'vscode';
import { logger } from '../../shared/logger';
import { disposeMeasureResultsPanel, showMeasureResultsPanel } from './measureResultsPanel';

const DEBUG_TYPE = '1c-platform-tools';

export interface MeasureLine {
	line: number;
	count: number;
	seconds: number;
	ownSeconds: number;
	serverCall: boolean;
}

export interface MeasureModule {
	path: string;
	lines: MeasureLine[];
}

export interface MeasureResults {
	totalSeconds: number;
	modules: MeasureModule[];
}

let measureActive = false;
let results: MeasureResults | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let decorationType: vscode.TextEditorDecorationType | undefined;
let showPanelTimer: NodeJS.Timeout | undefined;

/** Контекст-ключ для переключения кнопки старт/стоп на панели отладки (без дефисов — их не понимает парсер when-выражений). */
function setMeasureActive(value: boolean): void {
	measureActive = value;
	void vscode.commands.executeCommand('setContext', 'onecPlatformTools.debug.measureActive', value);
}

/**
 * Замер производительности: команды включения/выключения режима замера в активной сессии
 * отладки 1С и отображение результатов built-in декорациями по строкам модулей.
 */
export function registerMeasureFeature(context: vscode.ExtensionContext): void {
	setMeasureActive(false);
	context.subscriptions.push(
		vscode.commands.registerCommand('1c-platform-tools.debug.measure.start', () =>
			setMeasureMode(true)
		),
		vscode.commands.registerCommand('1c-platform-tools.debug.measure.stop', () =>
			setMeasureMode(false)
		),
		vscode.commands.registerCommand('1c-platform-tools.debug.measure.clear', () =>
			clearResults()
		),
		vscode.commands.registerCommand('1c-platform-tools.debug.measure.showResults', () => {
			if (results) {
				void showMeasureResultsPanel(results);
			} else {
				void vscode.window.showInformationMessage('Нет результатов замера производительности.');
			}
		}),
		vscode.debug.onDidReceiveDebugSessionCustomEvent((ev) => {
			if (ev.event === 'MeasureResults' && ev.session.type === DEBUG_TYPE) {
				results = ev.body as MeasureResults;
				updateStatusBar();
				applyDecorations();
				// Результаты приходят порциями от каждого предмета отладки — таблицу
				// показываем по последнему снимку, когда поток порций утих.
				if (!measureActive) {
					if (showPanelTimer) {
						clearTimeout(showPanelTimer);
					}
					showPanelTimer = setTimeout(() => {
						showPanelTimer = undefined;
						if (results) {
							void showMeasureResultsPanel(results);
						}
					}, 500);
				}
			}
		}),
		vscode.window.onDidChangeVisibleTextEditors(() => applyDecorations()),
		// Замер — не настройка, а живой признак: при завершении сессии всегда снимается
		// (адаптер дополнительно выключает его на сервере отладки при отключении).
		vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.type === DEBUG_TYPE && measureActive) {
				setMeasureActive(false);
				updateStatusBar();
			}
		})
	);
}

let requestInFlight = false;

async function setMeasureMode(enabled: boolean): Promise<void> {
	const session = vscode.debug.activeDebugSession;
	if (!session || session.type !== DEBUG_TYPE) {
		void vscode.window.showWarningMessage('Замер производительности доступен только в сессии отладки 1С.');
		return;
	}
	if (requestInFlight) {
		return;
	}

	requestInFlight = true;
	try {
		await session.customRequest('SetMeasureModeRequest', { enabled });
	} catch (err) {
		logger.error(`Ошибка переключения замера производительности: ${String(err)}`);
		void vscode.window.showErrorMessage('Не удалось переключить режим замера производительности.');
		return;
	} finally {
		requestInFlight = false;
	}

	setMeasureActive(enabled);
	if (enabled) {
		results = undefined;
		applyDecorations();
	}
	updateStatusBar();
}

function clearResults(): void {
	results = undefined;
	updateStatusBar();
	applyDecorations();
	disposeMeasureResultsPanel();
}

function updateStatusBar(): void {
	if (!measureActive && !results) {
		statusBarItem?.hide();
		return;
	}

	if (!statusBarItem) {
		statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
	}
	if (measureActive) {
		statusBarItem.text = '$(dashboard) Замер производительности…';
		statusBarItem.tooltip = 'Идёт замер производительности 1С. Нажмите, чтобы закончить.';
		statusBarItem.command = '1c-platform-tools.debug.measure.stop';
	} else {
		statusBarItem.text = `$(dashboard) Замер: ${formatSeconds(results!.totalSeconds)}`;
		statusBarItem.tooltip = 'Результаты замера производительности 1С. Нажмите, чтобы открыть таблицу.';
		statusBarItem.command = '1c-platform-tools.debug.measure.showResults';
	}
	statusBarItem.show();
}

function applyDecorations(): void {
	if (!decorationType) {
		// Колонка фиксированной ширины на каждой строке (пустая — где данных нет):
		// код всех строк сдвигается одинаково и не ломает выравнивание.
		decorationType = vscode.window.createTextEditorDecorationType({
			before: {
				color: new vscode.ThemeColor('editorCodeLens.foreground'),
				margin: '0 1.5em 0 0',
				width: '21ch',
			},
		});
	}

	for (const editor of vscode.window.visibleTextEditors) {
		if (!editor.document.uri.fsPath.toLowerCase().endsWith('.bsl')) {
			continue;
		}
		editor.setDecorations(decorationType, results ? buildDecorations(editor.document) : []);
	}
}

function buildDecorations(document: vscode.TextDocument): vscode.DecorationOptions[] {
	const module = results!.modules.find((m) => samePath(m.path, document.uri.fsPath));
	if (!module) {
		return [];
	}

	const total = results!.totalSeconds;
	const byLine = new Map(module.lines.map((l) => [l.line - 1, l]));
	const options: vscode.DecorationOptions[] = [];
	for (let line0 = 0; line0 < document.lineCount; line0++) {
		const line = byLine.get(line0);
		if (!line) {
			options.push({
				range: new vscode.Range(line0, 0, line0, 0),
				renderOptions: { before: { contentText: '' } },
			});
			continue;
		}
		const percent = total > 0 ? ((line.seconds / total) * 100).toFixed(1) : '0.0';
		const server = line.serverCall ? ' ⚡' : '';
		options.push({
			range: new vscode.Range(line0, 0, line0, 0),
			renderOptions: {
				before: {
					contentText: `${line.count} × ${formatSeconds(line.seconds)} · ${percent} %${server}`,
				},
			},
			hoverMessage: new vscode.MarkdownString(
				`Замер производительности: выполнений — ${line.count}, ` +
					`время — ${formatSeconds(line.seconds)}, ` +
					`без вложенных вызовов — ${formatSeconds(line.ownSeconds)}` +
					(line.serverCall ? ', есть серверный вызов' : '')
			),
		});
	}
	return options;
}

function samePath(left: string, right: string): boolean {
	const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
	return normalize(left) === normalize(right);
}

function formatSeconds(seconds: number): string {
	return seconds >= 1 ? `${seconds.toFixed(2)} с` : `${(seconds * 1000).toFixed(1)} мс`;
}
