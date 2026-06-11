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
import { registerMeasureFeature } from './measure';

const DEBUG_TYPE = '1c-platform-tools';

/**
 * Фабрика дескриптора DAP: скачивает onec-debug-adapter в рантайме (как md-sparrow) и запускает его
 * через dotnet. Переопределяет статический `program` из package.json — адаптер больше не бандлится в VSIX.
 */
class OnecDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async createDebugAdapterDescriptor(): Promise<vscode.DebugAdapterDescriptor> {
		const runtime = await ensureOnecDebugAdapter(this.context);
		return new vscode.DebugAdapterExecutable('dotnet', [runtime.dllPath]);
	}
}

/**
 * Регистрирует интеграцию DAP 1С и обновление debug targets.
 */
export function registerDebugFeature(context: vscode.ExtensionContext): void {
	vscode.debug.registerDebugConfigurationProvider(
		DEBUG_TYPE,
		new OnecDebugConfigurationProvoider()
	);
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory(
			DEBUG_TYPE,
			new OnecDebugAdapterDescriptorFactory(context)
		)
	);
	watchTargetTypesChanged(context);
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession((session) => {
			onecDebugTargets.updateDebugTargets(session);
		})
	);
	context.subscriptions.push(
		vscode.debug.onDidReceiveDebugSessionCustomEvent((ev) => {
			if (ev.event === 'DebugTargetsUpdated') {
				onecDebugTargets.updateDebugTargets(ev.session);
			} else if (ev.event === 'AdapterLog') {
				// Диагностика DAP-адаптера — в общий Output-канал, как остальные логи расширения.
				logger.debug(`[DAP] ${(ev.body as { message?: string })?.message ?? ''}`);
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
