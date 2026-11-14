/**
 * Стек диалогов редактора СКД: чистые функции dcs-editor-dialogs.js и его подключение.
 *
 * Модуль исполняется в песочнице node:vm, как подсветка: DOM ему не нужен, поэтому тесты
 * проверяют ровно те решения (активный уровень, Escape, Tab, возврат фокуса), что работают
 * в webview. Подключение к разметке и панели проверяется здесь же: забытый <script> молча
 * ломает все окна редактора.
 * Запуск: npm run compile && node --test out/test/metadata/dcsDialogs.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { DCS_EDITOR_PARTS, readEditorPart, readEditorScript } from '../fixtures/helpers/dcsEditorScript';

interface DialogButton {
	id: string;
	label: string;
	primary: boolean;
	disabled: boolean;
	unavailable: boolean;
	onClick: ((level: unknown) => unknown) | null;
}

interface DialogSpec {
	title: string;
	width: string;
	buttons: DialogButton[];
	build: unknown;
	onCancel: unknown;
	onClose: unknown;
	returnFocus: unknown;
}

interface DialogStack<T> {
	depth(): number;
	top(): T | null;
	at(index: number): T | null;
	indexOf(level: T): number;
	push(level: T): number;
	truncate(index: number): T[];
}

interface FocusDecision {
	kind: 'element' | 'top' | 'keep';
	element?: unknown;
}

interface DialogsApi {
	MAX_DEPTH: number;
	POPUP_Z_INDEX: number;
	WIDTHS: string[];
	normalizeButtons(buttons: unknown): DialogButton[];
	normalizeSpec(spec: unknown): DialogSpec;
	canPush(depth: number): boolean;
	createStack<T>(): DialogStack<T>;
	zIndexOf(level: number): number;
	levelStates(depth: number): { pageInert: boolean; levels: { active: boolean; inert: boolean; zIndex: number }[] };
	escapeAction(depth: number, popupOpen: boolean): string;
	tabTarget(count: number, current: number, backward: boolean): { prevent: boolean; index: number };
	focusAfterClose(
		closed: { returnFocus: unknown }[],
		focusLeft: boolean,
		usable: (element: unknown) => boolean,
		remainingDepth: number
	): FocusDecision;
	cancelAllowed(result: unknown): boolean;
	clickError(result: unknown): string;
	titleParts(title: unknown, modified: unknown): { text: string; mark: string; spoken: string };
}

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');
const FILE = path.join(WEBVIEW, 'dcs-editor-dialogs.js');

/**
 * Исполняет файл webview в текущем realm и возвращает его module.exports.
 * Обёртка-функция вместо нового контекста vm: объекты чужого realm не проходят
 * deepStrictEqual; параметр window не даёт модулю писать DcsDialogs в глобалы теста.
 */
function loadDialogs(): { api: DialogsApi; windowShim: Record<string, unknown> } {
	const code = fs.readFileSync(FILE, 'utf8');
	const factory = vm.runInThisContext(`(function (module, window) {\n${code}\n})`, { filename: FILE }) as (
		moduleShim: { exports: unknown },
		windowShim: Record<string, unknown>
	) => void;
	const moduleShim: { exports: unknown } = { exports: {} };
	const windowShim: Record<string, unknown> = {};
	factory(moduleShim, windowShim);
	return { api: moduleShim.exports as DialogsApi, windowShim };
}

const { api, windowShim } = loadDialogs();

function noop(): undefined {
	return undefined;
}

describe('Стек диалогов СКД: описание уровня', () => {
	test('модуль отдаёт API и в module.exports, и в window.DcsDialogs', () => {
		assert.equal(windowShim.DcsDialogs, api);
		assert.deepEqual(api.WIDTHS, ['normal', 'wide', 'full']);
	});

	test('умолчания: ширина normal, одна кнопка «Закрыть» без обработчика', () => {
		const spec = api.normalizeSpec({ title: 'Окно' });
		assert.equal(spec.title, 'Окно');
		assert.equal(spec.width, 'normal');
		assert.deepEqual(spec.buttons, [{ id: 'close', label: 'Закрыть', primary: false, disabled: false, unavailable: false, onClick: null }]);
		assert.equal(spec.build, null);
		assert.equal(spec.onCancel, null);
		assert.equal(spec.onClose, null);
		assert.equal(spec.returnFocus, null);
	});

	test('ширины wide и full принимаются, неизвестная — отказ по-русски', () => {
		assert.equal(api.normalizeSpec({ width: 'wide' }).width, 'wide');
		assert.equal(api.normalizeSpec({ width: 'full' }).width, 'full');
		assert.equal(api.normalizeSpec({ width: '' }).width, 'normal');
		assert.throws(() => api.normalizeSpec({ width: 'huge' }), /неизвестная ширина «huge»/);
		assert.throws(() => api.normalizeSpec(null), /нет описания уровня/);
	});

	test('кнопки: порядок и обработчики сохраняются, primary и disabled — булевы', () => {
		const next = (): string => 'ошибка';
		const buttons = api.normalizeButtons([
			{ id: 'back', label: '< Назад', disabled: 1 },
			{ id: 'next', label: 'Далее >', primary: 'yes', onClick: next },
			{ id: 'cancel', label: 'Отмена' },
		]);
		assert.deepEqual(
			buttons.map((button) => [button.id, button.label, button.primary, button.disabled]),
			[
				['back', '< Назад', false, true],
				['next', 'Далее >', true, false],
				['cancel', 'Отмена', false, false],
			]
		);
		assert.equal(buttons[1].onClick, next);
		assert.equal(buttons[2].onClick, null, 'кнопка без обработчика — отмена уровня');
	});

	test('недоступная, но фокусируемая кнопка (unavailable) — отдельный от disabled признак', () => {
		// «Далее >» на последней вкладке конструктора запроса: гаснет, но не выпадает из обхода Tab
		const buttons = api.normalizeButtons([
			{ id: 'back', label: '< Назад', unavailable: true },
			{ id: 'next', label: 'Далее >', unavailable: 0 },
			{ id: 'old', label: 'Как раньше', disabled: true },
		]);
		assert.deepEqual(
			buttons.map((button) => [button.id, button.disabled, button.unavailable]),
			[
				['back', false, true],
				['next', false, false],
				['old', true, false],
			]
		);
	});

	test('пустой список кнопок разрешён: уровень без подвала', () => {
		assert.deepEqual(api.normalizeSpec({ buttons: [] }).buttons, []);
	});

	test('ошибки описания кнопок — исключения с понятным текстом', () => {
		assert.throws(() => api.normalizeButtons('ok'), /списком/);
		assert.throws(() => api.normalizeButtons([{ label: 'ОК' }]), /у кнопки 1 нет id/);
		assert.throws(() => api.normalizeButtons([{ id: 'ok', label: 'ОК' }, { id: 'ok', label: 'Ещё' }]), /«ok» повторяется/);
		assert.throws(() => api.normalizeButtons([{ id: 'ok' }]), /у кнопки «ok» нет подписи/);
		assert.throws(() => api.normalizeButtons([{ id: 'ok', label: 'ОК', onClick: 'go' }]), /должен быть функцией/);
		assert.throws(
			() =>
				api.normalizeButtons([
					{ id: 'a', label: 'А', primary: true },
					{ id: 'b', label: 'Б', primary: true },
				]),
			/основная кнопка может быть только одна/
		);
	});

	test('обработчики уровня проверяются и передаются как есть', () => {
		const build = (): void => undefined;
		const spec = api.normalizeSpec({ build, onCancel: noop, onClose: noop, returnFocus: 'кнопка' });
		assert.equal(spec.build, build);
		assert.equal(spec.onCancel, noop);
		assert.equal(spec.onClose, noop);
		assert.equal(spec.returnFocus, 'кнопка');
		assert.throws(() => api.normalizeSpec({ onCancel: true }), /onCancel должен быть функцией/);
		assert.throws(() => api.normalizeSpec({ build: {} }), /build должен быть функцией/);
	});
});

describe('Стек диалогов СКД: порядок уровней', () => {
	test('push/top/indexOf/at: верхний — последний открытый', () => {
		const stack = api.createStack<string>();
		assert.equal(stack.depth(), 0);
		assert.equal(stack.top(), null);
		assert.equal(stack.push('поле'), 1);
		assert.equal(stack.push('тип'), 2);
		assert.equal(stack.top(), 'тип');
		assert.equal(stack.at(0), 'поле');
		assert.equal(stack.at(5), null);
		assert.equal(stack.indexOf('поле'), 0);
		assert.equal(stack.indexOf('нет'), -1);
	});

	test('truncate закрывает уровень и всё над ним и отдаёт их сверху вниз', () => {
		const stack = api.createStack<string>();
		for (const name of ['конструктор', 'параметры ВТ', 'выражение']) {
			stack.push(name);
		}
		assert.deepEqual(stack.truncate(1), ['выражение', 'параметры ВТ']);
		assert.equal(stack.depth(), 1);
		assert.equal(stack.top(), 'конструктор');
		assert.deepEqual(stack.truncate(3), [], 'индекс за краем — ничего не закрывается');
		assert.deepEqual(stack.truncate(-1), []);
	});

	test('глубина ограничена MAX_DEPTH: зацикленное открытие не растит стек', () => {
		const stack = api.createStack<number>();
		for (let index = 0; index < api.MAX_DEPTH; index += 1) {
			stack.push(index);
		}
		assert.equal(api.canPush(api.MAX_DEPTH - 1), true);
		assert.equal(api.canPush(api.MAX_DEPTH), false);
		assert.throws(() => stack.push(99), /слишком много окон/);
		assert.equal(stack.depth(), api.MAX_DEPTH);
	});

	test('активен только верхний уровень, нижние и страница неактивны, слои растут', () => {
		assert.deepEqual(api.levelStates(0), { pageInert: false, levels: [] });
		const states = api.levelStates(3);
		assert.equal(states.pageInert, true);
		assert.deepEqual(
			states.levels.map((state) => [state.active, state.inert]),
			[
				[false, true],
				[false, true],
				[true, false],
			]
		);
		const layers = states.levels.map((state) => state.zIndex);
		assert.equal(layers[0], 20, 'уровень 1 — на слое мини-диалога (.dcs-dialog-backdrop)');
		assert.ok(layers[0] < layers[1] && layers[1] < layers[2], layers.join(' < '));
		assert.equal(api.zIndexOf(1), 20);
	});

	test('список подсказки выше самого глубокого уровня', () => {
		assert.ok(api.POPUP_Z_INDEX > api.zIndexOf(api.MAX_DEPTH));
	});
});

describe('Стек диалогов СКД: клавиши', () => {
	test('Escape: открытый список подсказки закрывается раньше окна', () => {
		assert.equal(api.escapeAction(2, true), 'popup');
		assert.equal(api.escapeAction(0, true), 'popup', 'список на странице без окон');
		assert.equal(api.escapeAction(2, false), 'level');
		assert.equal(api.escapeAction(1, false), 'level');
		assert.equal(api.escapeAction(0, false), 'none');
	});

	test('Tab внутри уровня — обход браузера, на краях заворачивается', () => {
		assert.deepEqual(api.tabTarget(3, 0, false), { prevent: false, index: 0 });
		assert.deepEqual(api.tabTarget(3, 1, true), { prevent: false, index: 1 });
		assert.deepEqual(api.tabTarget(3, 2, false), { prevent: true, index: 0 });
		assert.deepEqual(api.tabTarget(3, 0, true), { prevent: true, index: 2 });
	});

	test('фокус вне уровня Tab возвращает в окно: вперёд — первый, назад — последний', () => {
		assert.deepEqual(api.tabTarget(4, -1, false), { prevent: true, index: 0 });
		assert.deepEqual(api.tabTarget(4, -1, true), { prevent: true, index: 3 });
		assert.deepEqual(api.tabTarget(4, 7, false), { prevent: true, index: 0 });
	});

	test('в уровне без фокусируемых элементов Tab держится на самом окне', () => {
		assert.deepEqual(api.tabTarget(0, -1, false), { prevent: true, index: -1 });
		assert.deepEqual(api.tabTarget(0, -1, true), { prevent: true, index: -1 });
	});
});

describe('Стек диалогов СКД: возврат фокуса', () => {
	const alive = (): boolean => true;
	const dead = (): boolean => false;

	test('фокус возвращается на элемент, открывший закрытый уровень', () => {
		const decision = api.focusAfterClose([{ returnFocus: 'кнопка «Тип…»' }], true, alive, 1);
		assert.deepEqual(decision, { kind: 'element', element: 'кнопка «Тип…»' });
	});

	test('закрыто несколько уровней — берётся вызвавший элемент нижнего из них', () => {
		// Сверху вниз: элемент верхнего жил в окне, которое тоже закрылось
		const closed = [{ returnFocus: 'поле окна 2' }, { returnFocus: 'кнопка на странице' }];
		const usable = (element: unknown): boolean => element === 'кнопка на странице';
		assert.deepEqual(api.focusAfterClose(closed, true, usable, 0), { kind: 'element', element: 'кнопка на странице' });
	});

	test('вызвавшего элемента нет — фокус в оставшееся верхнее окно, без окон — не трогается', () => {
		assert.deepEqual(api.focusAfterClose([{ returnFocus: 'удалённая строка' }], true, dead, 1), { kind: 'top' });
		assert.deepEqual(api.focusAfterClose([{ returnFocus: null }], true, alive, 2), { kind: 'top' });
		assert.deepEqual(api.focusAfterClose([{ returnFocus: 'удалённая строка' }], true, dead, 0), { kind: 'keep' });
	});

	test('обработчик сам увёл фокус наружу — стек его не перебивает', () => {
		// Конструктор вставил текст и поставил фокус в редактор запроса
		assert.deepEqual(api.focusAfterClose([{ returnFocus: 'кнопка «Конструктор…»' }], false, alive, 0), { kind: 'keep' });
		assert.deepEqual(api.focusAfterClose([], true, alive, 0), { kind: 'keep' });
	});
});

