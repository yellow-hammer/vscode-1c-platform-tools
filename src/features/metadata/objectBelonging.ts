/**
 * Принадлежность объекта расширения: собственный он или заимствованный.
 *
 * Заимствованный объект живёт по правилам расширяемой конфигурации, поэтому в дереве он помечается
 * значком поверх пиктограммы, а редактирование состава ему недоступно. Признак приходит от
 * md-sparrow, и разные его операции пишут значение по-разному, поэтому сравнение здесь одно на всех.
 *
 * @module objectBelonging
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../../shared/logger';

/** Пара пиктограмм для светлой и тёмной темы. */
export type ThemedIcon = { readonly light: vscode.Uri; readonly dark: vscode.Uri };

/** Подсказка к заимствованному объекту в дереве. */
export const ADOPTED_HINT = 'Заимствован из расширяемой конфигурации';

/** Объект заимствован из расширяемой конфигурации. */
export function isAdopted(objectBelonging: unknown): boolean {
	return typeof objectBelonging === 'string' && objectBelonging.toLowerCase() === 'adopted';
}

/**
 * Углы для значков: доли, а не координаты. Пиктограммы нарисованы в двух системах координат,
 * и значок должен встать в угол любой из них.
 */
const BADGE_GEOMETRY = {
	centerX: 0.771,
	centerY: 0.229,
	radius: 0.24,
	stroke: 0.063,
	letterHeight: 0.23,
	letterWidth: 0.19,
} as const;

/** Левый нижний угол: там стоит признак поддержки, чтобы не спорить с замком. */
const SUPPORT_GEOMETRY = {
	centerX: 0.208,
	centerY: 0.792,
	side: 0.313,
	radius: 0.042,
} as const;

/** Правый нижний угол: запрет изменения конфигурации целиком. */
const EDITING_OFF_GEOMETRY = {
	centerX: 0.792,
	centerY: 0.792,
	radius: 0.208,
	bar: 0.229,
	stroke: 0.063,
} as const;

/**
 * Виды значков.
 *
 * Признаки независимы и складываются: объект на поддержке несёт бледный квадрат слева снизу,
 * а запрет изменения - янтарный замок справа сверху. Мелкие значки различают по месту и цвету,
 * а не по форме дужки.
 */
const BADGE_KINDS = {
	adopted: { color: '#E1B74D' },
	locked: { color: '#E8952D' },
	support: { color: '#D8C68A' },
	// Запрет читается сразу, поэтому цвет свой на каждую тему
	editingOff: { color: '#C0392B', darkColor: '#E05B4D' },
} as const;

type BadgeKind = keyof typeof BADGE_KINDS;

/** Тема пиктограммы: от неё зависит подложка под замком. */
export type IconTheme = 'light' | 'dark';

/**
 * Подложка под замком - кружок цвета панели.
 *
 * Пиктограммы монохромные, всего два серых, поэтому любой цвет значка рано или поздно садится
 * на заливку того же тона. Кольцо фона отделяет замок от пиктограммы при любом её рисунке.
 */
const BADGE_BACKING: Readonly<Record<IconTheme, string>> = {
	light: '#F3F3F3',
	dark: '#252526',
};

/** Подсказки к режимам поддержки в дереве. */
export const SUPPORT_HINTS: Readonly<Record<'editable' | 'locked', string>> = {
	editable: 'На поддержке поставщика, изменение разрешено',
	locked: 'На поддержке поставщика, изменение запрещено',
};

