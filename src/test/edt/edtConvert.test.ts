import * as assert from 'node:assert';
import * as path from 'node:path';
import { designerExtensionBase } from '../../features/edt/edtConvert';

suite('конвертация расширения через 1C:EDT', () => {
	const converted = path.join('C:', 'проект', 'build', 'out', 'cf-edt');
	const existing = (files: string[]) => (file: string) => files.includes(file);

	test('базовым проектом служит конфигурация, конвертированная раньше', () => {
		const base = designerExtensionBase(
			converted,
			[path.join('C:', 'проект', 'ssl31')],
			existing([path.join(converted, '.project')])
		);

		assert.strictEqual(base, converted);
	});

	test('без конвертированной конфигурации берётся единственная конфигурация EDT', () => {
		const configuration = path.join('C:', 'проект', 'ssl31');

		assert.strictEqual(designerExtensionBase(converted, [configuration], existing([])), configuration);
	});

	test('базового проекта нет, когда выбирать не из чего или не из одного', () => {
		assert.strictEqual(designerExtensionBase(converted, [], existing([])), undefined);
		assert.strictEqual(
			designerExtensionBase(converted, [path.join('C:', 'a'), path.join('C:', 'b')], existing([])),
			undefined
		);
	});
});
