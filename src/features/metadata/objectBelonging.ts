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
const BADGE = {
	centerX: 0.771,
	centerY: 0.229,
	radius: 0.177,
	stroke: 0.042,
	fontSize: 0.313,
	baseline: 0.338,
	color: '#E1B74D',
	/** Сущностью, а не буквой: разметка значка не зависит от кодировки, в которой её прочтут. */
	letter: '&#1040;',
} as const;

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
	const box = viewBox(baseSvg);
	const close = baseSvg.lastIndexOf('</svg>');
	if (!box || close < 0) {
		return baseSvg;
	}
	const cx = box.x + box.width * BADGE.centerX;
	const cy = box.y + box.height * BADGE.centerY;
	const badge =
		`\t<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(box.width * BADGE.radius)}"` +
		` fill="none" stroke="${BADGE.color}" stroke-width="${round(box.width * BADGE.stroke)}"/>\n` +
		`\t<text x="${round(cx)}" y="${round(box.y + box.height * BADGE.baseline)}" text-anchor="middle"` +
		` font-size="${round(box.width * BADGE.fontSize)}" font-family="Segoe UI, Arial, sans-serif"` +
		` fill="${BADGE.color}">${BADGE.letter}</text>\n`;
	return baseSvg.slice(0, close) + badge + baseSvg.slice(close);
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
function composedIconPath(cacheDir: string, variant: 'light' | 'dark', baseFsPath: string): string | undefined {
	if (composedIcons.has(baseFsPath)) {
		return composedIcons.get(baseFsPath);
	}
	let composed: string | undefined;
	try {
		const target = path.join(cacheDir, variant, path.basename(baseFsPath));
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, composeAdoptedSvg(fs.readFileSync(baseFsPath, 'utf8')), 'utf8');
		composed = target;
	} catch (error) {
		logger.warn(`Не удалось пометить пиктограмму заимствованного объекта: ${String(error)}`);
	}
	composedIcons.set(baseFsPath, composed);
	return composed;
}

/**
 * Пиктограмма со значком заимствования.
 *
 * @param base Пиктограмма объекта
 * @returns Пиктограмма со значком либо исходная, если составить её не удалось
 */
export function adoptedIcon(base: ThemedIcon): ThemedIcon {
	const cacheDir = iconCacheDir;
	if (cacheDir === undefined) {
		return base;
	}
	const light = composedIconPath(cacheDir, 'light', base.light.fsPath);
	const dark =
		base.dark.fsPath === base.light.fsPath ? light : composedIconPath(cacheDir, 'dark', base.dark.fsPath);
	if (light === undefined || dark === undefined) {
		return base;
	}
	return { light: vscode.Uri.file(light), dark: vscode.Uri.file(dark) };
}
