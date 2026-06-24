import * as assert from 'node:assert';
import { buildCaseDescriptors } from '../../features/testing/caseResolver';
import { caseItemId } from '../../features/testing/testItemIds';
import { DiscoveredCase } from '../../features/testing/parsers/parserTypes';

const URI = 'file:///c%3A/project/features/test.feature';

suite('caseResolver.buildCaseDescriptors', () => {
	test('пустой список кейсов даёт пустой результат', () => {
		assert.deepStrictEqual(buildCaseDescriptors('vanessa', URI, []), []);
	});

	test('кейс отображается на ID/имя/строку с сортировкой по номеру строки', () => {
		const cases: DiscoveredCase[] = [{ name: 'Сценарий один', line: 12 }];
		const [descriptor] = buildCaseDescriptors('vanessa', URI, cases);

		assert.strictEqual(descriptor.id, caseItemId('vanessa', URI, 'Сценарий один'));
		assert.strictEqual(descriptor.name, 'Сценарий один');
		assert.strictEqual(descriptor.line, 12);
		// sortText — номер строки с нулями слева: кейсы идут по порядку в файле
		assert.strictEqual(descriptor.sortText, '000012');
		assert.strictEqual(descriptor.tags, undefined);
	});

	test('порядок следования по файлу сохраняется', () => {
		const cases: DiscoveredCase[] = [
			{ name: 'Б', line: 2 },
			{ name: 'А', line: 5 },
			{ name: 'В', line: 9 }
		];
		const descriptors = buildCaseDescriptors('onescript', URI, cases);
		assert.deepStrictEqual(
			descriptors.map((descriptor) => descriptor.name),
			['Б', 'А', 'В']
		);
	});

	test('теги Gherkin пробрасываются', () => {
		const cases: DiscoveredCase[] = [{ name: 'Дымовой', line: 3, tags: ['smoke', 'tree'] }];
		const [descriptor] = buildCaseDescriptors('vanessa', URI, cases);
		assert.deepStrictEqual(descriptor.tags, ['smoke', 'tree']);
	});

	test('одноимённые кейсы получают уникальные ID (дубль разводится строкой)', () => {
		const cases: DiscoveredCase[] = [
			{ name: 'Сценарий', line: 10 },
			{ name: 'Сценарий', line: 20 }
		];
		const descriptors = buildCaseDescriptors('vanessa', URI, cases);

		const baseId = caseItemId('vanessa', URI, 'Сценарий');
		assert.strictEqual(descriptors[0].id, baseId);
		assert.strictEqual(descriptors[1].id, `${baseId}@20`);
		assert.notStrictEqual(descriptors[0].id, descriptors[1].id);
		// Имена остаются одинаковыми — разводятся только ID
		assert.strictEqual(descriptors[0].name, descriptors[1].name);
	});

	test('ID учитывает фреймворк и URI', () => {
		const cases: DiscoveredCase[] = [{ name: 'Тест', line: 1 }];
		const vanessa = buildCaseDescriptors('vanessa', URI, cases)[0];
		const yaxunit = buildCaseDescriptors('yaxunit', URI, cases)[0];
		assert.notStrictEqual(vanessa.id, yaxunit.id);
	});
});
