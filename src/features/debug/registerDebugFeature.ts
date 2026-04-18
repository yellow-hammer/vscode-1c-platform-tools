import * as vscode from 'vscode';
import * as onecDebugTargets from './debugTargets';
import {
	OnecDebugConfigurationProvoider,
	watchTargetTypesChanged,
} from './debugConfigurations';

/**
 * Регистрирует интеграцию DAP 1С и обновление debug targets.
 */
export function registerDebugFeature(context: vscode.ExtensionContext): void {
	vscode.debug.registerDebugConfigurationProvider(
		'1c-platform-tools',
		new OnecDebugConfigurationProvoider()
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
	onecDebugTargets.init(context);
}
