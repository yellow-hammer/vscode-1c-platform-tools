import * as assert from 'node:assert';
import {
	normalizeTestName,
	frameworkRootId,
	fileItemId,
	caseItemId
} from '../../features/testing/testItemIds';

suite('testItemIds', () => {
	test('normalizeTestName схлопывает пробелы и триммирует', () => {
		assert.strictEqual(normalizeTestName('  Имя   теста\t'), 'Имя теста');
	});

	test('normalizeTestName приводит Unicode к NFC', () => {
		// «й» в NFD — это «и» + комбинируемая кратка; после нормализации формы совпадают
		const nfc = 'Тестовый'.normalize('NFC');
		const nfd = 'Тестовый'.normalize('NFD');
		assert.notStrictEqual(nfd, nfc, 'Исходные формы должны различаться');
		assert.strictEqual(normalizeTestName(nfd), normalizeTestName(nfc));
	});

	test('normalizeTestName сохраняет регистр', () => {
		assert.strictEqual(normalizeTestName('ТестДолжен_Проверить'), 'ТестДолжен_Проверить');
	});

	test('ID стабильны и различны по уровням', () => {
		const uri = 'file:///c%3A/project/features/test.feature';
		assert.strictEqual(frameworkRootId('vanessa'), 'framework:vanessa');
		assert.strictEqual(fileItemId('vanessa', uri), `vanessa|${uri}`);
		assert.strictEqual(caseItemId('vanessa', uri, ' Сценарий  один '), `vanessa|${uri}#Сценарий один`);
	});

	test('разные фреймворки дают разные ID для одного файла', () => {
		const uri = 'file:///c%3A/project/tests/test.os';
		assert.notStrictEqual(fileItemId('xunit', uri), fileItemId('onescript', uri));
	});
});
