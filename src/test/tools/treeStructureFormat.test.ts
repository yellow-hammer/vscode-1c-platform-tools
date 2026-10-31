import * as assert from 'node:assert';
import {
	TREE_GROUPS,
	favoriteKey,
	favoriteVisibleFor,
	favoritesFromElsewhere,
	groupCommandsFor,
	groupVisibleFor,
	mergeFavorites,
	treeTraitsOf,
} from '../../features/tools/treeStructure';

const group = (sectionType: string) => {
	const found = TREE_GROUPS.find((item) => item.sectionType === sectionType);
	assert.ok(found, `группа ${sectionType} пропала из дерева`);
	return found;
};

const commands = (sectionType: string, format: 'designer' | 'edt' | undefined) =>
	groupCommandsFor(group(sectionType), format).map((entry) => entry.command);

suite('дерево команд под формат исходников', () => {
	test('у проекта EDT нет команд по файлам выгрузки', () => {
		const edt = commands('configuration', 'edt');
		assert.ok(!edt.includes('1c-platform-tools.cf.loadIncrement'));
		assert.ok(!edt.includes('1c-platform-tools.cf.loadByList'));
		assert.ok(!edt.includes('1c-platform-tools.cf.dumpIncrement'));
		assert.ok(edt.includes('1c-platform-tools.cf.load') && edt.includes('1c-platform-tools.cf.dump'));
		assert.ok(!commands('extension', 'edt').includes('1c-platform-tools.cfe.loadByList'));
		// У выгрузки конфигуратора состав полный
		assert.ok(commands('configuration', 'designer').includes('1c-platform-tools.cf.loadByList'));
		assert.deepStrictEqual(commands('configuration', undefined), group('configuration').commands.map((c) => c.command));
	});

	test('в группе EDT импорт доступен выгрузке, а команды проекта — проекту EDT', () => {
		const designer = commands('edt', 'designer');
		const edt = commands('edt', 'edt');
		assert.ok(designer.includes('1c-platform-tools.edt.import'));
		assert.ok(!edt.includes('1c-platform-tools.edt.import'));
		assert.ok(!designer.includes('1c-platform-tools.edt.export'));
		assert.ok(!designer.includes('1c-platform-tools.edt.projectInfo'));
		assert.ok(edt.includes('1c-platform-tools.edt.export') && edt.includes('1c-platform-tools.edt.projectInfo'));
		// Запуск и проверка живут в своих группах рядом с Предприятием и тестами
		assert.ok(!edt.includes('1c-platform-tools.run.edt') && !edt.includes('1c-platform-tools.edt.validate'));
	});

	test('запуск EDT стоит в группе запуска только у проекта EDT', () => {
		assert.ok(commands('run', 'edt').includes('1c-platform-tools.run.edt'));
		assert.ok(!commands('run', 'designer').includes('1c-platform-tools.run.edt'));
	});

	test('в дереве проверка проекта EDT — edt.validate, а не test.validateEdt', () => {
		const allTreeCommands = TREE_GROUPS.flatMap((item) => item.commands.map((entry) => entry.command));
		assert.ok(allTreeCommands.includes('1c-platform-tools.edt.validate'));
		assert.ok(
			!allTreeCommands.includes('1c-platform-tools.test.validateEdt'),
			'в дереве должна стоять edt.validate: test.validateEdt — отдельная проверка через vanessa-runner'
		);
		assert.ok(commands('test', 'edt').includes('1c-platform-tools.edt.validate'));
		assert.ok(!commands('test', 'designer').includes('1c-platform-tools.edt.validate'));
	});

	test('подписи команд одни на оба формата и не называют раскладку исходников', () => {
		// Команда, которая есть только у одного формата, вправе его называть: проверяются общие
		const entries = TREE_GROUPS.flatMap((item) => item.commands).filter((entry) => entry.formats === undefined);
		for (const entry of entries) {
			for (const layout of ['src/cf', 'src/cfe', 'tests/cfe', 'проект EDT', 'проекта EDT', 'проектов расширений']) {
				assert.ok(!entry.treeLabel.includes(layout), `${entry.command}: ${entry.treeLabel}`);
			}
		}
	});
});

