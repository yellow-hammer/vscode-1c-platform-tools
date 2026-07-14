/**
 * Каталоги исходников из настроек 1c-platform-tools.paths.* (единая точка чтения).
 * @module sourcePaths
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_PATHS } from './pathDefaults';

export interface SourceDirs {
	/** paths.cf */
	cf: string;
	/** paths.cfe */
	cfe: string;
	/** paths.epf */
	epf: string;
	/** paths.erf */
	erf: string;
}

function readPath(cfg: vscode.WorkspaceConfiguration, key: string, def: string): string {
	const value = cfg.get<string>(key, def).trim().replaceAll('\\', '/');
	return value.replace(/^\.\//, '').replace(/\/+$/, '') || def;
}

/** Настроенные каталоги исходников (относительно корня проекта). */
export function configuredSourceDirs(): SourceDirs {
	const cfg = vscode.workspace.getConfiguration('1c-platform-tools');
	return {
		cf: readPath(cfg, 'paths.cf', DEFAULT_PATHS.cf),
		cfe: readPath(cfg, 'paths.cfe', DEFAULT_PATHS.cfe),
		epf: readPath(cfg, 'paths.epf', DEFAULT_PATHS.epf),
		erf: readPath(cfg, 'paths.erf', DEFAULT_PATHS.erf),
	};
}

/** Абсолютный путь к корню исходников конфигурации (paths.cf) от корня workspace. */
export function configuredCfRootAbs(workspaceRoot: string): string {
	return path.join(workspaceRoot, ...configuredSourceDirs().cf.split('/'));
}
