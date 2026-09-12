/**
 * Мост EDT для адаптеров панели тестирования.
 *
 * Команды проводятся через проект 1С:EDT в BaseCommand; у адаптеров панели
 * такого слоя нет, а тестовая обработка из проекта EDT собирается так же:
 * проект выгружает сама EDT, и раннер собирает .epf уже из выгрузки. План
 * строится без EDT, выгрузка идёт отдельным шагом перед сборкой.
 *
 * @module edtBridgeService
 */

import * as path from 'node:path';
import { configurationScope } from '../../shared/activeConfiguration';
import { enclosingEdtProject, resolveProjectLayout } from '../../shared/projectLayout';
import { runnerPath } from '../../shared/projectPaths';
import type { VRunnerIntent } from '../../shared/vrunnerCli/intents';
import { TaskOutputChain } from '../tasks/vrunnerTask';
import { runEdtExports, type EdtBridgeContext } from './edtBridgeRunner';
import { edtProjectName, edtStagingRoot } from './edtRunner';
import {
	edtBaseProjectOf,
	edtExternalProjectsOf,
	planEdtBridge,
	type EdtBaseLookup,
	type EdtExportStep,
} from './edtSourceBridge';

/** Сборка внешнего объекта из проекта EDT: что выгрузить и что собрать. */
export interface EdtBuildBridge {
	/** Сборка над выгрузкой проекта. */
	intent: VRunnerIntent;
	/** Проекты, которые выгружаются перед сборкой. */
	exports: EdtExportStep[];
	/** Где идут выгрузки. */
	context: EdtBridgeContext;
}

/**
 * План сборки внешнего объекта из проекта EDT.
 *
 * @param workspaceRoot - Корень рабочей области
 * @param outPath - Каталог сборки проекта
 * @param intent - Сборка; src это каталог объекта или проекта, абсолютный либо относительно рабочей области
 * @returns План либо undefined, когда src лежит вне проекта EDT
 */
export async function planEdtExternalBuild(
	workspaceRoot: string,
	outPath: string,
	intent: Extract<VRunnerIntent, { kind: 'epf.build' }>
): Promise<EdtBuildBridge | undefined> {
	const project = enclosingEdtProject(workspaceRoot, path.resolve(workspaceRoot, intent.src));
	if (!project) {
		return undefined;
	}
	const buildDir = edtStagingRoot(workspaceRoot, outPath);
	const plan = planEdtBridge(
		intent,
		{ format: 'edt', dir: runnerPath(workspaceRoot, project) },
		{ buildDir, externalProjects: edtExternalProjectsOf(workspaceRoot, intent.src) }
	);
	if (!plan) {
		return undefined;
	}
	// Базовый проект у каждой выгрузки свой: по манифесту проекта, иначе активная конфигурация
	const baseOf = await baseProjectResolver(workspaceRoot);
	const exports = plan.exports.map((step) =>
		'projectDir' in step ? { ...step, baseProjectDir: baseOf(step.projectDir) } : step
	);
	return { intent: plan.intent, exports, context: { workspaceRoot, buildDir } };
}

/** Каталог базового проекта относительно рабочей области по каталогу проекта. */
async function baseProjectResolver(workspaceRoot: string): Promise<(projectDir: string) => string | undefined> {
	const layout = await resolveProjectLayout(workspaceRoot);
	const scope = await configurationScope(workspaceRoot);
	const lookup: EdtBaseLookup = {
		configurations: [...(layout.configuration ? [layout.configuration] : []), ...layout.others]
			.filter((root) => root.format === 'edt')
			.map((root) => root.dir),
		projectName: edtProjectName,
		active: scope.configuration?.format === 'edt' ? scope.configuration.dir : undefined,
	};
	return (projectDir) => {
		const base = edtBaseProjectOf(path.resolve(workspaceRoot, projectDir), lookup);
		return base === undefined ? undefined : runnerPath(workspaceRoot, base);
	};
}

/**
 * Выгружает проекты планов; без выгрузки собирать нечего.
 *
 * Планы одной рабочей области идут одной серией: у них общий контекст и общий
 * терминал, а одинаковая выгрузка из двух планов делается один раз.
 *
 * @param bridges - Планы сборки
 * @throws {Error} Если выгрузка не удалась
 */
export async function runEdtBuildExports(bridges: readonly EdtBuildBridge[]): Promise<void> {
	if (bridges.length === 0) {
		return;
	}
	const exports = new Map<string, EdtExportStep>();
	for (const step of bridges.flatMap((bridge) => bridge.exports)) {
		exports.set(JSON.stringify(step), step);
	}
	const context = { ...bridges[0].context, output: new TaskOutputChain() };
	if (!(await runEdtExports([...exports.values()], context))) {
		throw new Error('Выгрузка проекта 1С:EDT не удалась, сборка не запущена.');
	}
}
