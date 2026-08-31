import * as vscode from 'vscode';
import { openExtensionSettings } from './settingsSections';

/**
 * Регистрирует команды помощи и открытия настроек.
 */
export function registerHelpAndSettingsCommands(): vscode.Disposable[] {
	const openCreateIssueCommand = vscode.commands.registerCommand(
		'1c-platform-tools.help.openCreateIssue',
		() => {
			void vscode.env.openExternal(
				vscode.Uri.parse(
					'https://github.com/yellow-hammer/vscode-1c-platform-tools/issues/new?template=bug_report.md'
				)
			);
		}
	);

	const openDocsCommand = vscode.commands.registerCommand(
		'1c-platform-tools.help.openDocs',
		() => {
			void vscode.env.openExternal(
				vscode.Uri.parse(
					'https://github.com/yellow-hammer/vscode-1c-platform-tools/blob/main/docs/README.md'
				)
			);
		}
	);

	const openWriteReviewCommand = vscode.commands.registerCommand(
		'1c-platform-tools.help.openWriteReview',
		() => {
			void vscode.env.openExternal(
				vscode.Uri.parse(
					'https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools&ssr=false#review-details'
				)
			);
		}
	);

	const openSponsorCommand = vscode.commands.registerCommand(
		'1c-platform-tools.help.openSponsor',
		() => {
			void vscode.env.openExternal(
				vscode.Uri.parse(
					'https://github.com/yellow-hammer/vscode-1c-platform-tools?tab=readme-ov-file#%D0%B0%D0%B2%D1%82%D0%BE%D1%80'
				)
			);
		}
	);

	/** Шестерёнка любой панели открывает один и тот же список настроек расширения. */
	const registerSettingsCommand = (commandId: string): vscode.Disposable =>
		vscode.commands.registerCommand(commandId, () => openExtensionSettings());

	const settingsOpenProjectsCommand = registerSettingsCommand('1c-platform-tools.projects.openSettings');
	const settingsOpenToolsCommand = registerSettingsCommand('1c-platform-tools.tools.openSettings');
	const settingsOpenTodoCommand = registerSettingsCommand('1c-platform-tools.todo.openSettings');
	const settingsOpenArtifactsCommand = registerSettingsCommand('1c-platform-tools.artifacts.openSettings');
	const settingsOpenMetadataCommand = registerSettingsCommand('1c-platform-tools.metadata.openSettings');

	return [
		openCreateIssueCommand,
		openDocsCommand,
		openWriteReviewCommand,
		openSponsorCommand,
		settingsOpenProjectsCommand,
		settingsOpenToolsCommand,
		settingsOpenTodoCommand,
		settingsOpenArtifactsCommand,
		settingsOpenMetadataCommand,
	];
}
