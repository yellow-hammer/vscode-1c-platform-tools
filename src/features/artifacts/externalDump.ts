import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { objectDirectoryOf } from '../../shared/objectPaths';
import { describeMarker, externalEntry, readDesignerExternal, type ExternalKind } from '../../shared/projectLayout';

export interface ExternalDump {
	readonly descriptor: string;
	readonly name: string;
	readonly kind: ExternalKind;
}

async function externalDumpIn(directory: string, entries?: Dirent[]): Promise<ExternalDump | undefined> {
	const external = await readDesignerExternal(directory, entries);
	if (!external) {
		return undefined;
	}
	const descriptor = externalEntry(external);
	const { name } = describeMarker(await fs.readFile(descriptor, 'utf8'), 'designer');
	if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) {
		throw new Error(`В описании «${path.basename(descriptor)}» не найдено имя внешнего объекта.`);
	}
	return { descriptor, name, kind: external.kind };
}

/** Раннер создаёт каталог по имени входного файла, а имя XML задаёт Конфигуратор. */
export async function readExternalDump(output: string, fileStem: string): Promise<ExternalDump> {
	const dump = await externalDumpIn(path.join(output, fileStem));
	if (!dump) {
		throw new Error(`В результате разборки «${fileStem}» не найдено описание внешнего объекта.`);
	}
	return dump;
}

/** Пакетная разборка может сохранять подкаталоги входных файлов. */
export async function readExternalDumps(output: string): Promise<ExternalDump[]> {
	const entries = await fs.readdir(output, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
		if (error.code === 'ENOENT') {
			return [];
		}
		throw error;
	});
	const dump = await externalDumpIn(output, entries);
	if (dump) {
		return [dump];
	}
	const dumps: ExternalDump[] = [];
	for (const entry of entries) {
		if (entry.isDirectory()) {
			dumps.push(...await readExternalDumps(path.join(output, entry.name)));
		}
	}
	return dumps;
}

/** Копирует описание и его файлы под именем, которое уже принято в исходниках. */
export async function copyExternalDump(sourceDescriptor: string, targetDescriptor: string): Promise<void> {
	const sourceFiles = objectDirectoryOf(sourceDescriptor);
	const files = await fs.stat(sourceFiles).catch((error: NodeJS.ErrnoException) => {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	});
	await fs.mkdir(path.dirname(targetDescriptor), { recursive: true });
	if (files?.isDirectory()) {
		await fs.cp(sourceFiles, objectDirectoryOf(targetDescriptor), { recursive: true });
	}
	await fs.copyFile(sourceDescriptor, targetDescriptor);
}
