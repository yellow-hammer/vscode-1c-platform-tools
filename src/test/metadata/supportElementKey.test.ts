import * as assert from 'node:assert';
import { childSupportElementKey } from '../../features/metadata/metadataChildMutations';
import { childNodeSupport } from '../../features/metadata/metadataTreeView';

suite('Ключ правила поддержки узла состава', () => {
	test('ключ собирается из общей части операций вида', () => {
		assert.strictEqual(childSupportElementKey('attribute', 'Владелец'), 'element:cf-md-attribute:Владелец');
		assert.strictEqual(childSupportElementKey('dimension', 'Период'), 'element:cf-md-dimension:Период');
		assert.strictEqual(childSupportElementKey('value', 'Первый'), 'element:cf-md-enum-value:Первый');
		assert.strictEqual(childSupportElementKey('command', 'Печать'), 'element:cf-md-command:Печать');
	});

	test('реквизит табличной части адресуется через её имя', () => {
		assert.strictEqual(
			childSupportElementKey('tabularAttribute', 'Номенклатура', 'Товары'),
			'element:cf-md-tabular-attribute:Товары/Номенклатура'
		);
		// Табличная часть у имени не спрашивает владельца
		assert.strictEqual(childSupportElementKey('tabularSection', 'Товары', 'Товары'), 'element:cf-md-tabular-section:Товары');
	});

	test('у формы и макета правило живёт в своём файле, ключа элемента нет', () => {
		assert.strictEqual(childSupportElementKey('form', 'ФормаЭлемента'), undefined);
		assert.strictEqual(childSupportElementKey('template', 'Печать'), undefined);
	});
});

suite('Действующее правило узла состава', () => {
	test('у формы и макета своё правило важнее правила объекта', () => {
		assert.strictEqual(childNodeSupport('locked', 'editable', true), 'editable');
		assert.strictEqual(childNodeSupport('editable', 'locked', true), 'locked');
	});

	test('элемент закрыт вместе с объектом: правка пишет в его файл', () => {
		assert.strictEqual(childNodeSupport('locked', 'editable', false), 'locked');
		assert.strictEqual(childNodeSupport('editable', 'locked', false), 'locked');
		assert.strictEqual(childNodeSupport('editable', 'editable', false), 'editable');
	});

	test('без своего правила узел берёт правило объекта', () => {
		assert.strictEqual(childNodeSupport('locked', undefined, false), 'locked');
		assert.strictEqual(childNodeSupport(undefined, undefined, true), undefined);
	});
});
