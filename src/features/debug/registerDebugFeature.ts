import * as path from 'node:path';
import * as vscode from 'vscode';
import * as onecDebugTargets from './debugTargets';
import {
	OnecDebugConfigurationProvoider,
	watchTargetTypesChanged,
} from './debugConfigurations';
import {
	checkOnecDebugAdapterUpdateInBackground,
	ensureOnecDebugAdapter,
} from './onecDebugAdapterBootstrap';
import { logger } from '../../shared/logger';
import { registerBslBreakpointNormalizer } from './bslBreakpoints';
import { DEBUG_TYPE } from './debugConstants';
import { registerMeasureFeature } from './measure';
import { VRunnerManager } from '../../shared/vrunnerManager';

const log = logger.scope('dap');

/**
 * Фабрика дескриптора DAP: скачивает onec-debug-adapter в рантайме (как md-sparrow) и запускает его
 * через dotnet. Переопределяет статический `program` из package.json — адаптер больше не бандлится в VSIX.
 */
class OnecDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async createDebugAdapterDescriptor(): Promise<vscode.DebugAdapterDescriptor> {
		const runtime = await ensureOnecDebugAdapter(this.context);
		const cwd = runtime.args[0]
			? path.dirname(runtime.args[0])
			: path.dirname(runtime.command);
		return new vscode.DebugAdapterExecutable(runtime.command, runtime.args, { cwd });
	}
}

/** Куда смотреть за подробностями; добавляется к уведомлениям о проблемах адаптера. */
const ADAPTER_FAILURE_HINT = 'Подробности в панели Output, канал 1C: Platform Tools.';

/**
 * Текст об аварийном завершении процесса адаптера; undefined, если адаптер завершился штатно
 * или сессию остановили кнопкой (канал stdio закрывается, процесс часто выходит с кодом 1).
 */
export function adapterExitMessage(
	code?: number,
	signal?: string,
	sessionStopping = false
): string | undefined {
	if (code === 0) {
		return undefined;
	}
	if (sessionStopping && (code === 1 || code === undefined)) {
		return undefined;
	}
	const reason = code === undefined ? `сигнал ${signal ?? 'неизвестен'}` : `код возврата ${code}`;
	return `процесс адаптера отладки завершился аварийно: ${reason}`;
}

/** Ошибки канала stdio, которые VS Code даёт при штатной остановке сессии. */
export function isAdapterShutdownNoise(error: Error): boolean {
	const message = error.message.toLowerCase();
	return (
		message === 'read error' ||
		message.includes('epipe') ||
		message.includes('eof') ||
		message.includes('broken pipe')
	);
}

/**
 * Отслеживает жизненный цикл процесса адаптера. Без этого аварийное завершение адаптера выглядит как
 * молчаливое закрытие сессии: панель отладки исчезает, консоль отладки пуста, в Output ничего нет.
 * Остановку кнопкой не показываем как аварию: клиент закрывает pipe раньше ответа disconnect.
 */
class OnecDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(): vscode.DebugAdapterTracker {
		let sessionStopping = false;
		return {
			onWillStopSession() {
				sessionStopping = true;
			},
			onError(error: Error) {
				if (isAdapterShutdownNoise(error)) {
					// VS Code шлёт это при любом закрытии stdout адаптера, часто раньше onWillStopSession.
					log.debug(`канал адаптера закрыт: ${error.message}`);
					return;
				}
				const message = `ошибка процесса адаптера отладки: ${error.message}`;
				log.error(message);
				void vscode.window.showErrorMessage(`${capitalize(message)}. ${ADAPTER_FAILURE_HINT}`);
			},
			onExit(code: number | undefined, signal: string | undefined) {
				const message = adapterExitMessage(code, signal, sessionStopping);
				if (!message) {
					return;
				}
				log.error(message);
				void vscode.window.showErrorMessage(`${capitalize(message)}. ${ADAPTER_FAILURE_HINT}`);
			},
		};
	}
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Регистрирует интеграцию DAP 1С и обновление debug targets.
 */
export function registerDebugFeature(context: vscode.ExtensionContext): void {
	vscode.debug.registerDebugConfigurationProvider(
		DEBUG_TYPE,
		new OnecDebugConfigurationProvoider(VRunnerManager.getInstance(context))
	);
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory(
			DEBUG_TYPE,
			new OnecDebugAdapterDescriptorFactory(context)
		)
	);
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterTrackerFactory(DEBUG_TYPE, new OnecDebugAdapterTrackerFactory())
	);
	watchTargetTypesChanged(context);
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession((session) => {
			if (session.type === DEBUG_TYPE) {
				log.info(`сессия отладки запущена: ${session.name}`);
			}
			onecDebugTargets.updateDebugTargets(session);
		})
	);
	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.type === DEBUG_TYPE) {
				log.info(`сессия отладки завершена: ${session.name}`);
			}
		})
	);
	context.subscriptions.push(
		vscode.debug.onDidReceiveDebugSessionCustomEvent((ev) => {
			if (ev.event === 'DebugTargetsUpdated') {
				onecDebugTargets.updateDebugTargets(ev.session);
			} else if (ev.event === 'AdapterLog') {
				// Диагностика DAP-адаптера — в общий Output-канал, как остальные логи расширения.
				log.debug((ev.body as { message?: string })?.message ?? '');
			}
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'1c-platform-tools.debug.showVariableInWindow',
			(arg?: unknown) => showVariableInWindow(arg)
		)
	);
	registerBslBreakpointNormalizer(context);
	registerMeasureFeature(context);
	checkOnecDebugAdapterUpdateInBackground(context);
	onecDebugTargets.init(context);
}

/**
 * Открывает полное значение переменной отладки в отдельном редакторе. Неусечённое значение
 * по возможности берётся через evaluate (контекст clipboard), иначе — value из панели.
 */
async function showVariableInWindow(arg?: unknown): Promise<void> {
	// Контекстное меню панелей передаёт объект с полем variable; поддерживаем и прямую передачу.
	const container = arg as { variable?: Record<string, unknown> } | undefined;
	const variable = (container?.variable ?? arg) as Record<string, unknown> | undefined;
	if (!variable) {
		void vscode.window.showWarningMessage('Не удалось определить переменную отладки.');
		return;
	}

	const name = String(variable.name ?? variable.evaluateName ?? 'значение');
	const type = typeof variable.type === 'string' ? variable.type : undefined;
	let value = typeof variable.value === 'string' ? variable.value : String(variable.value ?? '');

	const session = vscode.debug.activeDebugSession;
	const evaluateName = typeof variable.evaluateName === 'string' ? variable.evaluateName : undefined;
	// activeStackItem есть не во всех версиях VS Code API.
	const stackItem = (vscode.debug as { activeStackItem?: { frameId?: number } }).activeStackItem;
	const frameId = stackItem?.frameId;
	if (session && evaluateName && typeof frameId === 'number') {
		try {
			const res = await session.customRequest('evaluate', {
				expression: evaluateName,
				frameId,
				context: 'clipboard',
			});
			if (res && typeof res.result === 'string' && res.result.length > 0) {
				value = res.result;
			}
		} catch {
			// откатываемся на value из панели
		}
	}

	const header = type ? `// ${name}: ${type}\n` : `// ${name}\n`;
	const doc = await vscode.workspace.openTextDocument({ content: header + value, language: 'plaintext' });
	await vscode.window.showTextDocument(doc, { preview: false });
}
