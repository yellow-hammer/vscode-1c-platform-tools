import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { SourceRoot } from '../../shared/projectLayout';
import { configurationDescriptorFile } from '../../shared/objectPaths';
import { logger } from '../../shared/logger';
import { notifyQuiet } from '../../shared/notify';
import { ensureMdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowMutation } from './mdSparrowMutationQueue';
import { runMdSparrowParamsMutation, runMdSparrowParamsRead, type MdSparrowParams } from './mdSparrowParams';

const log = logger.scope('md-sparrow');

export interface BspLibrary {
	readonly name: string;
	readonly version?: string;
	readonly file: string;
}

async function readVersions<T>(
	context: vscode.ExtensionContext,
	root: string,
	params: MdSparrowParams,
	fallback: T
): Promise<T> {
	try {
		const runtime = await ensureMdSparrowRuntime(context, root);
		const result = await runMdSparrowParamsRead(runtime, params, { cwd: root });
		if (result.exitCode !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim());
		}
		return JSON.parse(result.stdout) as T;
	} catch (error) {
		log.warn(`Не удалось прочитать версии: ${String(error)}`);
		return fallback;
	}
}

export async function readExternalVersions(
	context: vscode.ExtensionContext,
	root: string,
	modules: readonly string[]
): Promise<Record<string, string | undefined>> {
	const existing = await Promise.all(modules.map((file) => fs.stat(file).then((stat) => stat.isFile(), () => false)));
	const moduleFiles = modules.filter((_, index) => existing[index]);
	return moduleFiles.length
		? readVersions(context, root, { op: 'bsp-external-versions-get', moduleFiles }, {})
		: {};
}

export function loadBspLibraries(
	context: vscode.ExtensionContext,
	root: string,
	configuration: SourceRoot
): Promise<BspLibrary[]> {
	return readVersions(context, root, {
		op: 'bsp-libraries-get', configurationXml: configurationDescriptorFile(configuration), name: configuration.name,
	}, []);
}

function askSourceVersion(current?: string): Thenable<string | undefined> {
	return vscode.window.showInputBox({
		prompt: 'Введите новую версию',
		value: current,
		placeHolder: '1.0.0',
		validateInput: (value) => value.trim() ? undefined : 'Введите версию',
	}).then((value) => value?.trim());
}

export type SourceVersionTarget =
	| { op: 'configuration-version-set'; configurationXml: string }
	| { op: 'bsp-external-version-set' | 'bsp-library-version-set'; moduleFile: string };

async function writeSourceVersions(
	context: vscode.ExtensionContext,
	root: string,
	targets: SourceVersionTarget[],
	version: string
): Promise<boolean> {
	return runMdSparrowMutation(async () => {
		try {
			for (const target of targets) {
				const file = 'configurationXml' in target ? target.configurationXml : target.moduleFile;
				if (vscode.workspace.textDocuments.some((doc) => doc.isDirty && doc.uri.fsPath === file)) {
					throw new Error(`Сохраните изменения в файле ${file} и повторите команду.`);
				}
			}
			const runtime = await ensureMdSparrowRuntime(context, root);
			const operations = targets.map((target) => ({ ...target, name: version }));
			const params: MdSparrowParams = operations.length === 1 ? operations[0] : { op: 'batch', operations };
			const result = await runMdSparrowParamsMutation(runtime, params, { cwd: root });
			if (result.exitCode !== 0) {
				const message = result.stderr.trim() || result.stdout.trim();
				if (/неизвестный op:|unknown op/i.test(message)) {
					throw new Error('Обновите md-sparrow до версии с поддержкой установки версий исходников.');
				}
				throw new Error(message || 'Не удалось изменить версию.');
			}
		} catch (error) {
			void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
			return false;
		}
		await Promise.all([
			vscode.commands.executeCommand('1c-platform-tools.metadata.refresh'),
			vscode.commands.executeCommand('1c-platform-tools.metadata.refreshLibraries'),
		]);
		return true;
	});
}

export async function setSourceVersions(
	context: vscode.ExtensionContext,
	root: string,
	targets: SourceVersionTarget[],
	title: string,
	current?: string
): Promise<void> {
	const version = await askSourceVersion(current);
	if (version && await writeSourceVersions(context, root, targets, version)) {
		notifyQuiet(`${title} изменена на ${version}`);
	}
}
