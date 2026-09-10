import * as assert from 'node:assert';
import * as path from 'node:path';
import { loadEditorSections } from '../../features/profileEditor/optionsCatalog';

// Ресурсы каталога лежат в корне расширения; в тестах — корень репозитория
const extensionPath = path.resolve(__dirname, '..', '..', '..');

suite('profileEditor: каталог опций', () => {
	test('v2: главная секция default с --ibcmd, приоритет и группа из overrides', () => {
		const { sections, groups } = loadEditorSections(extensionPath, 'v2');
		assert.ok(sections.length > 10);
		assert.strictEqual(sections[0].id, 'default');
		assert.strictEqual(sections[0].isMain, true);
		assert.ok(groups.some((group) => group.id === 'connection'));

		const ibcmd = sections[0].options.find((option) => option.key === '--ibcmd');
		assert.ok(ibcmd, 'в default должна быть опция --ibcmd');
		assert.strictEqual(ibcmd.type, 'boolean');
		assert.ok(ibcmd.description.length > 10, 'описание должно быть содержательным');
		assert.strictEqual(ibcmd.group, 'ibcmd');

		// приоритетные опции выше остальных
		assert.strictEqual(sections[0].options[0].key, '--ibconnection');
	});

	test('v3: описания из аннотаций/доков и кураторские уточнения применяются', () => {
		const { sections } = loadEditorSections(extensionPath, 'v3');
		assert.strictEqual(sections[0].id, 'vrunner');
		const common = new Map(sections[0].options.map((option) => [option.key, option]));

		const ibsrv = common.get('ibsrv');
		assert.ok(ibsrv && ibsrv.description.includes('автономный сервер'), 'ibsrv должен иметь описание из аннотации');

		const ordinaryapp = common.get('ordinaryapp');
		assert.ok(ordinaryapp, 'ordinaryapp должен быть в общих опциях');
		assert.deepStrictEqual(ordinaryapp.enum, ['-1', '0', '1'], 'enum из overrides');
		assert.strictEqual(ordinaryapp.enumLabels?.['-1'], 'Авто');

		const cfeLoad = sections.find((section) => section.id === 'vrunner.cfe.load');
		assert.ok(cfeLoad, 'должна быть секция vrunner.cfe.load');
		assert.deepStrictEqual(cfeLoad.jsonPath, ['vrunner', 'cfe', 'load']);
		assert.ok(cfeLoad.options.some((option) => option.key === 'no-update-db'));
		// опции наборов доступны и на уровне команды (каскад)
		assert.ok(cfeLoad.options.some((option) => option.key === 'ibconnection'));
	});

	test('v2: секция yaxunit с опциями run и пояснением', () => {
		const { sections } = loadEditorSections(extensionPath, 'v2');
		const yaxunit = sections.find((section) => section.id === 'yaxunit');
		assert.ok(yaxunit, 'должна быть секция yaxunit');
		assert.strictEqual(yaxunit.advertised, true);
		assert.deepStrictEqual(yaxunit.jsonPath, ['yaxunit']);
		assert.ok(yaxunit.hint && yaxunit.hint.length > 0, 'пояснение, кто читает секцию');
		assert.deepStrictEqual(
			yaxunit.options.map((option) => option.key).sort(),
			['--additional', '--command', '--exitCodePath', '--no-wait', '--ordinaryapp']
		);
		const command = yaxunit.options.find((option) => option.key === '--command');
		assert.ok(command && command.description.length > 5, 'описание из каталога 2.x');
		assert.ok(
			sections.findIndex((section) => section.id === 'yaxunit') < sections.findIndex((section) => section.id === 'run'),
			'секция среди приоритетных'
		);
	});

	test('v3: секция vrunner.test.yaxunit с опцией yaxunit-config', () => {
		const { sections } = loadEditorSections(extensionPath, 'v3');
		const yaxunit = sections.find((section) => section.id === 'vrunner.test.yaxunit');
		assert.ok(yaxunit, 'должна быть секция vrunner.test.yaxunit');
		assert.ok(yaxunit.options.some((option) => option.key === 'yaxunit-config'));
	});
});
