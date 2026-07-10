import { VRUNNER_SCHEMA, HOOKS_SCHEMA } from './schemaUrls';

/** Базовые поля секции default, общие для всех env-файлов */
const DEFAULT_SECTION = {
	'--ibconnection': '/F./build/ib',
	'--db-user': '',
	'--db-pwd': '',
	'--root': '.',
	'--workspace': '.',
	'--v8version': '8.3',
	'--locale': 'ru',
	'--language': 'ru',
};

/** Канонический дефолт env.json */
export const ENV_DEFAULTS = {
	$schema: VRUNNER_SCHEMA,
	default: {
		...DEFAULT_SECTION,
		'--additional': '/DisplayAllFunctions /L ru',
		'--ordinaryapp': '-1',
	},
};

/**
 * Канонический дефолт autumn-properties.json (формат vanessa-runner 3.0).
 *
 * Рукописный v3-шаблон (не конвертация env.json): vanessa-runner 3 — отдельный
 * инструмент со своим форматом, каскад `vrunner.<команда>.<опция>`, глобальные
 * опции на `vrunner.<опция>`. Перенос существующих настроек 2.x выполняет сам
 * пользователь официальным `tools/migrate26to30.os` из состава vanessa-runner.
 */
export const AUTUMN_DEFAULTS = {
	vrunner: {
		ibconnection: '/F./build/ib',
		'db-user': '',
		'db-pwd': '',
		root: '.',
		workspace: '.',
		v8version: '8.3',
		locale: 'ru',
		language: 'ru',
		additional: '/DisplayAllFunctions /L ru',
		ordinaryapp: '-1',
	},
};

const VANESSA_ADDITIONAL = '/DisplayAllFunctions /L ru';

/** Канонический дефолт tools/vrunner.json */
export const VRUNNER_DEFAULTS = {
	$schema: VRUNNER_SCHEMA,
	default: {
		...DEFAULT_SECTION,
		'--ordinaryapp': '0',
	},
	vanessa: {
		'--vanessasettings': './tools/VAParams.json',
		'--pathvanessa': './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf',
		'--additional': VANESSA_ADDITIONAL,
	},
};

/** Канонический дефолт tools/vrunner.init.json */
export const VRUNNER_INIT_DEFAULTS = {
	$schema: VRUNNER_SCHEMA,
	default: {
		...DEFAULT_SECTION,
		'--ordinaryapp': '0',
	},
	vanessa: {
		'--vanessasettings': './tools/VAParams.init.json',
		'--pathvanessa': './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf',
		'--additional': VANESSA_ADDITIONAL,
	},
};

/** Пинованная обработка Vanessa (проектный single-файл) для CI-прогонов. */
const CI_BDDRUNNER_PATH = './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf';

/**
 * CI-файлы vanessa-runner 3 повторяют формат основного профиля (autumn): та же
 * база `AUTUMN_DEFAULTS.vrunner` + секция `test.vanessa` со своим файлом
 * параметров VA. Отличие vrunner.json / vrunner.init.json — только vanessasettings.
 */
export const VRUNNER_DEFAULTS_V3 = {
	vrunner: {
		...AUTUMN_DEFAULTS.vrunner,
		test: {
			vanessa: {
				vanessasettings: './tools/VAParams.json',
				'bddrunner-path': CI_BDDRUNNER_PATH,
				additional: VANESSA_ADDITIONAL,
			},
		},
	},
};

/** Канонический дефолт tools/vrunner.init.json (формат vanessa-runner 3.0) */
export const VRUNNER_INIT_DEFAULTS_V3 = {
	vrunner: {
		...AUTUMN_DEFAULTS.vrunner,
		test: {
			vanessa: {
				vanessasettings: './tools/VAParams.init.json',
				'bddrunner-path': CI_BDDRUNNER_PATH,
				additional: VANESSA_ADDITIONAL,
			},
		},
	},
};


export const HOOKS_DEFAULTS = {
	$schema: HOOKS_SCHEMA,
	version: 1 as const,
	hooks: {} as Record<string, unknown>,
};
