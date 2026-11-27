import * as vscode from 'vscode';
import * as path from 'node:path';
import { pickExtensions } from '../features/extensions/extensionPicker';
import { emptySelectionSource } from '../features/extensions/extensionSelection';
import { extensionEntries } from '../features/extensions/extensionRoots';
import { setSourceVersions } from '../features/metadata/sourceVersions';
import { configurationScope, NO_CONFIGURATION_SOURCES } from '../shared/activeConfiguration';
import { showWorkspaceRequired } from '../shared/configurationWriteTarget';
import { notifyQuiet } from '../shared/notify';
import { configurationDescriptorFile, moduleFileOf } from '../shared/objectPaths';
import { externalEntry, type ExternalKind } from '../shared/projectLayout';
import { projectPaths, type RelativeExternal } from '../shared/projectPaths';
import { projectMemento } from '../shared/projectState';
import { currentRoot } from '../shared/workspaceProjects';

function versionProjectRoot(): string | undefined {
	const root = currentRoot();
	if (!root) {
		showWorkspaceRequired();
	}
	return root;
}

/** Установка версий в исходниках через md-sparrow. */
export class SetVersionCommands {
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly writeVersions = setSourceVersions
	) {}

	async setVersionConfiguration(): Promise<void> {
		const root = versionProjectRoot();
		if (!root) {
			return;
		}
		const { configuration } = await configurationScope(root);
		if (!configuration) {
			void vscode.window.showErrorMessage(NO_CONFIGURATION_SOURCES);
			return;
		}
		await this.writeVersions(this.context, root, [{
			op: 'configuration-version-set',
			configurationXml: configurationDescriptorFile(configuration),
		}], 'Версия конфигурации');
	}

	async setVersionExtension(): Promise<void> {
		const root = versionProjectRoot();
		if (!root) {
			return;
		}
		const extensions = extensionEntries(await projectPaths(root), 'all');
		if (extensions.length === 0) {
			void vscode.window.showInformationMessage('Расширений в рабочей области не найдено.');
			return;
		}
		const selected = await pickExtensions(extensions, projectMemento());
		if (selected === undefined) {
			return;
		}
		if (selected.length === 0) {
			void vscode.window.showInformationMessage(`Расширений ${emptySelectionSource('solution')} в рабочей области нет`);
			return;
		}
		await this.writeVersions(this.context, root, selected.map((extension) => ({
			op: 'configuration-version-set',
			configurationXml: configurationDescriptorFile({
				name: extension.name, dir: path.resolve(root, extension.dir), format: extension.format, isExtension: true,
			}),
		})), 'Версия расширений');
	}

	setVersionReport(name?: string): Promise<void> {
		return this.setExternalVersion('report', name);
	}

	setVersionProcessor(name?: string): Promise<void> {
		return this.setExternalVersion('processor', name);
	}

	private async setExternalVersion(kind: ExternalKind, name?: string): Promise<void> {
		const root = versionProjectRoot();
		if (!root) {
			return;
		}
		const { reports, processors } = await projectPaths(root);
		const objects = kind === 'report' ? reports : processors;
		if (objects.length === 0) {
			notifyQuiet(
				kind === 'report' ? 'Внешних отчётов в рабочей области нет' : 'Внешних обработок в рабочей области нет'
			);
			return;
		}
		let selected: readonly RelativeExternal[];
		if (name !== undefined) {
			const object = objects.find((entry) => entry.name === name);
			if (!object) {
				void vscode.window.showErrorMessage(`Исходники «${name}» не найдены.`);
				return;
			}
			selected = [object];
		} else {
			const picked = await vscode.window.showQuickPick(objects.map((object) => ({
				label: object.name,
				description: object.dir,
				object,
			})), {
				canPickMany: true,
				matchOnDescription: true,
				placeHolder: kind === 'report' ? 'Выберите внешние отчёты' : 'Выберите внешние обработки',
			});
			if (!picked?.length) {
				return;
			}
			selected = picked.map(({ object }) => object);
		}
		const title = selected.length === 1 ? `Версия «${selected[0].name}»`
			: kind === 'report' ? 'Версия отчётов' : 'Версия обработок';
		await this.writeVersions(this.context, root, selected.map((object) => ({
			op: 'bsp-external-version-set',
			moduleFile: moduleFileOf(externalEntry({ ...object, dir: path.resolve(root, object.dir) }), 'object'),
		})), title);
	}

	async getReportNames(): Promise<string[]> {
		const root = currentRoot();
		return root ? (await projectPaths(root)).reports.map((report) => report.name) : [];
	}

	async getProcessorNames(): Promise<string[]> {
		const root = currentRoot();
		return root ? (await projectPaths(root)).processors.map((processor) => processor.name) : [];
	}
}
