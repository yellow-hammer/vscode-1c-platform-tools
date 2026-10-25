import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PipelineCommands } from '../../commands/pipelineCommands';
import type { StructuredCommandResult } from '../../shared/commandExecutionTypes';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { runWithProject } from '../../shared/workspaceProjects';
import { buildProcessCommand } from '../../utils/commandUtils';
import { writeLocalRunner } from '../fixtures/helpers/vrunnerStub';

/**
 * Пайплайн запускается здесь, а не командой: у расширения в хосте тестов свой
 * экземпляр модулей, и корень вызова теста до него не доходит.
 */
suite('пайплайн: профиль и окружение шагов', () => {
	const vrunner = VRunnerManager.getInstance();
	let root: string;

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-launch-'));
		writeLocalRunner(root, '3.0.0');
		for (const id of ['ci', 'dev', 'test']) {
			fs.writeFileSync(path.join(root, `.env.${id}`), `DB=${id}\n`, 'utf8');
		}
		fs.mkdirSync(path.join(root, '.1cpt'));
	});

	teardown(() => {
		fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	/** Шаг оболочки, который пишет в файл переменную DB своего окружения */
	function writeDb(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
		const file = path.join(root, `${id}.txt`);
		const code = `require('fs').writeFileSync(${JSON.stringify(file)}, process.env.DB || 'нет')`;
		return { id, type: 'shell', script: buildProcessCommand('node', ['-e', code]), ...extra };
	}

	function writePipeline(pipeline: Record<string, unknown>): void {
		fs.writeFileSync(path.join(root, '.1cpt', 'pipelines.json'), JSON.stringify({ version: 2, pipelines: [pipeline] }), 'utf8');
	}

	async function run(launch: { profile?: string; environment?: string } = {}): Promise<StructuredCommandResult | undefined> {
		const result = await runWithProject(root, () => new PipelineCommands().run({ projectPath: root, pipeline: 'p', wait: true, ...launch }));
		return result ?? undefined;
	}

	test('шаг идёт со своим окружением, иначе с окружением пайплайна; выбор редактора не меняется', async function () {
		this.timeout(60_000);
		writePipeline({
			id: 'p',
			name: 'P',
			environment: 'dev',
			nodes: [
				writeDb('inherit'),
				writeDb('own', { environment: 'test' }),
				writeDb('none', { environment: null }),
				writeDb('editor', { environment: '@editor' }),
			],
			edges: [
				{ from: 'inherit', to: 'own' },
				{ from: 'own', to: 'none' },
				{ from: 'none', to: 'editor' },
			],
		});
		await vrunner.runWithProjectRoot(root, () => vrunner.setActiveEnvironmentId('ci'));

		const result = await run();

		assert.ok(result?.success, result?.stderr ?? 'нет результата');
		const value = (id: string) => fs.readFileSync(path.join(root, `${id}.txt`), 'utf8');
		assert.deepStrictEqual(
			['inherit', 'own', 'none', 'editor'].map(value),
			['dev', 'test', 'нет', 'ci']
		);
		assert.strictEqual(await vrunner.runWithProjectRoot(root, async () => vrunner.getActiveEnvironmentId()), 'ci');
	});

	test('окружение на прогон заменяет выбор редактора, своё окружение шага остаётся', async function () {
		this.timeout(60_000);
		writePipeline({
			id: 'p',
			name: 'P',
			environment: '@editor',
			nodes: [writeDb('editor'), writeDb('own', { environment: 'test' })],
			edges: [{ from: 'editor', to: 'own' }],
		});
		await vrunner.runWithProjectRoot(root, () => vrunner.setActiveEnvironmentId('ci'));

		const result = await run({ environment: 'dev' });

		assert.ok(result?.success, result?.stderr ?? 'нет результата');
		const value = (id: string) => fs.readFileSync(path.join(root, `${id}.txt`), 'utf8');
		assert.deepStrictEqual(['editor', 'own'].map(value), ['dev', 'test']);
		assert.strictEqual(await vrunner.runWithProjectRoot(root, async () => vrunner.getActiveEnvironmentId()), 'ci');

		const unknown = await run({ environment: 'stage' });
		assert.strictEqual(unknown?.success, false);
		assert.match(unknown?.stderr ?? '', /Окружение «stage» не найдено/);
	});

	test('профиля или окружения нет в проекте: пайплайн не стартует', async function () {
		this.timeout(60_000);
		writePipeline({ id: 'p', name: 'P', profile: 'nightly', nodes: [writeDb('step', { environment: 'missing' })], edges: [] });

		const result = await run();

		assert.strictEqual(result?.success, false);
		assert.match(result?.stderr ?? '', /профиля «nightly» нет в проекте; окружения «missing» нет в проекте/);
		assert.strictEqual(fs.existsSync(path.join(root, 'step.txt')), false);
	});
});
