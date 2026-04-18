import * as vscode from 'vscode';
import {
	registerGetStarted,
	showGetStartedOnFirstRun,
} from '../features/tools/getStartedView';

/**
 * Регистрирует welcome-flow: команду открытия руководства и первичный автопоказ.
 */
export function registerWelcomeFlow(context: vscode.ExtensionContext): void {
	registerGetStarted(context);
	showGetStartedOnFirstRun(context);
}
