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
 * Значок заимствования: буква в кружке в правом верхнем углу пиктограммы.
 *
 * Доли, а не координаты: пиктограммы нарисованы в двух системах координат, и значок должен встать
 * в угол любой из них.
 */
const BADGE_GEOMETRY = {
	centerX: 0.771,
	centerY: 0.229,
	radius: 0.177,
	stroke: 0.042,
	fontSize: 0.313,
	baseline: 0.338,
} as const;

/** Виды значков: буквенный у заимствованных, замочек у запрещённых к изменению. */
const BADGE_KINDS = {
	adopted: { color: '#E1B74D', letter: '&#1040;' },
	locked: { color: '#8A8A8A', letter: '' },
} as const;

type BadgeKind = keyof typeof BADGE_KINDS;

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
	return composeBadgeSvg(baseSvg, 'adopted');
}

function composeBadgeSvg(baseSvg: string, kind: BadgeKind): string {
	const box = viewBox(baseSvg);
	const close = baseSvg.lastIndexOf('</svg>');
	if (!box || close < 0) {
		return baseSvg;
	}
	const paint = BADGE_KINDS[kind];
	const cx = box.x + box.width * BADGE_GEOMETRY.centerX;
	const cy = box.y + box.height * BADGE_GEOMETRY.centerY;
	const badge =
		kind === 'locked'
			? lockBadgeSvg(box, cx, cy, paint.color)
			: `\t<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(box.width * BADGE_GEOMETRY.radius)}"` +
				` fill="none" stroke="${paint.color}" stroke-width="${round(box.width * BADGE_GEOMETRY.stroke)}"/>\n` +
				`\t<text x="${round(cx)}" y="${round(box.y + box.height * BADGE_GEOMETRY.baseline)}" text-anchor="middle"` +
				` font-size="${round(box.width * BADGE_GEOMETRY.fontSize)}" font-family="Segoe UI, Arial, sans-serif"` +
				` fill="${paint.color}">${paint.letter}</text>\n`;
	return baseSvg.slice(0, close) + badge + baseSvg.slice(close);
}

/** Маленький замочек: дужка и корпус в углу пиктограммы, приглушённый серый. */
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

/** Путь готовой пиктограммы со значком; пусто, если составить её не удалось. */
function composedIconPath(
	cacheDir: string,
	variant: 'light' | 'dark',
	baseFsPath: string,
	kind: BadgeKind
): string | undefined {
	const cacheKey = `${kind} ${baseFsPath}`;
	if (composedIcons.has(cacheKey)) {
		return composedIcons.get(cacheKey);
	}
	let composed: string | undefined;
	try {
		const target = path.join(cacheDir, kind, variant, path.basename(baseFsPath));
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, composeBadgeSvg(fs.readFileSync(baseFsPath, 'utf8'), kind), 'utf8');
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
	return badgedIcon(base, 'adopted');
}

/** Пиктограмма с замочком: объект на поддержке поставщика, изменение запрещено. */
export function lockedIcon(base: ThemedIcon): ThemedIcon {
	return badgedIcon(base, 'locked');
}

function badgedIcon(base: ThemedIcon, kind: BadgeKind): ThemedIcon {
	const cacheDir = iconCacheDir;
	if (cacheDir === undefined) {
		return base;
	}
	const light = composedIconPath(cacheDir, 'light', base.light.fsPath, kind);
	const dark =
		base.dark.fsPath === base.light.fsPath
			? light
			: composedIconPath(cacheDir, 'dark', base.dark.fsPath, kind);
	if (light === undefined || dark === undefined) {
		return base;
	}
	return { light: vscode.Uri.file(light), dark: vscode.Uri.file(dark) };
}