/** Размеры холста пиктограммы из `viewBox`. */
function viewBox(svg: string): { x: number; y: number; width: number; height: number } | undefined {
	const parts = /viewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*"/.exec(svg);
	if (!parts) {
		return undefined;
	}
	const [x, y, width, height] = parts.slice(1, 5).map(Number);
	return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/** Число для координаты SVG: без хвоста незначащих нулей. */
function round(value: number): string {
	return String(Math.round(value * 100) / 100);
}

/**
 * Накладывает значок заимствования на пиктограмму.
 *
 * @param baseSvg Разметка исходной пиктограммы
 * @returns Разметка со значком либо исходная, если холст пиктограммы разобрать не удалось
 */
export function composeAdoptedSvg(baseSvg: string): string {
	return composeBadgeSvg(baseSvg, ['adopted'], 'light');
}

/**
 * Накладывает значки на пиктограмму.
 *
 * @param kinds Виды значков; каждый стоит в своём углу, поэтому складываются без наложения
 * @param theme Тема пиктограммы: от неё зависит цвет подложки под замком
 */
export function composeBadgeSvg(baseSvg: string, kinds: readonly BadgeKind[], theme: IconTheme): string {
	const box = viewBox(baseSvg);
	const close = baseSvg.lastIndexOf('</svg>');
	if (!box || close < 0 || kinds.length === 0) {
		return baseSvg;
	}
	const badges = kinds.map((kind) => badgeSvg(box, kind, theme)).join('');
	return baseSvg.slice(0, close) + badges + baseSvg.slice(close);
}

function badgeSvg(
	box: { x: number; y: number; width: number; height: number },
	kind: BadgeKind,
	theme: IconTheme
): string {
	const paint = BADGE_KINDS[kind];
	const color = theme === 'dark' && 'darkColor' in paint ? paint.darkColor : paint.color;
	if (kind === 'support') {
		const side = box.width * SUPPORT_GEOMETRY.side;
		const x = box.x + box.width * SUPPORT_GEOMETRY.centerX - side / 2;
		const y = box.y + box.height * SUPPORT_GEOMETRY.centerY - side / 2;
		return (
			`\t<rect x="${round(x)}" y="${round(y)}" width="${round(side)}" height="${round(side)}"` +
			` rx="${round(box.width * SUPPORT_GEOMETRY.radius)}" fill="${paint.color}"/>\n`
		);
	}
	if (kind === 'editingOff') {
		const centerX = box.x + box.width * EDITING_OFF_GEOMETRY.centerX;
		const centerY = box.y + box.height * EDITING_OFF_GEOMETRY.centerY;
		const radius = box.width * EDITING_OFF_GEOMETRY.radius;
		const bar = box.width * EDITING_OFF_GEOMETRY.bar / 2;
		return (
			`	<circle cx="${round(centerX)}" cy="${round(centerY)}" r="${round(radius)}"` +
			` fill="${color}" stroke="${BADGE_BACKING[theme]}"` +
			` stroke-width="${round(box.width * EDITING_OFF_GEOMETRY.stroke)}"/>
` +
			`	<path d="M ${round(centerX - bar)} ${round(centerY + bar)}` +
			` L ${round(centerX + bar)} ${round(centerY - bar)}"` +
			` stroke="${BADGE_BACKING[theme]}" stroke-width="${round(box.width * EDITING_OFF_GEOMETRY.stroke)}"` +
			` stroke-linecap="round" fill="none"/>
`
		);
	}
	const cx = box.x + box.width * BADGE_GEOMETRY.centerX;
	const cy = box.y + box.height * BADGE_GEOMETRY.centerY;
	if (kind === 'locked') {
		return (
			`\t<circle cx="${round(cx)}" cy="${round(cy + box.width * 0.06)}"` +
			` r="${round(box.width * 0.26)}" fill="${BADGE_BACKING[theme]}"/>\n` +
			lockBadgeSvg(box, cx, cy, paint.color)
		);
	}
	// Заимствование: залитый кружок с буквой, вырезанной цветом панели. Тонкий
	// контур с текстом в размере дерева не читался
	const half = (box.width * BADGE_GEOMETRY.letterHeight) / 2;
	const side = (box.width * BADGE_GEOMETRY.letterWidth) / 2;
	return (
		`\t<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(box.width * BADGE_GEOMETRY.radius)}"` +
		` fill="${paint.color}" stroke="${BADGE_BACKING[theme]}"` +
		` stroke-width="${round(box.width * BADGE_GEOMETRY.stroke)}"/>\n` +
		`\t<path d="M ${round(cx - side)} ${round(cy + half)} L ${round(cx)} ${round(cy - half)}` +
		` L ${round(cx + side)} ${round(cy + half)} M ${round(cx - side * 0.62)} ${round(cy + half * 0.3)}` +
		` L ${round(cx + side * 0.62)} ${round(cy + half * 0.3)}"` +
		` fill="none" stroke="${BADGE_BACKING[theme]}" stroke-width="${round(box.width * 0.055)}"` +
		` stroke-linecap="round" stroke-linejoin="round"/>\n`
	);
}

/** Маленький замок: дужка и корпус в правом верхнем углу пиктограммы. */
function lockBadgeSvg(
	box: { x: number; y: number; width: number; height: number },
	cx: number,
	cy: number,
	color: string
): string {
	const w = box.width;
	const bodyW = w * 0.3;
	const bodyH = w * 0.22;
	const bodyX = cx - bodyW / 2;
	const bodyY = cy - w * 0.02;
	const shackleR = w * 0.09;
	const stroke = w * 0.05;
	return (
		`\t<path d="M ${round(cx - shackleR)} ${round(bodyY)} v ${round(-w * 0.06)}` +
		` a ${round(shackleR)} ${round(shackleR)} 0 0 1 ${round(shackleR * 2)} 0 v ${round(w * 0.06)}"` +
		` fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>\n` +
		`\t<rect x="${round(bodyX)}" y="${round(bodyY)}" width="${round(bodyW)}" height="${round(bodyH)}"` +
		` rx="${round(w * 0.04)}" fill="${color}"/>\n`
	);
}

/** Каталог для составленных пиктограмм; до вызова из дерева значок не накладывается. */
let iconCacheDir: string | undefined;

/** Составленные за сеанс пиктограммы: путь исходной -> путь готовой либо пусто, если не вышло. */
const composedIcons = new Map<string, string | undefined>();

/**
 * Включает пометку заимствованных объектов в дереве.
 *
 * Дерево показывает пиктограмму только файлом, поэтому составленная разметка кладётся в каталог
 * расширения. Файлы пишутся заново на каждый сеанс: так они не отстают от пиктограмм после
 * обновления расширения.
 *
 * @param cacheDir Каталог для составленных пиктограмм
 */
export function initAdoptedIcons(cacheDir: string): void {
	iconCacheDir = cacheDir;
	composedIcons.clear();
}

/** Путь готовой пиктограммы со значками; пусто, если составить её не удалось. */
function composedIconPath(
	cacheDir: string,
	variant: IconTheme,
	baseFsPath: string,
	kinds: readonly BadgeKind[]
): string | undefined {
	const suffix = kinds.join('-');
	// Тема в ключе: подложка под замком у светлой и тёмной разная, даже когда
	// пиктограмма у них одна
	const cacheKey = `${suffix} ${variant} ${baseFsPath}`;
	if (composedIcons.has(cacheKey)) {
		return composedIcons.get(cacheKey);
	}
	let composed: string | undefined;
	try {
		const target = path.join(cacheDir, suffix, variant, path.basename(baseFsPath));
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, composeBadgeSvg(fs.readFileSync(baseFsPath, 'utf8'), kinds, variant), 'utf8');
		composed = target;
	} catch (error) {
		logger.warn(`Не удалось пометить пиктограмму значком: ${String(error)}`);
	}
	composedIcons.set(cacheKey, composed);
	return composed;
}

