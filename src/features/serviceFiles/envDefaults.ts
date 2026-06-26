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


export const HOOKS_DEFAULTS = {
	$schema: HOOKS_SCHEMA,
	version: 1 as const,
	hooks: {} as Record<string, unknown>,
};
