import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { COMMON_MODULES_DIRECTORY, moduleFile, sourceDirectory } from '../../shared/objectPaths';
import type { SourceRoot } from '../../shared/projectLayout';
import { readBslModule } from './bslModuleFile';
import {
	bspLibraryDeclaration,
	bspVersionFunctionValue,
	registeredSubsystemModules,
} from './bspVersions';

const BSP_MODULE = 'ОбновлениеИнформационнойБазыБСП';
const REGISTRY_MODULE = 'ПодсистемыКонфигурацииПереопределяемый';

export interface BspLibrary {
	readonly name: string;
	readonly version?: string;
	readonly file: string;
}

/** Список библиотек основной конфигурации в порядке регистрации БСП. */
export async function loadBspLibraries(configuration: SourceRoot): Promise<BspLibrary[]> {
	const directory = sourceDirectory(configuration);
	const entries = await fs.readdir(path.join(directory, COMMON_MODULES_DIRECTORY)).catch(() => []);
	const moduleNames = new Map(entries.map((name) => [name.toLowerCase(), name]));
	const modulePath = (name: string): string | undefined => {
		const actual = moduleNames.get(name.toLowerCase());
		const relative = actual && moduleFile(configuration.format, 'ОбщийМодуль', actual, 'module');
		return relative ? path.join(directory, relative) : undefined;
	};
	const registryFile = modulePath(REGISTRY_MODULE);
	const registered = registryFile ? registeredSubsystemModules(await readBslModule(registryFile)) : [];
	const modules = new Set([BSP_MODULE, ...registered].map((name) => name.toLowerCase()));
	const libraries = await Promise.all([...modules].map(async (name): Promise<BspLibrary | undefined> => {
		const file = modulePath(name);
		if (!file) {
			return undefined;
		}
		const source = await readBslModule(file);
		const declaration = bspLibraryDeclaration(source);
		// БСП регистрирует основную конфигурацию тем же способом, но её версия уже показана в дереве.
		if (!declaration || declaration.name.toLowerCase() === configuration.name.toLowerCase()) {
			return undefined;
		}
		const value = declaration.version;
		let version: string | undefined;
		if (typeof value === 'string') {
			version = value;
		} else if (value) {
			const helper = value.module ? modulePath(value.module) : file;
			if (helper) {
				version = bspVersionFunctionValue(helper === file ? source : await readBslModule(helper), value.method);
			}
		}
		return { name: declaration.name, version, file };
	}));
	return libraries.filter((library) => library !== undefined);
}
