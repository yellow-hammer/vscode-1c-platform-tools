import * as assert from 'node:assert';
import { TREE_GROUPS, groupCommandsFor, treeLabelFor } from '../../features/tools/treeStructure';

const group = (sectionType: string) => {
	const found = TREE_GROUPS.find((item) => item.sectionType === sectionType);
	assert.ok(found, `группа ${sectionType} пропала из дерева`);
	return found;
};

const commands = (sectionType: string, format: 'designer' | 'edt' | undefined) =>
	groupCommandsFor(group(sectionType), format).map((entry) => entry.command);

suite('дерево команд под формат исходников', () => {
	test('группа EDT стоит первой', () => {
		assert.strictEqual(TREE_GROUPS[0].sectionType, 'edt');
		assert.strictEqual(TREE_GROUPS[1].sectionType, 'infobase');
	});

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

	test('группа EDT показывает выгрузке только импорт, а проекту работу с проектом', () => {
		assert.deepStrictEqual(commands('edt', 'designer'), ['1c-platform-tools.edt.import']);
		const edt = commands('edt', 'edt');
		assert.ok(!edt.includes('1c-platform-tools.edt.import'));
		assert.ok(edt.includes('1c-platform-tools.edt.export') && edt.includes('1c-platform-tools.edt.projectInfo'));
		// Запуск и проверка живут в своих группах рядом с Предприятием и тестами
		assert.ok(!edt.includes('1c-platform-tools.edt.open') && !edt.includes('1c-platform-tools.edt.validate'));
	});

	test('запуск EDT стоит в группе запуска только у проекта EDT', () => {
		assert.ok(commands('run', 'edt').includes('1c-platform-tools.edt.open'));
		assert.ok(!commands('run', 'designer').includes('1c-platform-tools.edt.open'));
		assert.deepStrictEqual(commands('run', 'designer'), ['1c-platform-tools.run.enterprise', '1c-platform-tools.run.designer']);
	});

	test('проверка проекта EDT стоит среди тестов только у проекта EDT и не дублируется', () => {
		assert.ok(commands('test', 'edt').includes('1c-platform-tools.edt.validate'));
		assert.ok(!commands('test', 'designer').includes('1c-platform-tools.edt.validate'));
		assert.ok(!commands('test', undefined).includes('1c-platform-tools.test.validateEdt'));
	});

	test('подписи у проекта EDT говорят про проект, а не про src/cf', () => {
		const load = group('configuration').commands.find((entry) => entry.command === '1c-platform-tools.cf.load');
		assert.ok(load);
		assert.ok(treeLabelFor(load, 'designer').includes('src/cf'));
		assert.ok(treeLabelFor(load, 'edt').includes('проекта EDT'));
		assert.strictEqual(treeLabelFor(load, undefined), load.treeLabel);
		for (const entry of TREE_GROUPS.flatMap((item) => item.commands)) {
			if (entry.edtLabel) {
				assert.ok(!entry.edtLabel.includes('src/cf'), entry.command);
			}
		}
	});
});