suite('дерево команд под вид проекта', () => {
	const oneScript = treeTraitsOf('onescript', false);
	const visibleGroups = (traits: ReturnType<typeof treeTraitsOf>) =>
		TREE_GROUPS.filter((item) => item.sectionType !== 'helpAndSupport' && groupVisibleFor(item, traits)).map((item) => item.sectionType);

	test('у проекта OneScript зависимости, пакет, тесты и навыки, групп платформы нет', () => {
		assert.deepStrictEqual(visibleGroups(oneScript), ['dependency', 'package', 'test', 'skills']);
	});

	test('у проекта 1С группы платформы, пакет только у пакета OneScript', () => {
		const onec = visibleGroups(treeTraitsOf('designer', false));
		assert.ok(onec.includes('configuration') && onec.includes('infobase') && onec.includes('serviceFiles'));
		assert.ok(!onec.includes('package'));
		assert.ok(visibleGroups(treeTraitsOf('designer', true)).includes('package'), 'проект 1С, который ещё и библиотека OneScript');
	});

	test('пока вид не известен, дерево как у проекта 1С', () => {
		assert.deepStrictEqual(visibleGroups(treeTraitsOf(undefined, false)), visibleGroups(treeTraitsOf('onec', false)));
	});

	test('в группах проекта OneScript только его команды', () => {
		const commands = (sectionType: string) => groupCommandsFor(group(sectionType), undefined, oneScript).map((entry) => entry.command);
		assert.deepStrictEqual(commands('test'), [
			'1c-platform-tools.test.onescript',
			'1c-platform-tools.test.mutatos',
			'1c-platform-tools.test.allure',
		]);
		assert.ok(!commands('dependency').includes('1c-platform-tools.dependencies.initializeProjectStructure'));
		assert.ok(commands('dependency').includes('1c-platform-tools.dependencies.selectOscript'));
		assert.deepStrictEqual(commands('skills').sort(), [
			'1c-platform-tools.mcp.configureCursor',
			'1c-platform-tools.skills.add1cpt',
			'1c-platform-tools.skills.addOnescript',
		]);
		// Тесты OneScript у проекта 1С без пакета в дереве не нужны: их гоняет панель тестирования
		assert.ok(!groupCommandsFor(group('test'), undefined, treeTraitsOf('designer', false)).some((entry) => entry.command === '1c-platform-tools.test.onescript'));
	});

	test('избранное: команды платформы у проекта OneScript не видны, цепочки и задачи видны', () => {
		assert.strictEqual(favoriteVisibleFor('1c-platform-tools.cf.load', 'configuration', oneScript), false);
		assert.strictEqual(favoriteVisibleFor('1c-platform-tools.dependencies.install', 'dependency', oneScript), true);
		assert.strictEqual(favoriteVisibleFor('1c-platform-tools.epf.setVersionReport', 'setVersion', oneScript), false);
		assert.strictEqual(favoriteVisibleFor('1c-platform-tools.pipelines.run', 'pipelines', oneScript), true);
		assert.strictEqual(favoriteVisibleFor('1c-platform-tools.tasks.runOscript', 'oscriptTasks', oneScript), true);
	});

	test('избранное: сохранение не теряет то, чего окно не показывало', () => {
		const load = { command: '1c-platform-tools.cf.load', sectionType: 'configuration' };
		const install = { command: '1c-platform-tools.dependencies.install', sectionType: 'dependency' };
		const build = { command: '1c-platform-tools.package.build', sectionType: 'package' };
		const release = { command: '1c-platform-tools.pipelines.run', sectionType: 'pipelines', arguments: [{ pipeline: 'release' }] };
		const nightly = { command: '1c-platform-tools.pipelines.run', sectionType: 'pipelines', arguments: [{ pipeline: 'nightly' }] };

		// Окно у проекта OneScript построило install, build и цепочку release: отмечена только сборка
		const offered = new Set([install, build, release].map(favoriteKey));
		assert.deepStrictEqual(mergeFavorites([load, install, release, nightly], [build], offered), [load, nightly, build]);
		// Цепочку другого проекта дерево показывает, а окно из проекта не строит: её окно показывает отдельно
		assert.deepStrictEqual(favoritesFromElsewhere([load, install, release, nightly], offered, oneScript), [nightly]);
		// У проекта 1С без пакета команды сборки в окне нет: она не из другого проекта, а другого вида и остаётся
		assert.deepStrictEqual(favoritesFromElsewhere([build], new Set(), treeTraitsOf('designer', false)), []);
		assert.deepStrictEqual(mergeFavorites([build, install], [], new Set([favoriteKey(install)])), [build]);
	});

	test('избранное: окно без правок порядок не меняет, новые отмеченные идут в конец', () => {
		const install = { command: '1c-platform-tools.dependencies.install', sectionType: 'dependency' };
		const load = { command: '1c-platform-tools.cf.load', sectionType: 'configuration' };
		const docs = { command: '1c-platform-tools.help.openDocs', sectionType: 'help' };
		const build = { command: '1c-platform-tools.package.build', sectionType: 'package' };
		const current = [install, load, docs];
		const offered = new Set([install, docs, build].map(favoriteKey));

		// Окно у проекта OneScript отметило те же install и docs в своём порядке
		assert.deepStrictEqual(mergeFavorites(current, [docs, install], offered), current);
		assert.deepStrictEqual(mergeFavorites(current, [docs, build], offered), [load, docs, build]);
	});
});
