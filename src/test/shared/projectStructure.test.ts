import * as assert from 'node:assert';
import {
	ONESCRIPT_PROJECT_DIRECTORIES,
	PROJECT_STRUCTURE,
	projectStructureDirectories,
} from '../../shared/projectStructure';

function underDump(dir: string): boolean {
	return ['src', 'tests'].some((root) => dir === root || dir.startsWith(`${root}/`));
}

suite('структура проекта: каталоги по виду проекта', () => {
	test('1C:Конфигуратор получает весь шаблон', () => {
		assert.deepStrictEqual(projectStructureDirectories('designer'), PROJECT_STRUCTURE.map((item) => item.path));
	});

	test('1C:EDT получает шаблон без src и tests', () => {
		const edt = projectStructureDirectories('edt');
		assert.ok(edt.length > 0);
		assert.deepStrictEqual(edt.filter(underDump), []);
		assert.deepStrictEqual(edt, PROJECT_STRUCTURE.map((item) => item.path).filter((dir) => !underDump(dir)));
	});

	test('проект 1С без исходного кода и неизвестный вид получают только общие каталоги', () => {
		assert.deepStrictEqual(projectStructureDirectories('onec'), projectStructureDirectories('edt'));
		assert.deepStrictEqual(projectStructureDirectories(undefined), projectStructureDirectories('edt'));
	});

	test('OneScript получает каталоги пакета', () => {
		assert.deepStrictEqual(projectStructureDirectories('onescript'), ONESCRIPT_PROJECT_DIRECTORIES);
	});
});
