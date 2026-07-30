/**
 * Команды хуков: открыть редактор и файл `.1cpt/hooks.json`.
 *
 * Хуки живут рядом с пайплайнами: и то и другое - автоматизация вокруг команд
 * расширения, только пайплайн собирают вручную, а хук срабатывает сам.
 */

import * as vscode from 'vscode';
import { BaseCommand } from './baseCommand';
import { logger } from '../shared/logger';
import { hooksFilePath, writeHooks, HOOKS_FILE_REL_PATH, HOOKS_FILE_VERSION } from '../shared/hooks/hooksModel';
import { HOOKS_EDITOR_VIEW_TYPE, HooksEditorProvider } from '../features/hooks/hooksEditorProvider';

const log = logger.scope('hooks');

export class HooksCommands extends BaseCommand {
	/**
	 * Открывает хуки в редакторе, создавая файл при отсутствии.
	 *
	 * @param commandId - Команда, которую нужно выделить после открытия
	 * @returns Ничего
	 */
	async openEditor(commandId?: string): Promise<void> {
		const uri = await this.ensureFile();
		if (!uri) {
			return;
		}
		await vscode.commands.executeCommand('vscode.openWith', uri, HOOKS_EDITOR_VIEW_TYPE);
		if (typeof commandId === 'string' && commandId !== '') {
			HooksEditorProvider.revealCommand(commandId);
		}
	}

	/**
	 * Создаёт файл хуков, если его нет.
	 *
	 * @returns Ссылка на файл или undefined без рабочей области
	 */
	private async ensureFile(): Promise<vscode.Uri | undefined> {
		const workspaceRoot = this.ensureWorkspace();
		if (!workspaceRoot) {
			return undefined;
		}
		const uri = vscode.Uri.file(hooksFilePath(workspaceRoot));
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			await writeHooks(workspaceRoot, { version: HOOKS_FILE_VERSION, hooks: {} });
			log.info(`Создан ${HOOKS_FILE_REL_PATH}`);
		}
		return uri;
	}
}
