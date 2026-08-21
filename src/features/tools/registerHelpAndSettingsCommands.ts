import * as vscode from 'vscode';
import { SETTINGS_SECTIONS, SettingsSection, settingsQuery } from './settingsSections';

/**
 * Открывает настройки расширения на нужном разделе.
 *
 * @param section - Раздел настроек
 */
async function openSettings(section: SettingsSection['id']): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.openSettings', settingsQuery(section));
}

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

	const settingsCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.open',
		async () => {
			const choice = await vscode.window.showQuickPick(
				SETTINGS_SECTIONS.map((section) => ({
					label: `$(${section.icon}) ${section.label}`,
					detail: section.detail,
					id: section.id,
				})),
				{ placeHolder: 'Раздел настроек' }
			);
			if (choice) {
				await openSettings(choice.id);
			}
		}
	);

	/** Команда открытия настроек конкретного раздела. */
	const registerSectionCommand = (commandId: string, section: SettingsSection['id']): vscode.Disposable =>
		vscode.commands.registerCommand(commandId, () => openSettings(section));

	const settingsOpenProjectsCommand = registerSectionCommand('1c-platform-tools.settings.openProjects', 'projects');
	const settingsOpenToolsCommand = registerSectionCommand('1c-platform-tools.settings.openTools', 'all');
	const settingsOpenTodoCommand = registerSectionCommand('1c-platform-tools.settings.openTodo', 'todo');
	const settingsOpenArtifactsCommand = registerSectionCommand('1c-platform-tools.settings.openArtifacts', 'artifacts');
	const settingsOpenMetadataCommand = registerSectionCommand('1c-platform-tools.settings.openMetadata', 'metadata');
	const settingsOpenIpcCommand = registerSectionCommand('1c-platform-tools.settings.openIpc', 'ipc');

	return [
		openCreateIssueCommand,
		openDocsCommand,
		openWriteReviewCommand,
		openSponsorCommand,
		settingsCommand,
		settingsOpenProjectsCommand,
		settingsOpenToolsCommand,
		settingsOpenTodoCommand,
		settingsOpenArtifactsCommand,
		settingsOpenMetadataCommand,
		settingsOpenIpcCommand,
	];
}
