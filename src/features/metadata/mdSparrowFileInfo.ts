import * as path from 'node:path';
import type { MdSparrowRuntime } from './mdSparrowBootstrap';
import { runMdSparrowParamsRead, type MdSparrowOp } from './mdSparrowParams';

export interface MetadataFileInfo {
	schemaVersion: string;
	configurationExtension: boolean;
}

export type TemplateContentKind = 'dcs' | 'spreadsheet' | 'text' | 'binary';

export interface MdSparrowFileReader {
	metadata(file: string): Promise<MetadataFileInfo>;
	templateKind(file: string): Promise<TemplateContentKind>;
}

/** Сведения о файлах выгрузки и макетов из md-sparrow. */
export function mdSparrowFileReader(runtime: MdSparrowRuntime): MdSparrowFileReader {
	async function read<T>(op: MdSparrowOp, objectXml: string): Promise<T> {
		const result = await runMdSparrowParamsRead(runtime, { op, objectXml }, { cwd: path.dirname(objectXml) });
		if (result.exitCode !== 0) {
			throw new Error((result.stderr.trim() || result.stdout.trim() || `код ${result.exitCode}`).slice(0, 400));
		}
		return JSON.parse(result.stdout) as T;
	}
	return {
		metadata: (file) => read<MetadataFileInfo>('cf-metadata-file-info', file),
		templateKind: (file) => read<TemplateContentKind>('cf-template-content-kind', file),
	};
}