describe('Стек диалогов СКД: итог кнопок', () => {
	test('onCancel, вернувший false, удерживает окно; прочие ответы — нет', () => {
		assert.equal(api.cancelAllowed(false), false);
		for (const result of [undefined, true, '', 0, null]) {
			assert.equal(api.cancelAllowed(result), true, String(result));
		}
	});

	test('строка из onClick — ошибка уровня, иначе строка ошибки очищается', () => {
		assert.equal(api.clickError('Укажите поле.'), 'Укажите поле.');
		assert.equal(api.clickError(undefined), '');
		assert.equal(api.clickError(true), '');
	});
});

describe('Стек диалогов СКД: заголовок изменённого окна', () => {
	test('без правок — заголовок как есть, с правками — знак «*» и слова для читалки', () => {
		assert.deepEqual(api.titleParts('Конструктор запроса', false), { text: 'Конструктор запроса', mark: '', spoken: '' });
		assert.deepEqual(api.titleParts('Конструктор запроса', true), { text: 'Конструктор запроса', mark: '*', spoken: 'есть изменения' });
	});

	test('нестроковый заголовок — пустой текст, признак правки — по истинности', () => {
		assert.deepEqual(api.titleParts(undefined, 1), { text: '', mark: '*', spoken: 'есть изменения' });
		assert.deepEqual(api.titleParts(null, ''), { text: '', mark: '', spoken: '' });
	});
});

