import * as assert from 'node:assert';
import { composeAdoptedSvg, isAdopted } from '../../features/metadata/objectBelonging';

/** Пиктограмма с указанным холстом. */
function icon(viewBox: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${viewBox}">\n\t<path d="M6 42V6h36v36Z"/>\n</svg>\n`;
}

/** Числа атрибута значка. */
function attr(svg: string, name: string): number {
	const found = new RegExp(`${name}="([-\\d.]+)"`).exec(svg.slice(svg.indexOf('<circle')));
	assert.ok(found, `в значке нет ${name}`);
	return Number(found[1]);
}

suite('Принадлежность объекта расширения', () => {
	test('признак заимствования не зависит от написания', () => {
		// Операции md-sparrow отдают значение по-разному: дерево - как в XML, свойства - как в модели.
		assert.strictEqual(isAdopted('Adopted'), true);
		assert.strictEqual(isAdopted('ADOPTED'), true);
		assert.strictEqual(isAdopted('Own'), false);
		assert.strictEqual(isAdopted(undefined), false);
	});

	test('значок встаёт в правый верхний угол холста', () => {
		const marked = composeAdoptedSvg(icon('0 0 48 48'));

		assert.ok(marked.includes('>&#1040;<'), 'значка нет в разметке');
		assert.ok(attr(marked, 'cx') > 24 && attr(marked, 'cx') < 48, 'значок ушёл из правой половины');
		assert.ok(attr(marked, 'cy') > 0 && attr(marked, 'cy') < 24, 'значок ушёл из верхней половины');
		assert.ok(marked.indexOf('<circle') > marked.indexOf('<path'), 'значок должен лежать поверх пиктограммы');
	});

	test('значок считается по холсту, а не по одному размеру', () => {
		// Пиктограммы нарисованы в двух системах координат, и в обеих значок должен встать в угол.
		const marked = composeAdoptedSvg(icon('0 -960 960 960'));

		assert.ok(attr(marked, 'cx') > 480 && attr(marked, 'cx') < 960, 'значок ушёл из правой половины');
		assert.ok(attr(marked, 'cy') > -960 && attr(marked, 'cy') < -480, 'значок ушёл из верхней половины');
	});

	test('пиктограмма без разобранного холста остаётся как была', () => {
		const broken = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h4v4Z"/></svg>';

		assert.strictEqual(composeAdoptedSvg(broken), broken);
	});
});
