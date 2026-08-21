import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        // Мёртвые импорты копились незаметно: tsc их не видит, noUnusedLocals выключен.
        // Параметры и переменные catch не трогаем: они часть сигнатуры и читаемости.
        "@typescript-eslint/no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",

        // Терминалу VS Code нужен ConPTY, которого нет на Windows старее 1809.
        // Команды запускаются задачами (createVRunnerTask), терминал остаётся
        // только за явным отказом от них: настройка execution.useTasks.
        "no-restricted-syntax": ["error", {
            selector: "CallExpression[callee.property.name='createTerminal']",
            message: "Запускайте команды задачей через createVRunnerTask: терминалу нужен ConPTY, его нет на Windows старее 1809. Терминал допустим только в ветке execution.useTasks === false, с eslint-disable и пояснением.",
        }, {
            selector: "CallExpression[callee.property.name='sendText']",
            message: "sendText пишет в терминал VS Code. Команду дочернего процесса собирайте через buildProcessCommand и запускайте задачей.",
        }],
    },
}];