/**
 * Пиктограмма со значком заимствования.
 *
 * @param base Пиктограмма объекта
 * @returns Пиктограмма со значком либо исходная, если составить её не удалось
 */
export function adoptedIcon(base: ThemedIcon): ThemedIcon {
	return badgedIcon(base, ['adopted']);
}

/**
 * Пиктограмма с признаками поддержки: бледный квадрат слева снизу говорит, что объект на
 * поддержке, серый замок справа сверху - что изменение запрещено.
 *
 * @param support Действующее правило узла: {@code locked} либо {@code editable}
 */
export function supportIcon(base: ThemedIcon, support: string, editingOff = false): ThemedIcon {
	const kinds: BadgeKind[] = [];
	if (support === 'locked' || support === 'editable' || editingOff) {
		kinds.push('support');
	}
	if (support === 'locked') {
		kinds.push('locked');
	}
	if (editingOff) {
		kinds.push('editingOff');
	}
	return kinds.length > 0 ? badgedIcon(base, kinds) : base;
}

function badgedIcon(base: ThemedIcon, kinds: readonly BadgeKind[]): ThemedIcon {
	const cacheDir = iconCacheDir;
	if (cacheDir === undefined) {
		return base;
	}
	const light = composedIconPath(cacheDir, 'light', base.light.fsPath, kinds);
	const dark = composedIconPath(cacheDir, 'dark', base.dark.fsPath, kinds);
	if (light === undefined || dark === undefined) {
		return base;
	}
	return { light: vscode.Uri.file(light), dark: vscode.Uri.file(dark) };
}
