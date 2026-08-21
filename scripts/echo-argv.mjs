/** Печатает argv как JSON для тестов экранирования. */
process.stdout.write(`${JSON.stringify(process.argv.slice(2))}\n`);
