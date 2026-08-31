import * as assert from 'node:assert';
import { composeAdoptedSvg, composeBadgeSvg, isAdopted } from '../../features/metadata/objectBelonging';

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

/** Число атрибута у первого элемента указанного вида. */
function shapeAttr(svg: string, shape: string, name: string): number {
	const at = svg.indexOf(`<${shape}`);
	assert.ok(at >= 0, `в разметке нет ${shape}`);
	const found = new RegExp(`${name}="([-\\d.]+)"`).exec(svg.slice(at));
	assert.ok(found, `у ${shape} нет ${name}`);
	return Number(found[1]);
}

suite('Значки поддержки на пиктограмме', () => {
	test('признак поддержки стоит слева снизу, запрет - справа сверху', () => {
		const marked = composeBadgeSvg(icon('0 0 48 48'), ['support', 'locked'], 'dark');

		// Квадрат поддержки: левая нижняя четверть холста
		assert.ok(shapeAttr(marked, 'rect', 'x') < 24, 'квадрат ушёл из левой половины');
		assert.ok(shapeAttr(marked, 'rect', 'y') > 24, 'квадрат ушёл из нижней половины');
		// Замок: правая верхняя четверть, корпус прямоугольником после дужки
		assert.ok(marked.includes('<path d="M '), 'дужки замка нет');
		const lockBody = marked.slice(marked.indexOf('<path d="M '));
		assert.ok(shapeAttr(lockBody, 'rect', 'x') > 24, 'замок ушёл из правой половины');
	});

	test('на поддержке с разрешённым изменением стоит только квадрат', () => {
		const marked = composeBadgeSvg(icon('0 0 48 48'), ['support'], 'dark');

		assert.ok(marked.includes('<rect'), 'квадрата поддержки нет');
		assert.ok(!marked.includes('<path d="M '), 'замок не нужен, изменение разрешено');
	});

	test('цвета разведены: замок янтарный, поддержка бледная жёлтая', () => {
		const marked = composeBadgeSvg(icon('0 0 48 48'), ['support', 'locked'], 'dark');

		assert.ok(marked.includes('#D8C68A'), 'квадрат поддержки не бледно-жёлтый');
		assert.ok(marked.includes('#E8952D'), 'замок не янтарный');
	});

	test('под замком подложка цвета панели, своя на каждую тему', () => {
		// Пиктограммы монохромные: без подложки значок садится на заливку того же тона
		const dark = composeBadgeSvg(icon('0 0 48 48'), ['locked'], 'dark');
		const light = composeBadgeSvg(icon('0 0 48 48'), ['locked'], 'light');

		assert.ok(dark.includes('#252526'), 'в тёмной теме нет подложки');
		assert.ok(light.includes('#F3F3F3'), 'в светлой теме нет подложки');
		assert.ok(dark.indexOf('<circle') < dark.indexOf('<path d="M '), 'подложка должна лежать под замком');
	});

	test('значки считаются по холсту, а не по одному размеру', () => {
		const marked = composeBadgeSvg(icon('0 -960 960 960'), ['support'], 'light');

		assert.ok(shapeAttr(marked, 'rect', 'x') < 480, 'квадрат ушёл из левой половины');
		assert.ok(shapeAttr(marked, 'rect', 'y') > -480, 'квадрат ушёл из нижней половины');
	});
});
