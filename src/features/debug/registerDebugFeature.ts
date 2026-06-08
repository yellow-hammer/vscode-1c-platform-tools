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
			}
		})
	);
	// Сброс кэша DAP объединён в команду «1C: Метаданные: Сбросить кэш» (см. registerMetadataFeature).
	checkOnecDebugAdapterUpdateInBackground(context);
	onecDebugTargets.init(context);
}
