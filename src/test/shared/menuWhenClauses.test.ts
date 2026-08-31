import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

interface MenuEntry {
	command?: string;
	when?: string;
	group?: string;
}

/**
 * Операторы when-условий, которые понимает VS Code.
 *
 * Обратного сравнения с регулярным выражением (`!~`) среди них нет: условие с
 * ним не разбирается целиком, и пункт становится видимым во всех деревьях.
 * Обратное условие выражается признаком в contextValue узла.
 */
const OPERATORS = new Set(['==', '!=', '=~', '>=', '<=', '>', '<', '!']);

function manifest(): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as Record<
		string,
		unknown
	>;
}

/** Все условия видимости манифеста: меню, представления, шаги обучения. */
function allWhenClauses(): string[] {
	const found: string[] = [];
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) {
			value.forEach(walk);
			return;
		}
		if (typeof value !== 'object' || value === null) {
			return;
		}
		for (const [key, nested] of Object.entries(value)) {
			if (key === 'when' && typeof nested === 'string') {
				found.push(nested);
			} else {
				walk(nested);
			}
		}
	};
	walk(manifest());
	return found;
}

/**
 * Операторы условия.
 *
 * Регулярные выражения вырезаются: внутри них те же символы, что у операторов.
 *
 * @param when - Условие из манифеста
 * @returns Найденные последовательности операторных символов
 */
function operatorsOf(when: string): string[] {
	const withoutRegex = when.replace(/\/(?:[^/\\]|\\.)*\//g, ' ');
	return withoutRegex.match(/[=!<>~]+/g) ?? [];
}

/** Пункты контекстных меню деревьев. */
function treeItemMenus(): MenuEntry[] {
	const contributes = manifest().contributes as { menus: Record<string, MenuEntry[]> };
	return contributes.menus['view/item/context'] ?? [];
}

suite('условия видимости в манифесте', () => {
	test('операторы только из числа поддерживаемых', () => {
		const wrong: string[] = [];
		for (const when of allWhenClauses()) {
			for (const operator of operatorsOf(when)) {
				if (!OPERATORS.has(operator)) {
					wrong.push(`${operator} в условии: ${when}`);
				}
			}
		}
		assert.deepStrictEqual(wrong, [], `неизвестные операторы:\n${wrong.join('\n')}`);
	});

	test('скобки закрыты', () => {
		// Условие с ошибкой VS Code не разбирает и показывает пункт всегда, поэтому
		// опечатка видна не сразу — только лишними пунктами в чужих панелях.
		const broken = allWhenClauses().filter((when) => {
			const withoutRegex = when.replace(/\/(?:[^/\\]|\\.)*\//g, ' ');
			let depth = 0;
			for (const character of withoutRegex) {
				if (character === '(') {
					depth += 1;
				} else if (character === ')') {
					depth -= 1;
				}
				if (depth < 0) {
					return true;
				}
			}
			return depth !== 0;
		});
		assert.deepStrictEqual(broken, [], `условия с непарными скобками:\n${broken.join('\n')}`);
	});
});

suite('условия показа пунктов в деревьях', () => {
	test('пункт называет своё представление', () => {
		// Без `view ==` пункт одного дерева появляется в остальных: контекст узла
		// (viewItem) у разных панелей может совпасть случайно.
		const without = treeItemMenus()
			.filter((entry) => !/(^|\s|\()view\s*==/.test(entry.when ?? ''))
			.map((entry) => entry.command ?? '(без команды)');
		assert.deepStrictEqual(without, [], `пункты без ограничения по представлению: ${without.join(', ')}`);
	});

	test('отрицание не стоит рядом с ветвлением', () => {
		// Условие вида `view == X && ((A && B) || C)` с отрицанием внутри скобок
		// разбирается ненадёжно. Варианты разносятся по отдельным пунктам меню,
		// чтобы каждое условие осталось конъюнкцией.
		const risky = treeItemMenus()
			.filter((entry) => /\|\|/.test(entry.when ?? '') && /(!~|!=|!\w)/.test(entry.when ?? ''))
			.map((entry) => `${entry.command ?? '(без команды)'}: ${entry.when}`);
		assert.deepStrictEqual(risky, [], `условия с отрицанием и ветвлением:\n${risky.join('\n')}`);
	});
});
