import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	mergePipelineTemplates,
	mergeSummary,
	readPipelineTemplates,
} from '../../shared/pipelines/pipelineTemplates';
import { commandTitle } from '../../shared/commandCatalog';
import type { Pipeline } from '../../shared/pipelines/pipelineTypes';

/** Корень расширения: тесты идут из out/test, шаблоны лежат в resources. */
const extensionPath = path.resolve(__dirname, '..', '..', '..');

function pipeline(id: string, name: string): Pipeline {
	return { id, name, nodes: [{ id: 'a', type: 'command', command: '1c-platform-tools.test.xunit' }], edges: [] };
}

suite('pipelineTemplates: установка типовых цепочек', () => {
	test('новая цепочка дописывается, чужие остаются на месте', () => {
		const existing = [pipeline('my-own', 'Своя цепочка')];

		const result = mergePipelineTemplates(existing, [pipeline('template-test-run', 'Прогон тестов')]);

		assert.deepStrictEqual(
			result.pipelines.map((item) => item.id),
			['my-own', 'template-test-run']
		);
		assert.deepStrictEqual(result.added, ['template-test-run']);
		assert.deepStrictEqual(result.updated, []);
	});

	test('цепочка шаблона узнаётся по идентификатору и переписывается на месте', () => {
		const existing = [
			pipeline('my-own', 'Своя цепочка'),
			{ ...pipeline('template-test-run', 'Прогон тестов, правленый'), nodes: [] },
			pipeline('another', 'Ещё своя'),
		];

		const result = mergePipelineTemplates(existing, [pipeline('template-test-run', 'Прогон тестов')]);

		assert.deepStrictEqual(
			result.pipelines.map((item) => item.id),
			['my-own', 'template-test-run', 'another']
		);
		assert.strictEqual(result.pipelines[1].name, 'Прогон тестов');
		assert.strictEqual(result.pipelines[1].nodes.length, 1);
		assert.deepStrictEqual(result.updated, ['template-test-run']);
		assert.deepStrictEqual(result.added, []);
	});

	test('переименованная цепочка шаблона всё равно узнаётся', () => {
		const existing = [pipeline('template-test-run', 'Мои тесты')];

		const result = mergePipelineTemplates(existing, [pipeline('template-test-run', 'Прогон тестов')]);

		assert.strictEqual(result.pipelines.length, 1);
		assert.deepStrictEqual(result.updated, ['template-test-run']);
	});

	test('сообщение об установке различает добавленные и обновлённые', () => {
		const names = new Map([
			['template-test-run', 'Прогон тестов'],
			['template-delivery-build', 'Сборка поставки'],
		]);

		assert.strictEqual(
			mergeSummary({ pipelines: [], added: ['template-test-run'], updated: [] }, names),
			'Добавлены цепочки: Прогон тестов'
		);
		assert.strictEqual(
			mergeSummary({ pipelines: [], added: [], updated: ['template-test-run'] }, names),
			'Обновлены цепочки: Прогон тестов'
		);
		assert.strictEqual(
			mergeSummary({ pipelines: [], added: ['template-delivery-build'], updated: ['template-test-run'] }, names),
			'Добавлены цепочки: Сборка поставки; обновлены: Прогон тестов'
		);
	});
});

suite('pipelineTemplates: поставляемые цепочки', () => {
	test('шаблоны читаются и ссылаются на существующие команды расширения', async () => {
		const templates = await readPipelineTemplates(extensionPath);

		assert.ok(templates.length >= 5, `шаблонов: ${templates.length}`);
		for (const template of templates) {
			assert.ok(template.id.startsWith('template-'), `идентификатор шаблона: ${template.id}`);
			assert.ok(template.nodes.length > 0, `${template.name}: нет шагов`);
			for (const node of template.nodes) {
				assert.strictEqual(node.type, 'command', `${template.name}: шаг не команда`);
				assert.ok(node.command, `${template.name}: у шага нет команды`);
				assert.notStrictEqual(
					commandTitle(node.command as string),
					undefined,
					`${template.name}: команды ${node.command} нет в каталоге`
				);
			}
		}
	});

	test('связи шаблонов ведут в существующие шаги', async () => {
		const templates = await readPipelineTemplates(extensionPath);

		for (const template of templates) {
			const ids = new Set(template.nodes.map((node) => node.id));
			for (const edge of template.edges) {
				assert.ok(ids.has(edge.from), `${template.name}: связь из неизвестного шага ${edge.from}`);
				assert.ok(ids.has(edge.to), `${template.name}: связь в неизвестный шаг ${edge.to}`);
			}
		}
	});

	test('сборка поставки собирает из исходников, а не выгружает из базы', async () => {
		const templates = await readPipelineTemplates(extensionPath);
		const delivery = templates.find((template) => template.id === 'template-delivery-build');

		assert.ok(delivery, 'нет шаблона сборки поставки');
		assert.deepStrictEqual(
			delivery.nodes.map((node) => node.command),
			[
				'1c-platform-tools.cf.compile',
				'1c-platform-tools.cfe.compile',
				'1c-platform-tools.epf.compileProcessor',
				'1c-platform-tools.epf.compileReport',
			]
		);
	});

	test('развёртывание базы идёт в правильном порядке', async () => {
		const templates = await readPipelineTemplates(extensionPath);
		const deploy = templates.find((template) => template.id === 'template-infobase-deploy');

		assert.ok(deploy, 'нет шаблона развёртывания');
		assert.deepStrictEqual(
			deploy.nodes.map((node) => node.command),
			[
				'1c-platform-tools.infobase.create',
				'1c-platform-tools.cf.load',
				'1c-platform-tools.cfe.load',
				'1c-platform-tools.infobase.runUpdateHandlers',
				'1c-platform-tools.infobase.initialize',
			]
		);
	});
});
