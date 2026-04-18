import * as vscode from 'vscode';

const SETTINGS_EXT = '@ext:yellow-hammer.1c-platform-tools';

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
		'1c-platform-tools.settings',
		async () => {
			const choice = await vscode.window.showQuickPick(
				[
					{
						label: '$(plug) Сервер IPC',
						detail: 'MCP, порт, токен',
						filter: '1c-platform-tools.ipc',
					},
					{
						label: '$(tools) Инструменты',
						detail: 'vrunner, пути, docker, allure',
						filter: '1c-platform-tools',
					},
					{
						label: '$(folder-opened) Проекты',
						detail: 'baseFolders, исключения, избранное',
						filter: '1c-platform-tools.projects.',
					},
					{
						label: '$(package) Артефакты',
						detail: 'исключения при сканировании',
						filter: '1c-platform-tools.artifacts',
					},
					{
						label: '$(checklist) Список дел',
						detail: 'паттерны, исключения, теги',
						filter: '1c-platform-tools.todo',
					},
					{
						label: '$(list-tree) Метаданные 1С',
						detail: 'дерево метаданных, JAR, JRE',
						filter: '1c-platform-tools.metadata.',
					},
					{
						label: '$(settings-gear) Общее',
						detail: 'все настройки расширения',
						filter: '',
					},
				],
				{ placeHolder: 'Раздел настроек' }
			);
			let query = '';
			if (choice) {
				query = choice.filter ? `${SETTINGS_EXT} ${choice.filter}` : SETTINGS_EXT;
			}
			if (query) {
				await vscode.commands.executeCommand('workbench.action.openSettings', query);
			}
		}
	);

	const settingsOpenProjectsCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.openProjects',
		() =>
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				`${SETTINGS_EXT} 1c-platform-tools.projects.`
			)
	);
	const settingsOpenToolsCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.openTools',
		() => vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_EXT)
	);
	const settingsOpenTodoCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.openTodo',
		() =>
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				`${SETTINGS_EXT} 1c-platform-tools.todo`
			)
	);
	const settingsOpenArtifactsCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.openArtifacts',
		() =>
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				`${SETTINGS_EXT} 1c-platform-tools.artifacts`
			)
	);
	const settingsOpenMetadataCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.openMetadata',
		() =>
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				`${SETTINGS_EXT} 1c-platform-tools.metadata.`
			)
	);
	const settingsOpenIpcCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.openIpc',
		() =>
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				`${SETTINGS_EXT} 1c-platform-tools.ipc`
			)
	);
	const settingsOpenGeneralCommand = vscode.commands.registerCommand(
		'1c-platform-tools.settings.openGeneral',
		() => vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_EXT)
	);

	return [
		openCreateIssueCommand,
		openWriteReviewCommand,
		openSponsorCommand,
		settingsCommand,
		settingsOpenProjectsCommand,
		settingsOpenToolsCommand,
		settingsOpenTodoCommand,
		settingsOpenArtifactsCommand,
		settingsOpenMetadataCommand,
		settingsOpenIpcCommand,
		settingsOpenGeneralCommand,
	];
}