describe('Стек диалогов СКД: подключение к webview', () => {
	function read(name: string): string {
		return fs.readFileSync(path.join(WEBVIEW, name), 'utf8');
	}

	test('модуль подключён до основного скрипта: dcs-editor.js берёт window.DcsDialogs при старте', () => {
		const html = read('dcs-editor.html');
		const at = html.indexOf('{{DIALOGS_JS_URI}}');
		assert.ok(at >= 0, 'в шаблоне нет {{DIALOGS_JS_URI}}');
		assert.ok(at < html.indexOf('{{JS_URI}}'), 'модуль диалогов подключён позже скрипта');
		assert.ok(readEditorScript().includes('window.DcsDialogs'), 'скрипт не берёт модуль диалогов');
	});

	test('панель подставляет адрес модуля в шаблон', () => {
		const panel = fs.readFileSync(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'), 'utf8');
		assert.ok(panel.includes("'dcs-editor-dialogs.js'"), 'панель не знает файл модуля');
		assert.ok(panel.includes("replaceAll('{{DIALOGS_JS_URI}}'"), 'панель не подставляет {{DIALOGS_JS_URI}}');
	});

	test('уровень 1 — разметка с ролью диалога и id, по которым скрипт находит части окна', () => {
		const html = read('dcs-editor.html');
		const box = /<div class="dcs-dialog" id="dialogBox"([^>]*)>/.exec(html);
		assert.ok(box, 'нет окна уровня 1');
		for (const attr of ['role="dialog"', 'aria-modal="true"', 'aria-labelledby="dialogTitle"']) {
			assert.ok(box[1].includes(attr), `у окна уровня 1 нет ${attr}`);
		}
		for (const id of ['page', 'dialogBackdrop', 'dialogTitle', 'dialogBody', 'dialogError', 'dialogActions', 'dialogOk', 'dialogCancel']) {
			assert.ok(html.includes(`id="${id}"`), `в разметке нет id="${id}"`);
		}
	});

	test('окна открываются openDialog/openWideDialog/pushDialog и закрываются closeDialog', () => {
		const script = readEditorScript();
		for (const signature of [
			'function openDialog(title, okLabel, build, onSubmit)',
			'function openWideDialog(title, okLabel, build, onSubmit)',
			'function closeDialog()',
			'function pushDialog(spec)',
		]) {
			assert.ok(script.includes(signature), `в скрипте нет ${signature}`);
		}
	});

	test('вложенные уровни собираются с ролью диалога и стилями из dcs-editor.css', () => {
		const script = readEditorScript();
		const shell = script.slice(script.indexOf('function createDialogShell'));
		const body = shell.slice(0, shell.indexOf('\n\t}\n'));
		for (const part of ["'role', 'dialog'", "'aria-modal', 'true'", "'aria-labelledby'"]) {
			assert.ok(body.includes(part), `вложенный уровень без ${part}`);
		}
		const css = read('dcs-editor.css');
		for (const name of ['dcs-dialog-nested', 'dcs-dialog-wide', 'dcs-dialog-full']) {
			assert.ok(css.includes(`.${name}`), `нет оформления .${name}`);
		}
	});

	/** Тело функции скрипта по её сигнатуре: до первой закрывающей скобки с отступом функции (indent табов). */
	function functionBody(script: string, signature: string, indent = 1): string {
		const at = script.indexOf(signature);
		assert.ok(at >= 0, `в скрипте нет ${signature}`);
		const rest = script.slice(at);
		return rest.slice(0, rest.indexOf('\n' + '\t'.repeat(indent) + '}\n'));
	}

	test('недоступная кнопка: подвал ставит aria-disabled, нажатие её не исполняет, вид — в стилях', () => {
		const script = readEditorScript();
		const render = functionBody(script, 'function renderDialogButtons(shell, buttons)');
		assert.ok(render.includes("setAttribute('aria-disabled', 'true')"), 'подвал не ставит aria-disabled');
		assert.ok(render.includes("removeAttribute('aria-disabled')"), 'подвал не снимает aria-disabled с доступной кнопки');
		const press = functionBody(script, 'function pressDialogButton(shell, id)');
		assert.ok(press.includes('button.unavailable'), 'нажатие недоступной кнопки исполняется');
		assert.ok(read('dcs-editor.css').includes("[aria-disabled='true']"), 'нет оформления недоступной кнопки');
	});

	test('заголовок уровня: setTitle с признаком правки пишет только свой уровень, знак скрыт от читалки', () => {
		const script = readEditorScript();
		const push = functionBody(script, 'function pushDialog(spec)');
		assert.ok(push.includes('setTitle: function (text, modified)'), 'setTitle без признака правки');
		assert.ok(/setTitle: function \(text, modified\) \{\s*\/\/[^\n]*\n\s*if \(shell\.level === level\)/.test(push), 'setTitle не сверяет уровень каркаса');
		const paint = functionBody(script, 'function paintDialogTitle(shell, parts)');
		assert.ok(paint.includes('dialogRules.titleParts') || push.includes('dialogRules.titleParts'), 'заголовок собирается не по titleParts');
		assert.ok(paint.includes("mark.setAttribute('aria-hidden', 'true')"), 'знак «*» слышен читалке');
		const css = read('dcs-editor.css');
		for (const name of ['dcs-dialog-modified', 'dcs-dialog-modified-spoken']) {
			assert.ok(css.includes(`.${name}`), `нет оформления .${name}`);
		}
	});

	test('конструктор запроса: подвал «Запрос… / < Назад / Далее > / ОК / Отмена», края — unavailable, «*» по правкам', () => {
		const dialog = read('dcs-editor-query-dialog.js');
		// footer и stepTab живут внутри openConstructor: их отступ — два таба
		const footer = functionBody(dialog, '\t\tfunction footer(place)', 2);
		const ids = [...footer.matchAll(/\{ id: '(\w+)', label: '([^']+)'/g)].map((m) => m[1] + ':' + m[2]);
		assert.deepEqual(ids, ['query:Запрос…', 'back:< Назад', 'next:Далее >', 'ok:ОК', 'cancel:Отмена']);
		assert.ok(footer.includes('unavailable: place.index <= 0'), '«< Назад» на первой вкладке доступна');
		assert.ok(footer.includes('unavailable: place.index < 0 || place.index >= place.tabs.length - 1'), '«Далее >» на последней вкладке доступна');
		assert.ok(functionBody(dialog, '\t\tfunction stepTab(delta)', 2).includes("state.focus = 'tab:' + to.id"), 'после перехода фокус не на ярлыке вкладки');
		assert.ok(dialog.includes('owner.setTitle(state.title, isModified(state))'), 'заголовок конструктора не отражает правки');
	});
});

describe('Части окон скрываются классом hidden', () => {
	// Общее .hidden (metadata-object.css) слабее правила класса с display: у такого элемента нужен свой .X.hidden.
	// Без него редактор значения показал бы под строкой и дату, и период, и цвет, какой бы ни был тип
	const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
		selectors: m[1].split(',').map((s) => s.trim()),
		body: m[2],
	}));
	const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	test('у каждого класса с display, который скрывается через hidden, есть правило .X.hidden', () => {
		const scripts = fs.readdirSync(WEBVIEW).filter((name) => /^dcs-editor.*\.js$/.test(name));
		const checked: string[] = [];
		const missing: string[] = [];
		for (const name of scripts) {
			const script = fs.readFileSync(path.join(WEBVIEW, name), 'utf8');
			for (const match of script.matchAll(/const (\w+) = el\('[a-z]+', '([\w -]+)'/g)) {
				const toggled = new RegExp(`(?<![\\w.])${escape(match[1])}\\.classList\\.(toggle|add)\\('hidden'`);
				if (!toggled.test(script)) {
					continue;
				}
				for (const cls of match[2].split(/\s+/)) {
					const own = rules.some((r) => r.selectors.includes(`.${cls}`) && /display:\s*(?!none)[a-z-]+/.test(r.body));
					if (!own) {
						continue;
					}
					checked.push(cls);
					const hidden = rules.some((r) => r.selectors.includes(`.${cls}.hidden`) && /display:\s*none/.test(r.body));
					if (!hidden) {
						missing.push(`${name}: .${cls}`);
					}
				}
			}
		}
		for (const cls of ['dcs-date-edit', 'dcs-period-edit', 'dcs-period-dates', 'dcs-color-edit', 'dcs-list-edit']) {
			assert.ok(checked.includes(cls), `проверка не увидела .${cls}`);
		}
		assert.deepEqual(missing, [], 'класс задаёт display и перебивает .hidden');
	});
});

describe('Конструктор запроса: подсказки, недоступные команды и окна параметров виртуальной таблицы', () => {
	const dialog = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor-query-dialog.js'), 'utf8');

	test('постоянные строки на вкладках и в окнах конструктора — только предупреждения и состояния', () => {
		// Смысл элементов — в их подсказках: строка struct-hint — состояние или предупреждение, а не пояснение
		const kept = [
			'строится впервые',
			'Имена сверены с описаниями',
			'QE.sourceLabel(',
			'Без связи с остальными',
			'бывает только у первой части объединения',
			'AUTOFILL_SELECT_WARNING',
			'Текст не раскладывается по вкладкам',
		];
		const lines = dialog.split('\n').filter((line) => line.includes("'struct-hint'"));
		for (const line of lines) {
			assert.ok(
				kept.some((part) => line.includes(part)),
				`новая постоянная подсказка: ${line.trim()}`
			);
		}
		assert.equal(lines.length, kept.length, 'число строк struct-hint');
		// «Компоновка данных» → «Поля»: предупреждение об автозаполнении — только когда блок {ВЫБРАТЬ} есть (у наборов БСП
		// автозаполнение включено почти всегда)
		assert.ok(dialog.includes('if (rows.length > 0 && ctx.state.dataSet && ctx.state.dataSet.autoFill) {'), 'плашка видна и без полей компоновки');
	});

	test('смысл флажков «Все», блокировки и поля имени ВТ — во всплывающей подсказке элемента', () => {
		const title = /const LINK_ALL_TITLE =\s*'([^']+)'/.exec(dialog);
		assert.ok(title, 'нет подсказки флажков «Все»');
		for (const kind of ['ПОЛНОЕ', 'ЛЕВОЕ', 'ПРАВОЕ', 'ВНУТРЕННЕЕ', 'общие у всех строк одного соединения']) {
			assert.ok(title[1].includes(kind), `подсказка «Все» не называет ${kind}`);
		}
		// У каждого флажка — полная подсказка мыши и своё короткое описание читалке: флажки повторяются в каждой строке
		assert.ok(
			dialog.includes('hint(allLeft, LINK_ALL_TITLE, LINK_ALL_LEFT_SPOKEN);') && dialog.includes('hint(allRight, LINK_ALL_TITLE, LINK_ALL_RIGHT_SPOKEN);'),
			'подсказка не у обоих флажков'
		);
		for (const [name, own] of [
			['LINK_ALL_LEFT_SPOKEN', 'ЛЕВОЕ'],
			['LINK_ALL_RIGHT_SPOKEN', 'ПРАВОЕ'],
		]) {
			const spoken = new RegExp('const ' + name + " = '([^']+)'").exec(dialog);
			assert.ok(spoken, 'нет описания ' + name);
			assert.ok(spoken[1].includes('ПОЛНОЕ') && spoken[1].includes(own) && spoken[1].length < title[1].length / 2, spoken[1]);
			assert.ok(!spoken[1].startsWith('Все записи'), 'описание повторяет имя флажка');
		}
		assert.ok(/box\.wrap\.title = 'Только просмотр:[^']+';\s*box\.input\.setAttribute\('aria-description', box\.wrap\.title\)/.test(dialog), 'у флажка блокировки нет причины');
		// Флажок недоступен и фокуса не получает: «только просмотр» видно в подписи
		assert.ok(dialog.includes("api.checkbox('Блокировать (только просмотр)', Boolean(forUpdate))"), 'подпись блокировки не говорит, что это просмотр');
		assert.ok(/if \(kind === 'create'\) \{\s*hint\(name, 'Новое имя переименует таблицу/.test(dialog), 'поле имени ВТ не объясняет переименование');
		// ДОБАВИТЬ и УНИЧТОЖИТЬ: какие таблицы есть до запроса — в подсказке поля (вкладки с веткой ВТ у уничтожения нет)
		assert.ok(
			/else if \(kind === 'add' \|\| kind === 'drop'\) \{[\s\S]{0,400}const known = Q\.tempTables\(state\.model, index\)[\s\S]{0,200}hint\(name, known\.length > 0 \? 'Таблицы пакета до этого запроса: ' \+ known\.join\(', '\) : 'До этого запроса временных таблиц нет'\)/.test(
				dialog
			),
			'поле имени ВТ у добавления и уничтожения не называет таблицы пакета'
		);
		assert.ok(/view\.title = 'Только просмотр:[^']+';\s*view\.setAttribute\('aria-description', view\.title\)/.test(dialog), 'блок характеристик не говорит, что только просмотр');
	});

	test('подсказки элементов слышит читалка: title и aria-description одним помощником', () => {
		const start = dialog.indexOf('\tfunction hint(node, text, spoken) {');
		assert.ok(start >= 0, 'нет помощника hint');
		const body = dialog.slice(start, dialog.indexOf('\n\t}\n', start));
		assert.ok(body.includes('node.title = text;') && body.includes("node.setAttribute('aria-description', spoken || text);"), body);
		// Подсказки элементов — через hint, а не одним title
		for (const text of [
			"hint(select, 'Добавление во временную таблицу (ДОБАВИТЬ) есть с версии 8.3.25",
			"'Поле, уже выбранное в другой колонке, поменяется с ним местами'",
			"hint(required, 'Снятый флажок берёт соединение в {…}",
			"hint(number, 'Соседние необязательные соединения одного уровня",
			"hint(block.input, 'Блок {…} схема применяет",
			"'ОБЪЕДИНИТЬ без ВСЕ перед этой частью",
		]) {
			assert.ok(dialog.includes(text), 'нет подсказки: ' + text);
		}
		for (const plain of ['select.title = ', 'number.title = \'Соседние', 'block.input.title = ', "required.title = 'Снятый"]) {
			assert.ok(!dialog.includes(plain), 'подсказка только в title: ' + plain);
		}
		// Список части может стоять в ячейке рядом со значком перетаскивания «⋮» — описание у самого списка
		assert.ok(/\n\t+hint\(select, 'Поле, уже выбранное в другой колонке, поменяется с ним местами'\);\n\t+if \(cell\.isNull\) \{\n\t+return select;/.test(dialog), 'список части на «Псевдонимах» без описания');
		// «Без дублей»: смысл — в подсказке самого флажка
		assert.ok(/: hint\(\s*gridCheck\(ctx, part\.noDuplicates, 'Без дублей: '[\s\S]{0,400}'ОБЪЕДИНИТЬ без ВСЕ перед этой частью/.test(dialog), 'флажок «Без дублей» без подсказки');
	});

	test('«Индекс»: ограничение версии ПО НАБОРАМ — один раз у сетки, а не у каждой строки', () => {
		const start = dialog.indexOf('\tfunction renderIndexTab(container, ctx) {');
		const body = dialog.slice(start, dialog.indexOf('\n\t}\n', start));
		assert.ok(!/title: indexes\.length > 1/.test(body), 'подсказка у каждой строки');
		assert.ok(body.includes('const indexGrid = gridView(listCol, {'), 'сетка индексов не сохранена');
		assert.ok(/if \(indexes\.length > 1\) \{\s*hint\(indexGrid, 'Несколько индексов пишутся как ИНДЕКСИРОВАТЬ ПО НАБОРАМ, с версии 8\.3\.25'\);/.test(body), 'нет подсказки у сетки');
	});

	test('ветка «Временные таблицы» дерева «База данных» — последняя: после «Задач», с «Упорядочить», с поиском и без выгрузки', () => {
		// databaseRows исполняется как есть: метаданные, описания таблиц и типы — заглушки api
		const cut = (signature: string): string => {
			const start = dialog.indexOf('\n\tfunction ' + signature);
			assert.ok(start >= 0, `нет function ${signature}`);
			return dialog.slice(start, dialog.indexOf('\n\t}\n', start) + 4);
		};
		const line = (name: string): string => {
			const start = dialog.indexOf('\n\tconst ' + name + ' = ');
			assert.ok(start >= 0, `нет const ${name}`);
			return dialog.slice(start, dialog.indexOf('\n', start + 1) + 1);
		};
		const code =
			line('COLLATOR') +
			line('TABLE_BADGES') +
			line('DB_PAGE') +
			['fold(value) {', 'upper(value) {', 'objectKindOf(item) {', 'objectQueryName(kind, item, lang) {', 'mainTableName(item, lang) {', 'databaseRows(ctx) {']
				.map(cut)
				.join('') +
			'\nreturn databaseRows;';
		let metadata = true;
		const groups = [
			{ label: 'Справочники', objectType: 'Catalog', items: [{ name: 'Валюты', relativePath: 'Catalogs/Валюты', objectType: 'Catalog' }] },
			{ label: 'Задачи', objectType: 'Task', items: [{ name: 'ЗадачаИсполнителя', relativePath: 'Tasks/ЗадачаИсполнителя', objectType: 'Task' }] },
			{ label: 'Документы', objectType: 'Document', items: [{ name: 'Заказ', relativePath: 'Documents/Заказ', objectType: 'Document' }] },
		];
		const api = {
			metadata: { available: () => metadata, state: () => ({ groups }) },
			expandable: () => false,
			typeChildren: () => [],
			describeTable: () => null,
			queryTables: () => ({ state: 'loading' }),
		};
		const FT = {
			OBJECT_KINDS: [
				{ en: 'Catalog', ru: 'Справочник' },
				{ en: 'Document', ru: 'Документ' },
				{ en: 'Task', ru: 'Задача' },
			],
		};
		const databaseRows = new Function('api', 'FT', 'QE', 'unreadConstant', 'constantsTableName', 'tempColumnType', code)(api, FT, {}, () => null, () => 'Константы', () => null) as (ctx: unknown) => {
			rows: Array<{ level: number; label: string }>;
		};
		const top = (state: Record<string, unknown>): string[] =>
			databaseRows({
				state: { db: Object.assign({ search: '', sorted: false, expanded: new Set(), collapsed: new Set(), limits: new Map() }, state) },
				lang: 'ru',
				tempTables: () => [{ name: 'ВТ_Заказы', statement: 0, fields: ['Заказ'] }],
			})
				.rows.filter((row) => row.level === 0)
				.map((row) => row.label);
		assert.deepEqual(top({}), ['Справочники', 'Задачи', 'Документы', 'Временные таблицы'], 'ветка ВТ не последняя');
		assert.deepEqual(top({ sorted: true }), ['Справочники', 'Задачи', 'Документы', 'Временные таблицы'], '«Упорядочить» поставил ВТ выше');
		assert.deepEqual(top({ search: 'за' }), ['Задачи', 'Документы', 'Временные таблицы'], 'поиск поставил ВТ выше');
		metadata = false;
		assert.deepEqual(top({}), ['Временные таблицы'], 'без выгрузки ветка ВТ пропала');
	});

	test('«Параметры виртуальной таблицы…»: недоступна без параметров (aria-disabled, причина в подсказке), нажатие называет, где параметры', () => {
		const start = dialog.indexOf('\tfunction paramsButton(ctx) {');
		assert.ok(start >= 0, 'нет paramsButton');
		const body = dialog.slice(start, dialog.indexOf('\n\t}\n', start));
		// Пиктограмма: ключ фокуса и доступное имя — постоянное название, причина — второй строкой подсказки
		assert.ok(dialog.includes("const PARAMS_TITLE = 'Параметры виртуальной таблицы…';"), 'название кнопки');
		assert.ok(body.includes("iconButton('table-params', PARAMS_TITLE, () => paramsOfSelected(ctx), ctx.keys, unavailable)"), 'ключ фокуса зависит от причины');
		assert.ok(
			/unavailable: true, note: info\.state === 'loading' \? '[^']+' : info\.note, spoken: info\.spoken/.test(body),
			'недоступность, причина в подсказке и короткая причина читалке'
		);
		assert.ok(!body.includes('disabled'), 'disabled снял бы кнопку с обхода Tab');
		assert.ok(
			dialog.includes('return QE.virtualParamsState(source, alias, describedSource(source), { metadata: api.metadata.available() });'),
			'правило не знает, есть ли выгрузка'
		);
		// Строки «Таблиц» — до панели: иначе кнопка судила бы по прошлой отрисовке
		const render = dialog.slice(dialog.indexOf('\tfunction renderTables(host, ctx) {'));
		assert.ok(render.indexOf('ctx.tablesInfo = built.info;') < render.indexOf('toolbar.appendChild(paramsButton(ctx));'), 'панель строится раньше строк');
		// Нажатие и окно «Компоновки данных» — по одному правилу с его сообщениями
		const press = dialog.slice(dialog.indexOf('\tfunction paramsOfSelected(ctx) {'));
		assert.ok(/if \(info\.state !== 'open'\) \{\s*ctx\.note\(info\.note\);/.test(press.slice(0, press.indexOf('\n\t}\n'))), 'нажатие молчит');
		const dcs = dialog.slice(dialog.indexOf('\tfunction openDcsParamsWindow(ctx, row) {'));
		assert.ok(dcs.slice(0, dcs.indexOf('\n\t}\n')).includes('paramsStateOf(source, row.alias)'), 'окно для СКД со своим сообщением');
		assert.ok(!/ctx\.note\('У таблицы «' \+ [\w.]+ \+ '» нет параметров\.'\)/.test(dialog), 'сообщение «нет параметров» не называет, где параметры');
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		assert.ok(css.includes(".dcs-qd-toolbar .ghost-btn[aria-disabled='true']"), 'нет вида недоступной кнопки панели');
		// Недоступная кнопка фокусируема: opacity гасила бы и рамку фокуса — приглушается текст
		for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
			if (m[1].includes("[aria-disabled='true']") && /btn/.test(m[1])) {
				assert.ok(!/opacity/.test(m[2]), 'opacity у фокусируемой недоступной кнопки: ' + m[1].trim());
			}
		}
		assert.match(css, /\.dcs-qd-toolbar \.ghost-btn\[aria-disabled='true'\]\s*\{[^}]*color:\s*var\(--vscode-disabledForeground\)/);
	});

	test('простое условие «Условий» видно целиком: список вида по своей ширине, поле и параметр рядом, перенос вместо прокрутки', () => {
		// Правила CSS без комментариев: селектор → тело
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const rule = (selector: string): string => {
			const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1].split(',').some((s) => s.trim() === selector));
			assert.ok(found, `нет правила ${selector}`);
			return found[2];
		};
		// .edit-input даёт списку width: 100%, и с flex: 0 0 auto он занял бы всю ячейку
		assert.match(rule('.dcs-qd-cell-simple > .dcs-qd-cell-op'), /width:\s*auto/);
		assert.match(rule('.dcs-qd-cond-simple'), /flex-wrap:\s*wrap/);
		assert.match(rule('.dcs-qd-cond-simple > .dcs-qd-cond-field'), /min-width:\s*\d/);
		assert.match(rule('.dcs-qd-cond-value'), /min-width:\s*\d/);
		// Три колонки — «№», «Произвольное» (по ширине заголовка) и «Условие» — и в простом, и в произвольном виде
		const columns = /grid-template-columns:\s*([^;]+);/.exec(rule('.dcs-qd-grid-conds .dcs-qd-grid-row'));
		assert.ok(columns, 'у сетки условий нет шаблона колонок');
		const tracks = columns[1].trim().split(/\s+(?![^(]*\))/);
		assert.equal(tracks.length, 3, columns[1]);
		assert.ok(Number.parseInt(tracks[1], 10) >= 90, `колонка «Произвольное» уже заголовка: ${tracks[1]}`);
		// Минимум «Условия» небольшой: простое условие переносится внутри ячейки, а не уводит сетку в прокрутку
		assert.ok(Number.parseInt(/minmax\((\d+)px/.exec(tracks[2])?.[1] ?? '999', 10) <= 160, `минимум колонки «Условие»: ${tracks[2]}`);
		assert.match(rule('.dcs-qd-cond-value'), /flex:\s*1 1 4em/);
		// На «Связях» колонка «Произвольное» той же ширины: заголовок не заезжает на «Условие связи»
		const links = /grid-template-columns:\s*([^;]+);/.exec(rule('.dcs-qd-grid-links .dcs-qd-grid-row'));
		assert.ok(links, 'у сетки связей нет шаблона колонок');
		const linkTracks = links[1].trim().split(/\s+(?![^(]*\))/);
		assert.equal(linkTracks.length, 7, links[1]);
		assert.equal(linkTracks[5], tracks[1], '«Произвольное» на «Связях» и «Условиях» разной ширины');
		assert.ok(dialog.includes("columns: ['№', 'Произвольное', 'Условие'],"), 'заголовок сетки условий');
		const start = dialog.indexOf('\tfunction conditionRowCells(ctx, row, index) {');
		const body = dialog.slice(start, dialog.indexOf('\n\t}\n', start));
		assert.ok(body.includes("el('div', 'dcs-qd-cell-simple dcs-qd-cond-simple')"), 'ячейка простого условия без своего класса');
		assert.ok(body.includes("el('span', 'dcs-qd-cell-text dcs-qd-cond-field', simple.field)") && body.includes('field.title = simple.field;'), 'поле условия не видно целиком в подсказке');
		// Поле — текст без фокуса: читалка слышит его описанием вида сравнения и параметра; id — свой на отрисовку
		assert.ok(body.includes("field.id = 'dcsQdCondField' + ++condFieldCount;"), 'у поля условия нет своего id');
		assert.ok(body.includes("kind.setAttribute('aria-describedby', field.id);") && body.includes("param.setAttribute('aria-describedby', field.id);"), 'вид и параметр не называют поле');
		// Порядок в ячейке — поле, вид сравнения, «&» с параметром: так же идёт обход Tab
		const order = ['dcs-qd-cond-field', "'Вид сравнения'", "'dcs-qd-cond-value'", "'Имя параметра'"].map((part) => body.indexOf(part));
		assert.ok(order.every((at, k) => at > 0 && (k === 0 || at > order[k - 1])), `порядок частей простого условия: ${order.join(', ')}`);
	});

	test('«Условие» виртуальной таблицы: поля — по правилу вида таблицы в обоих окнах, предупреждение не блокирует ОК', () => {
		const text = dialog.replace(/\r\n/g, '\n');
		const fn = (signature: string): string => {
			const start = text.indexOf(signature);
			assert.ok(start >= 0, 'нет ' + signature);
			return text.slice(start, text.indexOf('\n\t}\n', start));
		};
		// Окно «Таблиц и полей»: дерево окна выражения и подсказка условия — разрешённые поля, по виду объекта описания
		const params = fn('\tfunction openParamsWindow(ctx, source, params, current, table, objectKind) {');
		assert.ok(params.includes("const conditionFields = QE.vtConditionFields(objectKind || '', table).allowed;"), 'поля условия не по правилу');
		assert.ok(/nodes: conditionNodes\(\),\s*empty: vtConditionEmpty\(table\),\s*check: conditionWarning,/.test(params), 'окно условия без своих полей, пустого текста и предупреждения');
		assert.ok(params.includes('const nodesOf = isCondition ? conditionNodes : () => vtExpressionNodes(param, table);'), 'подсказка условия видит все поля таблицы');
		// У строки условия и условия на счёт одна кнопка — «…» окна выражения: вторая кнопка-многоточие подсказки рядом путала бы
		assert.ok(params.includes('more: !(isCondition || isAccount),'), 'у условия кнопка подсказки рядом с «…»');
		// Условие на счёт, как в конфигураторе: «…» — окно выражения, в дереве которого только своё поле счёта
		assert.ok(params.includes("const isAccount = input === 'account';"), 'вид позиции условия на счёт не узнаётся');
		assert.ok(
			/\} else if \(isAccount\) \{\s*row\.appendChild\(button\('…', accountConditionTitle\(param\) \+ ' в окне выражения', \(\) => openAccountWindow\(ctx, param, table, editor\.input\.value, applyText\)\)\);/.test(params),
			'у условия на счёт нет «…»'
		);
		const account = fn('\tfunction openAccountWindow(ctx, param, table, value, apply) {');
		assert.ok(account.includes('nodes: vtExpressionNodes(param, table),') && !account.includes('check:'), 'окно условия на счёт — не своё поле счёта или с предупреждением');
		// Окна условий ВТ — «Произвольное выражение», как у конфигуратора: что правится, читалка слышит в имени текста; в
		// дереве только поля (без ветки «Параметры»), функции — без агрегатных, группы свёрнуты
		assert.ok(text.includes("const VT_EXPRESSION_TITLE = 'Произвольное выражение';"), 'заголовок окон условий ВТ — не как у конфигуратора');
		assert.ok(
			/title: VT_EXPRESSION_TITLE,\s*hint: accountConditionTitle\(param\),[\s\S]*paramsBranch: false,\s*functions: vtConditionFunctionNodes\(ctx\.lang\),\s*functionsOpen: \[\],/.test(account),
			'окно условия на счёт — со своим заголовком, веткой параметров или агрегатными функциями'
		);
		assert.ok(
			/title: VT_EXPRESSION_TITLE,\s*hint: 'Условие виртуальной таблицы «' \+ source\.alias \+ '»',[\s\S]*check: conditionWarning,\s*paramsBranch: false,\s*functions: vtConditionFunctionNodes\(ctx\.lang\),\s*functionsOpen: \[\],/.test(params),
			'окно «Условия» — со своим заголовком, веткой параметров или агрегатными функциями'
		);
		assert.ok(
			fn('\tfunction vtConditionFunctionNodes(lang) {').includes("return queryFunctionNodes(lang).filter((node) => node.group !== 'aggregate');"),
			'в функциях условий ВТ агрегатные'
		);
		assert.ok(
			params.includes('const functionsOf = () => (isCondition || isAccount ? vtConditionFunctionNodes(ctx.lang) : queryFunctionNodes(ctx.lang));') &&
				params.includes('withTypeText(nodesOf()).concat(functionsOf())'),
			'подсказка условий в окне параметров — с агрегатными функциями'
		);
		assert.ok(fn('\tfunction vtExpressionNodes(param, table) {').includes('return vtFieldNodes(QE.vtExpressionFields(param, table));'), 'поля окна условия на счёт — не своё поле');
		// Окно для СКД: у значения условия на счёт — та же «…» и подсказка своего поля без «⋯»
		const dcsAccount = fn('\tfunction buildDcsParamPosition(ctx, host, param, value, table, objectKind, windowTexts) {');
		assert.ok(dcsAccount.includes("const isAccount = QE.vtParamInput(param) === 'account';") && dcsAccount.includes('openAccountWindow(ctx, param, table, base.input.value, (text) => {'), 'у условия на счёт окна СКД нет «…»');
		assert.ok(
			/\} else if \(isAccount\) \{\s*api\.attachCompletion\(base\.input, \(\) => 'virtual-params', \{\s*catalog: \(\) => completer\.catalogFromNodes\(withTypeText\(vtExpressionNodes\(param, table\)\)\.concat\(vtConditionFunctionNodes\(lang\)\), \{ paramsAtRoot: true \}\),\s*ownTypes: true,\s*more: false,/.test(dcsAccount),
			'подсказка условия на счёт окна СКД — не своё поле или с «⋯»'
		);
		assert.ok(params.includes('attachVtWarning(editor.box, editor.input, () => conditionWarning(editor.input.value));'), 'нет предупреждения под условием');
		assert.ok(text.includes('openParamsWindow(ctx, selectedSource(ctx), info.params, info.current, info.table, info.objectKind);'), 'окну не передан вид объекта');
		// Окно выражения: предупреждение — строкой под текстом; ОК проверяет только пустоту
		const expression = fn('\tfunction openExpressionWindow(ctx, opts) {');
		assert.ok(expression.includes("funcsOpen: new Set(opts.functionsOpen || ['aggregate', 'other'])"), 'окно выражения не берёт раскрытые группы функций');
		assert.ok(expression.includes('expressionNodes(ctx, opts.nodes, opts.functions)'), 'окно выражения не берёт свои функции');
		assert.ok(expression.includes('const params = opts.paramsBranch === false ? [] : catalog.params || [];'), 'ветку «Параметры» не убрать');
		assert.ok(expression.includes("editor.input.setAttribute('aria-label', opts.hint ? 'Выражение: ' + opts.hint : 'Выражение');"), 'читалка не слышит, что правится');
		// В окне СКД подсказка значения условия — тоже без агрегатных функций
		assert.ok(
			fn('\tfunction buildDcsParamPosition(ctx, host, param, value, table, objectKind, windowTexts) {').includes('withTypeText(vtFieldNodes(allowed)).concat(vtConditionFunctionNodes(lang))'),
			'подсказка условия окна СКД — с агрегатными функциями'
		);
		assert.ok(expression.includes("empty: opts.empty || 'Полей нет: в части запроса ещё нет таблиц.',"), 'пустое дерево условия говорит о таблицах части');
		assert.ok(expression.includes("if (typeof opts.check === 'function') {"), 'окно выражения не показывает предупреждение');
		const ok = expression.slice(expression.indexOf("id: 'ok',"));
		assert.ok(!ok.slice(0, ok.indexOf("{ id: 'cancel'")).includes('check'), 'предупреждение блокирует ОК окна выражения');
		// Окно для СКД: «Поля-отборы» и подсказка значения — по тому же правилу, предупреждение видит и блок, и отборы
		const dcs = fn('\tfunction buildDcsParamPosition(ctx, host, param, value, table, objectKind, windowTexts) {');
		assert.ok(dcs.includes("const allowed = QE.vtConditionFields(objectKind || '', table).allowed;") && dcs.includes('for (const field of allowed) {'), 'поля-отборы — все поля таблицы');
		assert.ok(dcs.includes('block.input.addEventListener(\'input\', refreshWarning);') && /state\.on = Boolean\(on\.input\.checked\);\s*refreshWarning\(\);/.test(dcs), 'предупреждение СКД не следит за блоком и отборами');
		assert.ok(fn('\tfunction openDcsParamsWindow(ctx, row) {').includes('buildDcsParamPosition(ctx, body,') && fn('\tfunction openDcsParamsWindow(ctx, row) {').includes('state.objectKind'), 'окну СКД не передан вид объекта');
		// Строка предупреждения: описание поля для читалки, без живой области; пустая — не видна
		const warn = fn('\tfunction attachVtWarning(box, input, message) {');
		assert.ok(warn.includes("input.setAttribute('aria-describedby', line.id);") && !warn.includes('aria-live'), 'строка предупреждения не описывает поле или объявляется на каждое нажатие');
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		assert.match(css, /\.dcs-qd-vt-warn:empty\s*\{\s*display:\s*none;/);
		assert.match(css, /\.dcs-hl-box\.dcs-complete-host > \.dcs-qd-vt-warn\s*\{[^}]*grid-row:\s*4;/);
		// Разделитель в деревьях конструктора: знак перед именем на экране, слово — читалке; узлы полей ВТ — со своим видом
		assert.ok(fn('\tfunction vtFieldNodes(fields) {').includes('kind: QE.fieldNodeKind(field),'), 'узлы полей ВТ теряют вид общего реквизита');
		const mark = fn('\tfunction appendMark(item, kind, slot) {');
		assert.ok(mark.includes("mark.setAttribute('aria-hidden', 'true');") && mark.includes("item.appendChild(el('span', 'dcs-qd-mark-spoken', label.word));"), 'знак без слова для читалки');
		assert.ok(/item\.appendChild\(el\('span', 'dcs-tree-label', row\.label\)\);\s*appendMark\(item, row\.mark, markSlot\);/.test(text), 'знак не сразу после подписи строки');
		// Есть знак хоть у одной строки — у остальных пустое место той же ширины, скрытое от читалки и без слова
		assert.ok(text.includes('const markSlot = rows.some((row) => markLabel(row.mark) !== null);'), 'место знака не по дереву');
		assert.ok(
			/if \(!label\) \{\s*if \(slot\) \{\s*const empty = el\('span', 'dcs-qd-mark-slot'\);\s*empty\.setAttribute\('aria-hidden', 'true'\);\s*item\.appendChild\(empty\);\s*\}\s*return;/.test(mark),
			'у строки без знака нет пустого места'
		);
		assert.equal(text.split("mark: depth === 0 ? fieldMark(field.kind) : ''").length, 4, 'знак не во всех деревьях полей таблиц');
		assert.ok(text.includes('title: node.path, mark: fieldMark(node.kind) });'), 'знака нет в дереве окна выражения');
		assert.match(css, /\.dcs-qd-row > \.dcs-tree-twist\s*\{\s*order:\s*-2;/);
		assert.match(css, /\.dcs-qd-mark,\s*\.dcs-qd-mark-slot\s*\{\s*order:\s*-1;\s*flex:\s*0 0 1em;\s*width:\s*1em;/);
		// Строки окна параметров видом как у конфигуратора: значение — в одну строку без перевода строки, условия — в три
		assert.ok(params.includes("const shape = input === 'value' ? ' dcs-qd-param-value' : isCondition || isAccount ? ' dcs-qd-param-cond' : '';"), 'вид строки окна параметров не по её виду');
		assert.ok(/attachParamDrop\(ctx, editor\.input, windowTexts\);\s*singleLine\(editor\.input\);/.test(params), 'значение принимает перевод строки');
		assert.ok(
			/if \(event\.key === 'Enter' && !event\.isComposing\) \{\s*event\.preventDefault\(\);/.test(fn('\tfunction singleLine(input) {')),
			'Enter в значении переводит строку'
		);
		assert.match(css, /\.dcs-hl-wrap > \.dcs-qd-param-value\s*\{\s*min-height:\s*calc\(1\.45em \+ 16px\);\s*height:\s*calc\(1\.45em \+ 16px\);\s*resize:\s*none;/);
		assert.match(css, /\.dcs-hl-wrap > \.dcs-qd-param-cond\s*\{\s*min-height:\s*calc\(3 \* 1\.45em \+ 16px\);\s*height:\s*calc\(3 \* 1\.45em \+ 16px\);/);
		assert.match(css, /\.dcs-qd-mark-spoken\s*\{[^}]*clip-path:\s*inset\(50%\);/);
	});

	test('значения параметров виртуальной таблицы: поле со списком параметров запроса вместо подсказки полей и функций', () => {
		const text = dialog.replace(/\r\n/g, '\n');
		const fn = (source: string, signature: string): string => {
			const start = source.indexOf(signature);
			assert.ok(start >= 0, 'нет ' + signature);
			return source.slice(start, source.indexOf('\n\t}\n', start));
		};
		// Окно «Таблиц и полей»: значение — attachParamDrop, остальное — подсказка полей и функций
		const params = fn(text, '\tfunction openParamsWindow(ctx, source, params, current, table, objectKind) {');
		assert.ok(params.includes('const input = QE.vtParamInput(param);') && params.includes("if (input === 'list') {"), 'вид позиции — не по правилу');
		assert.ok(/if \(input === 'value'\) \{\s*attachParamDrop\(ctx, editor\.input, windowTexts\);\s*singleLine\(editor\.input\);\s*\} else \{/.test(params), 'у значения — подсказка полей и функций');
		assert.ok(params.includes('const windowTexts = (except) => controls.filter((read, k) => fields[k] !== except).map((read) => read());'), 'список значения не видит строк окна');
		assert.equal(params.split('controls.push(').length, params.split('fields.push(').length, 'у строки окна нет своего поля рядом с чтением');
		// Список: только параметры, которые уже есть в запросе, без полей и функций; буква его не открывает
		const drop = fn(text, '\tfunction attachParamDrop(ctx, input, windowTexts) {');
		assert.ok(drop.includes('QE.usedParameters(ctx.state.model, ctx.state.outerParams, typed)'), 'список не из параметров запроса и строк окна');
		assert.ok(drop.includes('const typed = windowTexts(input);'), 'свой недописанный текст поля попадает в его список');
		assert.ok(drop.includes('completer.catalogFromNodes(withTypeText(nodes()), { paramsAtRoot: true })') && !drop.includes('queryFunctionNodes'), 'в списке функции');
		assert.ok(drop.includes('letters: false,') && drop.includes('drop: PARAM_DROP,'), 'не поле со списком');
		assert.ok(text.includes("title: 'Параметры запроса (Alt+↓)',") && text.includes("empty: 'В запросе ещё нет параметров: впишите значение или &Имя.',"), 'подписи кнопки и пустого списка');
		// Окно для СКД — то же поле; вложенный конструктор знает параметры внешнего пакета
		assert.ok(/if \(QE\.vtParamInput\(param\) === 'value'\) \{[^}]*attachParamDrop\(ctx, base\.input, \(except\) => windowTexts\(except\)\.concat\(\[block\.input\.value\]\)\);/.test(fn(text, '\tfunction buildDcsParamPosition(ctx, host, param, value, table, objectKind, windowTexts) {')), 'значение в окне для СКД без списка');
		const dcsWindow = fn(text, '\tfunction openDcsParamsWindow(ctx, row) {');
		assert.ok(dcsWindow.includes('const windowTexts = (except) => readers.filter((read) => read.field !== except).map((read) => read());') && dcsWindow.includes('state.objectKind, windowTexts)'), 'список значения окна для СКД не видит других позиций');
		assert.ok(fn(text, '\tfunction buildDcsParamPosition(ctx, host, param, value, table, objectKind, windowTexts) {').includes('reader.field = base.input;'), 'чтение позиции не знает своего поля');
		const nested = fn(text, '\tfunction nestedQuery(ctx) {');
		assert.equal(nested.split('outerParams: outerParams,').length, 3, 'оба вложенных конструктора — с параметрами внешнего пакета');
		assert.ok(text.includes('outerParams: options.outerParams || [],'), 'состояние конструктора без параметров внешнего пакета');
		// Поле со списком в подсказке редактора: «▾», Alt+↓/Alt+↑, выбор заменяет всё значение, пустой список — строкой
		const script = readEditorScript();
		const button = fn(script, '\tfunction addCompleteButton(binding) {');
		assert.ok(button.includes("drop ? '▾' : '⋯'") && button.includes("button.setAttribute('aria-haspopup', 'listbox');") && button.includes("openCompletion(binding, drop ? 'drop' : 'full');"), 'кнопка поля со списком');
		const keys = fn(script, '\tfunction onCompleteKeydown(binding, event) {');
		assert.ok(keys.includes("binding.drop && event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')"), 'Alt+↓ не раскрывает список');
		assert.ok(keys.indexOf('binding.drop && event.altKey') < keys.indexOf('const session = completeSession;'), 'Alt+↓ работает только при открытом списке');
		assert.ok(fn(script, '\tfunction acceptCompletion(index) {').includes('session.ctx && session.ctx.whole ? wholeValueContext(input) : caretContext(input)'), 'выбор в списке не заменяет значение');
		const open = fn(script, '\tfunction openCompletion(binding, how, knownCtx) {');
		assert.ok(open.includes('const ctx = drop ? wholeValueContext(input) : knownCtx || caretContext(input);') && open.includes('if (ranked.length === 0 && !(drop && binding.drop.empty)) {'), 'пустой список поля со списком молчит');
		assert.ok(fn(script, '\tfunction renderCompletion() {').includes('total === 0 && session.empty ? session.empty : completer.windowNote('), 'нет строки пустого списка');
	});

	test('поле со списком значения параметра ВТ: без совпадения строка не выбрана, Tab по раскрытому списку значение не меняет, кнопка «▾» говорит, открыт ли список', () => {
		const script = readEditorScript();
		const fn = (signature: string): string => {
			const start = script.indexOf(signature);
			assert.ok(start >= 0, 'нет ' + signature);
			return script.slice(start, script.indexOf('\n\t}\n', start));
		};
		// Значение не из списка (выражение, {(&Имя)}, пусто) — ни одна строка не выбрана: Enter и Tab ничего не подставят
		const active = fn('\tfunction dropActive(ranked, value) {');
		assert.ok(!active.includes('index < 0 ? 0'), 'без совпадения выбрана первая строка');
		assert.ok(/if \(!want\) \{\s*return -1;\s*\}\s*return ranked\.findIndex\(/.test(active), 'без совпадения — не -1');
		const keys = fn('\tfunction onCompleteKeydown(binding, event) {');
		const guard = keys.indexOf("(event.key === 'Enter' || event.key === 'Tab') && !dropAccepts(session, event.key)");
		assert.ok(guard > 0 && guard < keys.indexOf('acceptCompletion(session.active);'), 'Enter и Tab берут строку без проверки');
		assert.ok(/!dropAccepts\(session, event\.key\)\) \{[^]*?closeCompletion\(\);\s*if \(event\.key === 'Enter'\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*\}\s*return;/.test(keys), 'Tab без строки не уводит фокус или Enter доходит до окна');
		assert.ok(/session\.moved = true;\s*moveCompletion\(completer\.nextActive\(/.test(keys), 'выбор стрелками не отмечается');
		const accepts = fn('\tfunction dropAccepts(session, key) {');
		assert.ok(accepts.includes('if (!session.ranked[session.active]) {') && accepts.includes("return !(key === 'Tab' && session.ctx && session.ctx.whole && !session.moved);"), 'Tab берёт строку, которую не выбирали');
		// Пересчёт по описаниям после набора идёт от каретки: раскрытый список значений не возвращается
		const open = fn('\tfunction openCompletion(binding, how, knownCtx) {');
		assert.ok(open.includes("const drop = how === 'drop' && binding.drop !== null && !knownCtx;") && open.includes('moved: false,'), 'переоткрытие по описаниям раскрывает весь список');
		assert.ok(/if \(session\.how === 'drop'\) \{\s*session\.how = 'explicit';\s*\}/.test(fn('\tfunction refreshCompletion(knownCtx) {')), 'перефильтрованный список остаётся раскрытым списком значений');
		// Кнопка «▾»: aria-controls и aria-expanded, второе нажатие закрывает список
		const button = fn('\tfunction addCompleteButton(binding) {');
		assert.ok(button.includes("button.setAttribute('aria-controls', completeList.id);") && button.includes("button.setAttribute('aria-expanded', 'false');"), 'у «▾» нет aria-controls и aria-expanded');
		assert.ok(/if \(drop && completeSession && completeSession\.binding === binding\) \{[^}]*closeCompletion\(\);/.test(button), '«▾» не закрывает открытый список');
		assert.ok(open.includes("binding.more.setAttribute('aria-expanded', 'true');") && fn('\tfunction closeCompletion() {').includes("session.binding.more.setAttribute('aria-expanded', 'false');"), 'aria-expanded кнопки не следит за списком');
		// Поле: Alt+↓ в aria-keyshortcuts и описании; раскрытый список назван словами
		const attach = fn('\tfunction attachCompletion(input, scopeFn, options) {');
		assert.ok(attach.includes("input.setAttribute('aria-keyshortcuts', 'Alt+ArrowDown');") && attach.includes('binding.drop.keys'), 'читалка не знает про Alt+↓');
		assert.ok(fn('\tfunction renderCompletion() {').includes("completeList.setAttribute('aria-label', session.ctx.whole && drop && drop.list ? drop.list : 'Подсказка');"), 'раскрытый список назван «Подсказка»');
		const dialogText = dialog.replace(/\r\n/g, '\n');
		assert.ok(dialogText.includes("list: 'Параметры запроса',") && dialogText.includes("keys: 'Alt+↓ раскрывает параметры запроса',"), 'подписи списка и описания поля');
	});
});

/**
 * Узел мини-DOM для помощников конструктора, исполняемых как есть: только то, что они трогают
 * (атрибуты, дети, обработчики событий, id, title, tabIndex).
 */
class StubNode {
	tagName: string;
	className: string;
	textContent: string;
	children: StubNode[] = [];
	id = '';
	title = '';
	type = '';
	tabIndex = 0;
	private readonly attributes = new Map<string, string>();
	private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

	constructor(tag: string, className?: string, text?: string) {
		this.tagName = tag.toUpperCase();
		this.className = className || '';
		this.textContent = text === undefined ? '' : text;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, String(value));
	}

	getAttribute(name: string): string | null {
		return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
	}

	appendChild(child: StubNode): StubNode {
		this.children.push(child);
		return child;
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.set(type, (this.listeners.get(type) || []).concat([listener]));
	}

	/** Событие обработчикам узла; для keydown — признак preventDefault. */
	fire(type: string, key = ''): boolean {
		let prevented = false;
		const event = {
			key: key,
			preventDefault: () => {
				prevented = true;
			},
		};
		for (const listener of this.listeners.get(type) || []) {
			listener(event);
		}
		return prevented;
	}

	/** Текст узла с детьми: ярлык вертикальной вкладки лежит во вложенном span. */
	text(): string {
		return this.textContent + this.children.map((child) => child.text()).join('');
	}
}

function stubKeys(): { set(node: StubNode, key: string): StubNode; get(key: string): StubNode | null } {
	const map = new Map<string, StubNode>();
	return {
		set(node, key) {
			node.setAttribute('data-qd-key', key);
			map.set(key, node);
			return node;
		},
		get(key) {
			return map.get(key) || null;
		},
	};
}

describe('Конструктор запроса: запросы пакета и части объединения — вертикальные вкладки справа', () => {
	const dialog = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor-query-dialog.js'), 'utf8').replace(/\r\n/g, '\n');

	/** Функция файла верхнего уровня (отступ — один таб) по началу сигнатуры, с телом. */
	function source(signature: string): string {
		const start = dialog.indexOf('\n\tfunction ' + signature);
		assert.ok(start >= 0, `нет function ${signature}`);
		const end = dialog.indexOf('\n\t}\n', start);
		return dialog.slice(start, end + 4);
	}

	interface StripSpec {
		label: string;
		className: string;
		panelClass?: string;
		items: Array<{ id: string; title: string; name?: string }>;
		active: string;
		keyPrefix: string;
		keys: ReturnType<typeof stubKeys>;
		onPick: (id: string) => void;
		orientation?: string;
		controls?: StubNode;
	}

	interface SideHelpers {
		tabStrip(spec: StripSpec): { strip: StubNode; panel: StubNode | null; activeId: string };
		renderSideTabs(root: StubNode, main: StubNode, ctx: unknown): void;
	}

	const picks: Array<[string, number, string]> = [];

	/** tabStrip и renderSideTabs исполняются как есть: el, выбор запроса и части и подписи QE — заглушки. */
	function helpers(): SideHelpers {
		const factory = new Function(
			'el',
			'selectPart',
			'selectStatement',
			'QE',
			'let tabStripCount = 0;\n' + source('tabStrip(spec) {') + source('renderSideTabs(root, main, ctx) {') + '\nreturn { tabStrip: tabStrip, renderSideTabs: renderSideTabs };'
		) as (...args: unknown[]) => SideHelpers;
		return factory(
			(tag: string, className?: string, text?: string) => new StubNode(tag, className, text),
			(_ctx: unknown, index: number, focus: string) => picks.push(['part', index, focus]),
			(_ctx: unknown, index: number, focus: string) => picks.push(['statement', index, focus]),
			{
				statementLabel: (_statement: unknown, index: number) => (index === 0 ? 'Запрос пакета 1: временная таблица ВТ1' : 'Запрос пакета ' + (index + 1)),
				statementTabLabel: (_statement: unknown, index: number) => (index === 0 ? 'ВТ1' : 'Запрос пакета ' + (index + 1)),
			}
		);
	}

	const tabsOf = (strip: StubNode): StubNode[] => strip.children.filter((child) => child.getAttribute('role') === 'tab');

	test('вертикальная полоса: aria-orientation, ↑ ↓ Home End по кругу, ← → не перехватываются, одна остановка Tab', () => {
		const { tabStrip } = helpers();
		const picked: string[] = [];
		const area = new StubNode('div', 'dcs-qd-main');
		const built = tabStrip({
			label: 'Запрос пакета',
			className: 'dcs-qd-vtabs',
			orientation: 'vertical',
			controls: area,
			items: [
				{ id: '0', title: 'ВТ1', name: 'Запрос пакета 1: временная таблица ВТ1' },
				{ id: '1', title: 'Запрос пакета 2', name: 'Запрос пакета 2' },
				{ id: '2', title: 'Запрос 3', name: 'Запрос 3, часть объединения' },
			],
			active: '0',
			keyPrefix: 'qstmt:',
			keys: stubKeys(),
			onPick: (id) => picked.push(id),
		});
		assert.equal(built.panel, null, 'у полосы над чужой областью своей панели нет');
		assert.equal(built.strip.getAttribute('role'), 'tablist');
		assert.equal(built.strip.getAttribute('aria-orientation'), 'vertical');
		assert.equal(built.strip.getAttribute('aria-label'), 'Запрос пакета');
		const tabs = tabsOf(built.strip);
		assert.deepEqual(
			tabs.map((tab) => [tab.text(), tab.getAttribute('aria-label'), tab.title, tab.tabIndex, tab.getAttribute('aria-selected')]),
			[
				['ВТ1', 'Запрос пакета 1: временная таблица ВТ1', 'Запрос пакета 1: временная таблица ВТ1', 0, 'true'],
				['Запрос пакета 2', null, 'Запрос пакета 2', -1, 'false'],
				['Запрос 3', 'Запрос 3, часть объединения', 'Запрос 3, часть объединения', -1, 'false'],
			]
		);
		// Повёрнутый текст — во вложенном span: у кнопки writing-mode соблюдают не все Chromium
		assert.equal(tabs[0].textContent, '');
		assert.equal(tabs[0].children[0].className, 'dcs-qd-vtab-text');
		assert.ok(area.id, 'область получила id');
		assert.equal(tabs[0].getAttribute('aria-controls'), area.id);
		assert.equal(built.activeId, tabs[0].id);
		assert.equal(tabs[1].getAttribute('aria-controls'), null);
		assert.equal(tabs[0].getAttribute('data-qd-key'), 'qstmt:0', 'ключ возврата фокуса');
		assert.equal(tabs[0].fire('keydown', 'ArrowDown'), true);
		assert.equal(tabs[0].fire('keydown', 'ArrowUp'), true);
		assert.equal(tabs[2].fire('keydown', 'ArrowDown'), true);
		assert.equal(tabs[1].fire('keydown', 'End'), true);
		assert.equal(tabs[1].fire('keydown', 'Home'), true);
		assert.deepEqual(picked, ['1', '2', '0', '2', '0']);
		assert.equal(tabs[0].fire('keydown', 'ArrowRight'), false, '← → у вертикальной полосы не её');
		assert.equal(tabs[0].fire('keydown', 'ArrowLeft'), false);
		tabs[1].fire('click');
		assert.deepEqual(picked, ['1', '2', '0', '2', '0', '1'], 'выбор — одним щелчком');
	});

	test('горизонтальная полоса: своя панель, ← → Home End, ↑ ↓ не перехватываются', () => {
		const { tabStrip } = helpers();
		const picked: string[] = [];
		const built = tabStrip({
			label: 'Вкладки конструктора',
			className: 'tabs',
			panelClass: 'dcs-qd-panel',
			items: [
				{ id: 'tables', title: 'Таблицы и поля' },
				{ id: 'links', title: 'Связи' },
			],
			active: 'links',
			keyPrefix: 'tab:',
			keys: stubKeys(),
			onPick: (id) => picked.push(id),
		});
		assert.ok(built.panel, 'нет панели');
		assert.equal(built.strip.getAttribute('aria-orientation'), null);
		const tabs = tabsOf(built.strip);
		assert.equal(tabs[1].textContent, 'Связи', 'текст ярлыка — в самой кнопке');
		assert.equal(tabs[1].getAttribute('aria-label'), null);
		assert.equal(tabs[1].title, '');
		assert.equal(built.panel?.getAttribute('aria-labelledby'), tabs[1].id);
		assert.equal(tabs[1].getAttribute('aria-controls'), built.panel?.id);
		assert.equal(tabs[1].fire('keydown', 'ArrowRight'), true);
		assert.equal(tabs[0].fire('keydown', 'ArrowLeft'), true);
		assert.equal(tabs[0].fire('keydown', 'ArrowDown'), false);
		assert.deepEqual(picked, ['tables', 'links']);
	});

	test('полосы справа — при двух запросах пакета и при двух частях; части ближе к содержимому, область названа обеими', () => {
		const { renderSideTabs } = helpers();
		picks.length = 0;
		const part = {};
		const statements = [{ parts: [part] }, { parts: [part, part] }, { parts: [part] }];
		const context = (statement: number, partIndex: number, list: unknown[]): unknown => ({
			state: { model: { statements: list }, statement: statement, part: partIndex },
			statement: () => list[statement],
			keys: stubKeys(),
		});
		const root = new StubNode('div', 'dcs-qd');
		const main = root.appendChild(new StubNode('div', 'dcs-qd-main'));
		renderSideTabs(root, main, context(1, 1, statements));
		assert.deepEqual(
			root.children.map((child) => child.className),
			['dcs-qd-main', 'dcs-qd-vtabs', 'dcs-qd-vtabs dcs-qd-vtabs-batch'],
			'порядок: содержимое, части, запросы пакета у края'
		);
		const parts = root.children[1];
		const batch = root.children[2];
		assert.equal(parts.getAttribute('aria-label'), 'Часть объединения');
		assert.equal(batch.getAttribute('aria-label'), 'Запрос пакета');
		assert.deepEqual(
			tabsOf(parts).map((tab) => [tab.text(), tab.getAttribute('aria-label'), tab.title, tab.getAttribute('aria-selected')]),
			[
				['Запрос 1', 'Запрос 1, часть объединения', 'Запрос 1, часть объединения', 'false'],
				['Запрос 2', 'Запрос 2, часть объединения', 'Запрос 2, часть объединения', 'true'],
			]
		);
		// Имя части начинается с ярлыка (голосовая команда по видимому тексту) и говорит, что это часть объединения
		for (const tab of tabsOf(parts)) {
			assert.ok(String(tab.getAttribute('aria-label')).startsWith(tab.text() + ', '), tab.text());
		}
		assert.deepEqual(
			tabsOf(batch).map((tab) => [tab.text(), tab.getAttribute('aria-label') || tab.text(), tab.getAttribute('aria-selected')]),
			[
				['ВТ1', 'Запрос пакета 1: временная таблица ВТ1', 'false'],
				['Запрос пакета 2', 'Запрос пакета 2', 'true'],
				['Запрос пакета 3', 'Запрос пакета 3', 'false'],
			]
		);
		assert.equal(main.getAttribute('role'), 'tabpanel');
		const activeBatch = tabsOf(batch)[1];
		const activePart = tabsOf(parts)[1];
		assert.equal(main.getAttribute('aria-labelledby'), activeBatch.id + ' ' + activePart.id, 'область названа запросом, затем частью');
		assert.equal(
			[activeBatch, activePart].map((tab) => tab.getAttribute('aria-label') || tab.text()).join(' '),
			'Запрос пакета 2 Запрос 2, часть объединения',
			'какой «Запрос» — часть объединения, слышно из имени'
		);
		assert.equal(activeBatch.getAttribute('aria-controls'), main.id);
		assert.equal(activePart.getAttribute('aria-controls'), main.id);
		tabsOf(batch)[0].fire('click');
		tabsOf(parts)[0].fire('keydown', 'ArrowDown');
		assert.deepEqual(picks, [
			['statement', 0, 'qstmt:0'],
			['part', 1, 'qpart:1'],
		]);
		// Один запрос без объединения — полос нет, область без роли
		const single = new StubNode('div', 'dcs-qd');
		const singleMain = single.appendChild(new StubNode('div', 'dcs-qd-main'));
		renderSideTabs(single, singleMain, context(0, 0, [{ parts: [part] }]));
		assert.equal(single.children.length, 1);
		assert.equal(singleMain.getAttribute('role'), null);
		// Пакет без объединения в текущем запросе — только запросы пакета
		const batchOnly = new StubNode('div', 'dcs-qd');
		renderSideTabs(batchOnly, batchOnly.appendChild(new StubNode('div', 'dcs-qd-main')), context(0, 0, statements));
		assert.deepEqual(
			batchOnly.children.map((child) => child.getAttribute('aria-label')),
			[null, 'Запрос пакета']
		);
	});

	test('полосы — справа от области вкладок конструктора, узкие, текст повёрнут и не переносится', () => {
		const render = source('renderBody(body, ctx) {');
		assert.ok(render.indexOf("const main = el('div', 'dcs-qd-main');") < render.indexOf('renderSideTabs(root, main, ctx);'), 'полосы строятся раньше области');
		assert.ok(render.includes('main.appendChild(built.strip);') && render.includes('main.appendChild(built.panel);'), 'вкладки конструктора не в области слева');
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const rule = (selector: string): string => {
			const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1].split(',').some((s) => s.trim() === selector));
			assert.ok(found, `нет правила ${selector}`);
			return found[2];
		};
		assert.match(rule('.dcs-qd-main'), /min-width:\s*0/, 'содержимое не сжимается — полосы дали бы горизонтальную прокрутку');
		assert.match(rule('.dcs-qd-main'), /flex:\s*1 1 auto/);
		assert.match(rule('.dcs-qd-vtabs'), /flex:\s*none/);
		// Полоса — область прокрутки (overflow), а рамка фокуса .tab:focus-visible (1px со сдвигом 1px) и рамка активной
		// вкладки контрастной темы — снаружи кнопки: без отступа полоса обрезала бы их со всех сторон
		assert.match(rule('.dcs-qd-vtabs'), /overflow-y:\s*auto/);
		const padding = /(?:^|;)\s*padding:\s*(\d+)px\s*;/.exec(rule('.dcs-qd-vtabs'));
		assert.ok(padding && Number(padding[1]) >= 2, 'у полосы нет отступа под рамку фокуса: ' + rule('.dcs-qd-vtabs'));
		const batchLeft = /padding-left:\s*(\d+)px/.exec(rule('.dcs-qd-vtabs-batch'));
		assert.ok(!batchLeft || Number(batchLeft[1]) >= 2, 'слева у полосы пакета нет места под рамку');
		assert.ok(!/(?:^|;)\s*padding:/.test(rule('.dcs-qd-vtabs-batch')), 'полоса пакета не должна сбрасывать отступ полосы целиком');
		assert.match(rule('.dcs-qd-vtab-text'), /writing-mode:\s*vertical-rl/);
		// У тела окна overflow-wrap: anywhere — без nowrap «Часть объединения» переносилась бы посреди слова
		assert.match(rule('.dcs-qd-vtab-text'), /white-space:\s*nowrap/);
		assert.match(rule('.dcs-qd-vtab-text'), /text-overflow:\s*ellipsis/);
	});
});

describe('Команды над списками — пиктограммы с подсказкой', () => {
	const script = readEditorScript();
	const dialog = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor-query-dialog.js'), 'utf8').replace(/\r\n/g, '\n');
	const ICON_SECTION_START = '// ---------- команды-пиктограммы над списками ----------';
	const ICON_SECTION_END = '// ---------- подсветка запроса и выражений ----------';

	/** Узел мини-DOM с пространством имён (svg) и щелчком; el — как у редактора. */
	class IconNode extends StubNode {
		namespace: string;
		disabled = false;

		constructor(tag: string, namespace = '', className?: string) {
			super(tag, className);
			this.namespace = namespace;
		}

		click(): void {
			this.fire('click');
		}
	}

	interface IconSpec {
		icon: string;
		name: string;
		onClick: (event: unknown) => void;
		note?: string;
		spoken?: string;
		unavailable?: boolean;
		shortcut?: string;
		disabled?: boolean;
		className?: string;
		key?: string;
	}

	interface IconHelpers {
		COMMAND_ICONS: Record<string, Array<[string, Record<string, string>]>>;
		commandIcon(name: string): IconNode;
		iconButton(spec: IconSpec): IconNode;
		listToolbar(host: IconNode, buttons: IconSpec[]): IconNode;
	}

	/** Раздел пиктограмм dcs-editor.js исполняется как есть: document, el и ключи фокуса (keyed, focusKey, закладка) — заглушки. */
	function icons(): IconHelpers {
		const start = script.indexOf(ICON_SECTION_START);
		const end = script.indexOf(ICON_SECTION_END);
		assert.ok(start >= 0 && end > start, 'нет раздела пиктограмм');
		const factory = new Function(
			'document',
			'el',
			'keyed',
			'focusKey',
			'activeTabId',
			script.slice(start, end) + '\nreturn { COMMAND_ICONS: COMMAND_ICONS, commandIcon: commandIcon, iconButton: iconButton, listToolbar: listToolbar };'
		) as (...args: unknown[]) => IconHelpers;
		const documentStub = {
			createElementNS: (namespace: string, tag: string) => new IconNode(tag, namespace),
			createElement: (tag: string) => new IconNode(tag),
		};
		return factory(
			documentStub,
			(tag: string, className?: string) => new IconNode(tag, '', className),
			(node: IconNode, key: string) => {
				node.setAttribute('data-dcs-key', key);
				return node;
			},
			(parts: string[]) => parts.join('\n'),
			'resources'
		);
	}

	// Только применённые пиктограммы: поле-выражение у «Полей» добавляет «+», как у конфигуратора
	const QUERY_ICONS = ['add', 'add-copy', 'edit', 'delete', 'rename', 'replace', 'up', 'down', 'nested-query', 'table-params'];
	// «Настройки»: новая группировка, таблица, диаграмма, конструктор настроек, папка, «Авто»
	const SETTINGS_ICONS = ['group', 'table', 'chart', 'wizard', 'folder', 'auto'];
	// Перенос в папку (группу) и из неё без мыши (WCAG 2.5.7): «Вынести из папки», «Перенести в папку выше»
	const LEVEL_ICONS = ['outdent', 'indent'];
	const REQUIRED = QUERY_ICONS.concat(SETTINGS_ICONS, LEVEL_ICONS);

	test('набор пиктограмм: все нужные есть, рисунки различаются, svg 16×16 скрыт от читалки, без style и без своих цветов', () => {
		const helpers = icons();
		assert.deepEqual(Object.keys(helpers.COMMAND_ICONS).sort(), REQUIRED.slice().sort());
		const drawings = new Set<string>();
		for (const name of REQUIRED) {
			const svg = helpers.commandIcon(name);
			assert.equal(svg.tagName, 'SVG', name);
			assert.equal(svg.namespace, 'http://www.w3.org/2000/svg', name);
			assert.equal(svg.getAttribute('viewBox'), '0 0 16 16', name);
			assert.equal(svg.getAttribute('width'), '16');
			assert.equal(svg.getAttribute('height'), '16');
			assert.equal(svg.getAttribute('aria-hidden'), 'true', 'пиктограмму читалка не слышит: имя у кнопки');
			assert.equal(svg.getAttribute('focusable'), 'false');
			assert.equal(svg.getAttribute('class'), 'dcs-icon');
			assert.ok(svg.children.length > 0, name);
			for (const shape of svg.children as IconNode[]) {
				assert.equal(shape.namespace, 'http://www.w3.org/2000/svg', name);
				// CSP окна (style-src без unsafe-inline) не пропустил бы style; цвет — currentColor из стилей
				for (const attr of ['style', 'fill', 'stroke', 'color']) {
					assert.equal(shape.getAttribute(attr), null, `${name}: атрибут ${attr}`);
				}
			}
			drawings.add(JSON.stringify(helpers.COMMAND_ICONS[name]));
		}
		assert.equal(drawings.size, REQUIRED.length, 'две пиктограммы нарисованы одинаково');
		assert.throws(() => helpers.commandIcon('нет-такой'), /нет пиктограммы «нет-такой»/);
	});

	test('кнопка-пиктограмма: название — и подсказка, и доступное имя; пояснение — второй строкой и описанием; клавиша — только в подсказке', () => {
		const { iconButton } = icons();
		const clicks: string[] = [];
		const plain = iconButton({ icon: 'add', name: 'Добавить связь…', onClick: () => clicks.push('plain') });
		assert.equal(plain.tagName, 'BUTTON');
		assert.equal(plain.type, 'button');
		assert.equal(plain.className, 'ghost-btn dcs-btn-small dcs-icon-btn', 'по умолчанию — кнопка панели');
		assert.equal(plain.getAttribute('aria-label'), 'Добавить связь…');
		assert.equal(plain.title, 'Добавить связь…');
		assert.equal(plain.getAttribute('aria-description'), null);
		assert.equal(plain.getAttribute('aria-disabled'), null);
		assert.equal(plain.text(), '', 'видимого текста нет — только пиктограмма');
		assert.equal(plain.children[0].tagName, 'SVG');
		plain.click();
		assert.deepEqual(clicks, ['plain']);
		// Недоступная, но фокусируемая: щелчок доходит до обработчика (тот говорит причину), disabled нет
		const unavailable = iconButton({
			icon: 'table-params',
			name: 'Параметры виртуальной таблицы…',
			unavailable: true,
			note: 'У основной таблицы параметров нет',
			spoken: 'у таблицы нет параметров',
			onClick: () => clicks.push('unavailable'),
		});
		assert.equal(unavailable.getAttribute('aria-disabled'), 'true');
		assert.equal(unavailable.disabled, false, 'недоступная остаётся в обходе Tab');
		assert.equal(unavailable.title, 'Параметры виртуальной таблицы…\nУ основной таблицы параметров нет');
		assert.equal(unavailable.getAttribute('aria-label'), 'Параметры виртуальной таблицы…');
		assert.equal(unavailable.getAttribute('aria-description'), 'у таблицы нет параметров');
		unavailable.click();
		assert.deepEqual(clicks, ['plain', 'unavailable']);
		// «Недоступно» читалка говорит сама по aria-disabled: в описании причина без него, в подсказке для глаза — целиком
		const reasoned = iconButton({ icon: 'up', name: 'Переместить выше', unavailable: true, note: 'Недоступно: строка уже первая.', onClick: () => undefined });
		assert.equal(reasoned.title, 'Переместить выше\nНедоступно: строка уже первая.');
		assert.equal(reasoned.getAttribute('aria-description'), 'Строка уже первая.');
		const waiting = iconButton({ icon: 'wizard', name: 'Конструктор настроек…', unavailable: true, note: 'Недоступно, пока настройки загружаются.', onClick: () => undefined });
		assert.equal(waiting.getAttribute('aria-description'), 'Пока настройки загружаются.');
		// У доступной кнопки пояснение — как есть
		const hinted = iconButton({ icon: 'add', name: 'Добавить', note: 'Недоступно бывает только у недоступной.', onClick: () => undefined });
		assert.equal(hinted.getAttribute('aria-description'), 'Недоступно бывает только у недоступной.');
		// Клавиша списка — в подсказке: в доступное имя и aria-keyshortcuts не идёт (она работает в дереве, а не на кнопке)
		const keyed = iconButton({ icon: 'rename', name: 'Переименовать выбранный набор', shortcut: 'F2', onClick: () => clicks.push('keyed') });
		assert.equal(keyed.getAttribute('aria-label'), 'Переименовать выбранный набор');
		assert.equal(keyed.title, 'Переименовать выбранный набор (F2)');
		assert.equal(keyed.getAttribute('aria-keyshortcuts'), null);
		// Описание для читалки — короткое, без имени: иначе им стал бы title, и имя прозвучало бы дважды вместе с клавишей
		assert.equal(keyed.getAttribute('aria-description'), 'Клавиша в списке: F2');
		keyed.click();
		assert.deepEqual(clicks, ['plain', 'unavailable', 'keyed']);
		// Кнопки набора: disabled и причина — второй строкой подсказки, после названия с клавишей
		const disabled = iconButton({
			icon: 'delete',
			name: 'Удалить выбранный набор',
			shortcut: 'Delete',
			note: 'Наборы внутри объединения только просматриваются',
			disabled: true,
			className: 'ghost-btn dcs-btn-small dcs-btn-danger dcs-sets-icon',
			onClick: () => clicks.push('disabled'),
		});
		assert.equal(disabled.disabled, true);
		assert.equal(disabled.className, 'ghost-btn dcs-btn-small dcs-btn-danger dcs-sets-icon dcs-icon-btn');
		assert.equal(disabled.getAttribute('aria-description'), 'Наборы внутри объединения только просматриваются');
		assert.equal(disabled.getAttribute('aria-label'), 'Удалить выбранный набор');
		assert.equal(disabled.title, 'Удалить выбранный набор (Delete)\nНаборы внутри объединения только просматриваются');
		assert.equal(disabled.getAttribute('aria-busy'), null);
		const bar = icons().listToolbar(new IconNode('div'), [
			{ icon: 'add', name: 'Добавить ресурс…', onClick: () => undefined },
			{ icon: 'delete', name: 'Удалить', onClick: () => undefined },
		]);
		assert.equal(bar.className, 'dcs-list-toolbar');
		assert.deepEqual(
			bar.children.map((button) => button.getAttribute('aria-label')),
			['Добавить ресурс…', 'Удалить']
		);
		// У пиктограмм панели — ключи фокуса (закладка и название): фокус на них переживает перерисовку вкладки
		assert.deepEqual(
			bar.children.map((button) => button.getAttribute('data-dcs-key')),
			['tool\nresources\nДобавить ресурс…', 'tool\nresources\nУдалить']
		);
		const own = icons().listToolbar(new IconNode('div'), [{ icon: 'add', name: 'Добавить', key: 'свой', onClick: () => undefined }]);
		assert.equal(own.children[0].getAttribute('data-dcs-key'), 'свой');
	});

	test('помощник один: редактор отдаёт его конструктору через DcsEditorApi, конструктор ставит ключ фокуса по названию', () => {
		assert.ok(/window\.DcsEditorApi = Object\.freeze\(\{[\s\S]*\n\t\ticonButton: iconButton,/.test(script), 'iconButton не в API редактора');
		assert.ok(!/function commandIcon|COMMAND_ICONS|createElementNS/.test(dialog), 'у конструктора свои пиктограммы');
		const start = dialog.indexOf('\tfunction iconButton(icon, name, onClick, keys, options) {');
		assert.ok(start >= 0, 'нет обёртки iconButton в конструкторе');
		const body = dialog.slice(start, dialog.indexOf('\n\t}\n', start));
		assert.ok(body.includes('api.iconButton(Object.assign({ icon: icon, name: name, onClick: onClick }, options || {}))'), body);
		assert.ok(body.includes("keys.set(node, 'btn:' + name);"), 'ключ фокуса не по названию');
	});

	test('конструктор: на панелях над списками нет текстовых команд, переносы > >> < << — знаки', () => {
		for (const label of [
			'Переименовать…',
			'Заменить таблицу',
			'Параметры виртуальной таблицы…',
			'Вложенный запрос…',
			'Добавить выражение…',
			'Изменить…',
			'Добавить',
			'Добавить…',
			'Скопировать',
			'Копировать',
			'Копия',
			'Удалить',
			'Удалить колонку',
			'Условие…',
			'↑',
			'↓',
		]) {
			assert.ok(!dialog.includes(`button('${label}',`), `текстовая команда «${label}»`);
		}
		const used = new Map<string, number>();
		for (const m of dialog.matchAll(/iconButton\('([\w-]+)', /g)) {
			used.set(m[1], (used.get(m[1]) || 0) + 1);
		}
		for (const name of QUERY_ICONS) {
			assert.ok(used.has(name), `пиктограмма ${name} в конструкторе не применена`);
		}
		// Пиктограммы «Настроек» применены на вкладке: её модуль и модуль вкладок узла
		const settingsPart = readEditorPart('dcs-editor-settings.js') + readEditorPart('dcs-editor-settings-panels.js');
		for (const name of SETTINGS_ICONS) {
			assert.ok(settingsPart.includes(`icon: '${name}'`), `пиктограмма ${name} на «Настройках» не применена`);
		}
		assert.ok((used.get('up') || 0) >= 8 && used.get('up') === used.get('down'), 'стрелки вверх и вниз парами');
		// Переносы между списками — знаки; кнопки — общие с закладкой «Ресурсы» (api.transferButtons)
		assert.ok(dialog.includes('const made = api.transferButtons(host, items);'), 'кнопки переноса конструктора — не общие');
		assert.ok(dialog.includes("keys.set(node, 'btn:' + (items[index].title || items[index].label));"), 'у кнопок переноса нет ключа возврата фокуса');
		assert.ok(script.includes("const node = el('button', 'ghost-btn dcs-qd-move', item.label);"), 'кнопки переноса — не знаки');
		// Пустые списки не ссылаются на подпись «Добавить»: у пиктограммы её не видно
		assert.ok(!/empty: '[^']*«Добавить»/.test(dialog), 'текст пустого списка называет «Добавить»');
		// …а называют кнопку её доступным именем: читалка и голосовая команда находят её, а знака «+» в имени нет
		const named = [...dialog.matchAll(/empty: '[^']*[Кк]нопка «([^»]+)» над списком/g)].map((m) => m[1]);
		assert.deepEqual(named, ['Добавить связь', 'Добавить индекс']);
		for (const name of named) {
			assert.ok(dialog.includes(`iconButton('add', '${name}', `), `текст пустого списка называет «${name}», а такой кнопки нет`);
		}
		assert.ok(!/empty: '[^']*«\+»/.test(dialog), 'текст пустого списка называет кнопку знаком «+»');
	});

	/** Пиктограммы панели над списком в порядке кнопок: [пиктограмма, название, обработчик]. */
	const toolbarOf = (signature: string): Array<[string, string, string]> => {
		const start = dialog.indexOf('\n\tfunction ' + signature);
		assert.ok(start >= 0, `нет function ${signature}`);
		const body = dialog.slice(start, dialog.indexOf('\n\t}\n', start));
		const toolbar = body.slice(0, body.indexOf('host.appendChild(toolbar);'));
		return [...toolbar.matchAll(/iconButton\('([\w-]+)', '([^']+)', \(\) => (\w+)\(/g)].map((m) => [m[1], m[2], m[3]] as [string, string, string]);
	};

	test('«Таблицы» и «Поля» — набор и порядок команд конфигуратора: добавить, (вложенный запрос), изменить, удалить', () => {
		assert.deepEqual(toolbarOf('renderTables(host, ctx) {'), [
			['add', 'Добавить таблицу', 'addTableFromDatabase'],
			['nested-query', 'Вложенный запрос…', 'nestedQuery'],
			['rename', 'Переименовать таблицу…', 'renameSelected'],
			['replace', 'Заменить таблицу', 'replaceSelected'],
			// Удаление — тем же, что «<» и Delete в списке
			['delete', 'Удалить выбранную таблицу', 'removeSelectedSource'],
		]);
		const tables = dialog.slice(dialog.indexOf('\n\tfunction renderTables(host, ctx) {'));
		assert.ok(tables.indexOf('toolbar.appendChild(paramsButton(ctx));') < tables.indexOf('host.appendChild(toolbar);'), 'параметры виртуальной таблицы — последними');
		assert.deepEqual(toolbarOf('renderFields(host, ctx) {'), [
			['add', 'Добавить поле-выражение…', 'expressionForField'],
			['edit', 'Изменить выражение выбранного поля…', 'expressionForField'],
			['delete', 'Удалить выбранное поле', 'removeSelectedField'],
			['up', 'Переместить поле выше', 'moveSelectedField'],
			['down', 'Переместить поле ниже', 'moveSelectedField'],
		]);
		// Ключи фокуса команд панели не совпадают с ключами «<» между списками (ключ — 'btn:' + название)
		assert.ok(dialog.includes("{ label: '<', title: 'Удалить выбранную таблицу из запроса',"));
		assert.ok(dialog.includes("{ label: '<', title: 'Удалить выбранное поле из «Полей»',"));
	});

	test('«Добавить таблицу» берёт таблицу дерева «База данных», поле дерева не переносит', () => {
		const start = dialog.indexOf('\n\tfunction addTableFromDatabase(ctx) {');
		assert.ok(start >= 0, 'нет addTableFromDatabase');
		const body = dialog.slice(start, dialog.indexOf('\n\t}\n', start) + 4);
		const added: string[] = [];
		const notes: string[] = [];
		const run = new Function('addFromDatabase', body + '\nreturn addTableFromDatabase;')((_ctx: unknown, key: string) => added.push(key)) as (ctx: unknown) => void;
		const ctx = (kind: string | null): unknown => ({
			dbInfo: new Map(kind ? [['k', { kind: kind }]] : []),
			state: { db: { selected: 'k' } },
			note: (text: string) => notes.push(text),
		});
		run(ctx('table'));
		run(ctx('object'));
		run(ctx(null));
		assert.deepEqual(added, ['k', 'k', 'k'], 'таблица, объект и пустой выбор — как у «>» (тот и объясняет, что выбрать)');
		run(ctx('field'));
		assert.deepEqual(added, ['k', 'k', 'k'], 'поле дерева в «Поля» не уходит');
		assert.deepEqual(notes, ['Выберите в дереве «База данных» таблицу: поле переносит «>».']);
	});

	test('названия команд короткие: подробность — второй строкой подсказки (note), а не в имени', () => {
		const names = [...dialog.matchAll(/iconButton\('[\w-]+', '([^']+)'/g)].map((m) => m[1]);
		assert.ok(names.length > 30, String(names.length));
		for (const name of names) {
			assert.ok(!/[(:]/.test(name), `название — фраза с пояснением: «${name}»`);
			assert.ok(name.length <= 45, `длинное название: «${name}»`);
		}
		for (const [name, note] of [
			['Вложенный запрос…', 'Изменить выбранный или создать новый'],
			['Переименовать таблицу…', 'Псевдоним и ссылки на него'],
			['Заменить таблицу', 'На таблицу, выбранную в дереве «База данных»'],
			['Добавить связь', 'Таблица без связей соединится с первой таблицей'],
			['Добавить условие…', 'Произвольное условие в окне выражения'],
			['Добавить условие…', 'Условие с параметром в окне выражения'],
			['Удалить колонку', 'Во всех частях объединения'],
		]) {
			assert.ok(new RegExp(`iconButton\\('[\\w-]+', '${name}',[\\s\\S]{0,1200}?\\{ note: '${note}' \\}\\)`).test(dialog), `«${name}»: нет пояснения «${note}»`);
		}
	});

	test('кнопки строки таблицы схемы — пиктограммы с именем и классами строки', () => {
		const start = script.indexOf('\n\tfunction actionsCell(tr, actions) {');
		assert.ok(start >= 0, 'нет actionsCell');
		const body = script.slice(start, script.indexOf('\n\t}\n', start) + 4);
		const helpers = icons();
		const el = (tag: string, className?: string, text?: string): IconNode => {
			const node = new IconNode(tag, '', className);
			if (text !== undefined) {
				node.textContent = text;
			}
			return node;
		};
		const actionsCell = new Function('el', 'iconButton', body + '\nreturn actionsCell;')(el, helpers.iconButton) as (tr: IconNode, actions: unknown[]) => void;
		const clicks: string[] = [];
		const tr = new IconNode('tr');
		actionsCell(tr, [
			{ svg: 'edit', title: 'Править', onClick: () => clicks.push('edit') },
			{ svg: 'delete', title: 'Удалить', danger: true, disabled: true, onClick: () => clicks.push('delete') },
		]);
		assert.equal(tr.children.length, 1);
		const td = tr.children[0];
		assert.equal(td.tagName, 'TD');
		assert.equal(td.className, 'dcs-cell-actions');
		const [edit, remove] = td.children as IconNode[];
		assert.equal(edit.tagName, 'BUTTON');
		assert.equal(edit.className, 'struct-btn dcs-icon-btn');
		assert.equal(edit.children[0].tagName, 'SVG');
		assert.equal(edit.getAttribute('aria-label'), 'Править', 'имя — название из title');
		assert.equal(edit.title, 'Править');
		assert.equal(edit.text(), '', 'видимого знака нет');
		assert.equal(edit.disabled, false);
		edit.click();
		assert.equal(remove.className, 'struct-btn struct-btn-danger dcs-icon-btn');
		assert.equal(remove.children[0].tagName, 'SVG');
		assert.equal(remove.getAttribute('aria-label'), 'Удалить');
		assert.equal(remove.disabled, true, 'disabled передаётся');
		assert.deepEqual(clicks, ['edit']);
	});

	test('вкладки схемы и «Настройки»: панель пиктограмм над таблицей вместо «+ Добавить …» под ней', () => {
		const section = (from: string, to: string): string => {
			const start = script.indexOf(from);
			const end = script.indexOf(to, start + from.length);
			assert.ok(start >= 0 && end > start, `нет ${from}`);
			return script.slice(start, end);
		};
		for (const [from, to, name] of [
			['\tfunction renderLinks(host) {', '\tfunction openLinkDialog(', 'Добавить связь…'],
			['\tfunction renderCalculated(host) {', '\tfunction openCalculatedDialog(', 'Добавить вычисляемое поле…'],
			['\tfunction renderResources(host) {', '\tfunction openTotalFieldDialog(', 'Добавить ресурс…'],
			['\tfunction renderParameters(host) {', '\tfunction openParameterDialog(', 'Добавить параметр…'],
			['\tfunction renderFieldsTable(host, dataSet, readOnly) {', '\tfunction fieldRow(', 'Добавить поле…'],
		]) {
			const body = section(from, to);
			assert.ok(body.includes(`{ icon: 'add', name: '${name}', onClick:`), `${from}: нет «${name}» над таблицей`);
			// У «Ресурсов» панель — над таблицей в правой колонке (right), у остальных — над таблицей вкладки
			const toolbar = body.includes('listToolbar(right, ') ? 'listToolbar(right, ' : 'listToolbar(host, ';
			assert.ok(body.includes(toolbar), `${from}: нет панели`);
			assert.ok(!body.includes('addButton('), `${from}: кнопка «+ …» под таблицей`);
			// Панель — до таблицы
			const table = body.indexOf('dataTable(host') >= 0 ? body.indexOf('dataTable(host') : body.indexOf("el('table'");
			assert.ok(body.lastIndexOf(toolbar) < table, `${from}: панель не над таблицей`);
		}
		for (const [from, to] of [
			['\tfunction fieldRow(', '\tfunction restrictionCells('],
			['\tfunction renderLinks(host) {', '\tfunction openLinkDialog('],
			['\tfunction renderCalculated(host) {', '\tfunction openCalculatedDialog('],
			['\tfunction renderResources(host) {', '\tfunction openTotalFieldDialog('],
			['\tfunction renderParameters(host) {', '\tfunction openParameterDialog('],
		]) {
			const body = section(from, to);
			assert.ok(body.includes("svg: 'edit',") && body.includes("svg: 'delete',"), `${from}: кнопки строки без пиктограмм`);
		}
		// Дерево наборов: переименование и удаление — пиктограммы, недоступны через disabled
		const tree = section('\tfunction renderDataSetTree(host) {', '\tfunction appendSetRows(');
		assert.ok(tree.includes("icon: 'rename'") && tree.includes("icon: 'delete'"), 'кнопки дерева наборов без пиктограмм');
		// Клавиша дерева — в подсказке (shortcut), а не в доступном имени кнопки
		assert.ok(/name: 'Переименовать выбранный набор',\n\t+shortcut: 'F2',/.test(tree), 'F2 — не через shortcut');
		assert.ok(/name: 'Удалить выбранный набор',\n\t+shortcut: 'Delete',/.test(tree), 'Delete — не через shortcut');
		assert.ok(!/name: '[^']*\((F2|Delete)\)'/.test(tree), 'клавиша в доступном имени');
		assert.ok(!tree.includes("'✎'") && !tree.includes("'×'"), 'знаки ✎ × вместо пиктограмм');
		assert.equal((tree.match(/disabled: !topName,/g) || []).length, 2);
		// «Настройки»: кнопок «+ …» под таблицами нет, команды над списками — пиктограммы
		assert.ok(!script.includes('function addButton('), 'кнопка «+ …» под таблицей');
		for (const [from, to, name] of [
			['\tfunction renderGroupFieldsPanel(host, node, path, variantName) {', '\tfunction openGroupFieldDialog(', 'Добавить поле…'],
			['\tfunction renderAppearancePanel(host, node, path, variantName) {', '\t/** Оформляемые поля', 'Добавить оформление…'],
		]) {
			const body = section(from, to);
			assert.ok(body.includes(`listToolbar(host, [\n\t\t\t{\n\t\t\t\ticon: 'add',\n\t\t\t\tname: '${name}',`), `${from}: нет «${name}» над списком`);
			assert.ok(body.indexOf('listToolbar(host') < body.indexOf('dataTable(host'), `${from}: панель не над таблицей`);
		}
		for (const [from, to] of [
			['\tfunction renderSelectionPanel(host, node, path, variantName) {', '\tfunction moveSelItem('],
			['\tfunction renderOrderPanel(host, node, path, variantName) {', '\tfunction openOrderFieldDialog('],
			['\tfunction renderFilterPanel(host, node, path, variantName) {', '\t/**\n\t * Мини-редактор отбора'],
		]) {
			const body = section(from, to);
			assert.ok(body.includes('settingsListToolbar(right, ') && body.includes('settingsListGrid(right, {'), `${from}: нет панели и сетки списка`);
			assert.ok(!body.includes('struct-add-btn'), `${from}: кнопка «+ …» под списком`);
		}
	});

	test('стили: линии цветом текста, без заливки; разметка окна без inline-стилей', () => {
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const rule = (selector: string): string => {
			const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1].split(',').some((s) => s.trim() === selector));
			assert.ok(found, `нет правила ${selector}`);
			return found[2];
		};
		assert.match(rule('.dcs-icon'), /stroke:\s*currentColor/);
		assert.match(rule('.dcs-icon'), /fill:\s*none/);
		assert.match(rule('.dcs-icon'), /width:\s*16px/);
		assert.match(rule('.dcs-icon-btn'), /display:\s*inline-flex/);
		assert.match(rule('.dcs-list-toolbar'), /display:\s*flex/);
		const html = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.html'), 'utf8');
		const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
		assert.ok(csp, 'нет CSP');
		assert.ok(!csp[1].includes('unsafe-inline') && !csp[1].includes('img-src'), csp[1]);
	});
});

describe('Строка-подсказка у фокуса с клавиатуры: название пиктограммы и обрезанной вкладки видно не только мыши', () => {
	const script = readEditorScript();

	/** Узел-заглушка: класс, текст, атрибуты, title и :focus-visible. */
	class HintNode {
		className = '';
		textContent = '';
		title = '';
		style: Record<string, string> = {};
		focusVisible = true;
		parent: HintNode | null = null;
		private readonly attributes = new Map<string, string>();
		constructor(className = '') {
			this.className = className;
		}
		get classList(): { contains(name: string): boolean; add(name: string): void; toggle(name: string, on: boolean): void } {
			const names = (): Set<string> => new Set(this.className.split(/\s+/).filter(Boolean));
			return {
				contains: (name) => names().has(name),
				add: (name) => {
					this.className = [...names(), name].join(' ');
				},
				toggle: (name, on) => {
					const set = names();
					if (on) {
						set.add(name);
					} else {
						set.delete(name);
					}
					this.className = [...set].join(' ');
				},
			};
		}
		setAttribute(name: string, value: string): void {
			this.attributes.set(name, value);
		}
		getAttribute(name: string): string | null {
			return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
		}
		matches(selector: string): boolean {
			return selector === ':focus-visible' && this.focusVisible;
		}
		closest(selector: string): HintNode | null {
			for (let node: HintNode | null = this; node; node = node.parent) {
				if (selector.startsWith('.') && node.classList.contains(selector.slice(1))) {
					return node;
				}
			}
			return null;
		}
	}

	test('фокус с клавиатуры на пиктограмму — первая строка её подсказки; щелчок мышью, уход фокуса и обычная кнопка — строки нет', () => {
		const start = script.indexOf('// ---------- строка-подсказка у фокуса с клавиатуры');
		const end = script.indexOf('// ---------- плашка итогов: автозаполнение и проверка схемы ----------');
		assert.ok(start > 0 && end > start, 'нет раздела строки-подсказки');
		const listeners: Record<string, (event?: unknown) => void> = {};
		const body: HintNode[] = [];
		const factory = new Function('el', 'document', 'dialogRules', script.slice(start, end) + '\nreturn focusHint;') as (...args: unknown[]) => HintNode;
		const hint = factory(
			(_tag: string, className: string) => new HintNode(className),
			{
				body: { appendChild: (node: HintNode) => body.push(node) },
				addEventListener: (type: string, listener: (event?: unknown) => void) => {
					listeners[type] = listener;
				},
			},
			{ POPUP_Z_INDEX: 38 }
		);
		assert.equal(body[0], hint, 'строка не в документе');
		assert.equal(hint.getAttribute('aria-hidden'), 'true', 'читалка услышала бы имя дважды');
		assert.equal(hint.style.zIndex, '39', 'строку закрыли бы окна стека');
		assert.ok(hint.classList.contains('hidden'));
		const icon = new HintNode('ghost-btn dcs-btn-small dcs-icon-btn');
		icon.title = 'Удалить (Delete)\nНедоступно: строка не выбрана.';
		listeners.focusin({ target: icon });
		assert.equal(hint.textContent, 'Удалить (Delete)');
		assert.ok(!hint.classList.contains('hidden'));
		listeners.focusout();
		assert.equal(hint.textContent, '');
		assert.ok(hint.classList.contains('hidden'));
		// Фокус щелчком (без :focus-visible) — мышь и так видит title
		icon.focusVisible = false;
		listeners.focusin({ target: icon });
		assert.ok(hint.classList.contains('hidden'));
		// Вертикальная вкладка конструктора запроса с обрезанным именем — полное имя
		const strip = new HintNode('dcs-qd-vtabs');
		const tab = new HintNode('tab');
		tab.parent = strip;
		tab.setAttribute('role', 'tab');
		tab.title = 'Запрос пакета 1: временная таблица ВТ_ОстаткиТоваровНаСкладах';
		listeners.focusin({ target: tab });
		assert.equal(hint.textContent, tab.title);
		// Нажатие мыши прячет строку; кнопка с подписью строки не даёт
		listeners.pointerdown();
		assert.ok(hint.classList.contains('hidden'));
		const plain = new HintNode('ghost-btn');
		plain.title = 'Проверить схему';
		listeners.focusin({ target: plain });
		assert.ok(hint.classList.contains('hidden'));
		const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8');
		assert.match(css, /\.dcs-focus-hint \{[^}]*position: fixed;[^}]*pointer-events: none;/);
	});
});

describe('Классы редактора и окна конструктора запроса лежат в стилях', () => {
	// Литерал в одинарных кавычках со словом dcs-… делится по пробелам; у каждого имени на dcs- в стилях должна быть
	// подстрока «.имя». Поэтому строки на dcs-, которые не классы (вид переносимой строки), и имена классов с
	// пунктуацией в комментариях ей мешают.
	const css = fs.readFileSync(path.join(WEBVIEW, 'dcs-editor.css'), 'utf8');
	for (const name of [...DCS_EDITOR_PARTS, 'dcs-editor-query-dialog.js']) {
		test(name, () => {
			const script = fs.readFileSync(path.join(WEBVIEW, name), 'utf8');
			const classes = new Set(
				[...script.matchAll(/'([^']*\bdcs-[^']*)'/g)].flatMap((match) => match[1].split(/\s+/)).filter((cls) => cls.startsWith('dcs-'))
			);
			assert.ok(classes.size > 0, 'классы не разобраны');
			const missing = [...classes].filter((cls) => !css.includes(`.${cls}`));
			assert.deepEqual(missing, [], `нет оформления: ${missing.join(', ')}`);
		});
	}

	test('пометки строк «Связей» — с рамкой предупреждения, предупреждения о списке значений в окне — с отступом', () => {
		const flat = css.replace(/\r\n/g, '\n');
		assert.match(flat, /\.dcs-link-required-mark,\n\.dcs-link-list-flag-mark \{\n\toutline: 1px solid var\(--vscode-editorWarning-foreground/);
		assert.match(flat, /\.dcs-dialog-body \.dcs-list-nil-warn,\n\.dcs-dialog-body \.dcs-list-presentation-warn \{\n\tmargin: 4px 0;/);
	});
});
