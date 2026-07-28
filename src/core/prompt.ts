import * as readline from "readline";

function createInterface(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

export interface AskOptions {
    defaultValue?: string;
}

export async function ask(question: string, options: AskOptions = {}): Promise<string | undefined> {

    const { defaultValue } = options;

    const rl = createInterface();

    const suffix = defaultValue !== undefined
        ? ` (${defaultValue}) `
        : " ";

    try {

        const answer = await new Promise<string>(resolve => {
            rl.question(`${question}${suffix}`, resolve);
        });

        return answer.trim() || defaultValue;

    } finally {
        rl.close();
    }

}

export interface ConfirmOptions {
    defaultValue?: boolean;
}

export async function confirm(question: string, options: ConfirmOptions = {}): Promise<boolean> {

    const { defaultValue = true } = options;

    const hint = defaultValue ? "Y/n" : "y/N";

    const answer = await ask(`${question} [${hint}]`);

    if (!answer) return defaultValue;

    return ["y", "yes", "s", "si", "sí"].includes(answer.toLowerCase());

}

export type SelectChoices = string[] | Record<string, string>;

export async function select(title: string, choices: SelectChoices): Promise<string> {

    const entries: [string, string][] = Array.isArray(choices)
        ? choices.map((label, i): [string, string] => [String(i), label])
        : Object.entries(choices);

    console.log(`\n${title}`);

    entries.forEach(([, label], index) => {
        console.log(`  ${index + 1}) ${label}`);
    });

    const answer = await ask("Selecciona una opción:");

    const index = parseInt(answer ?? "", 10) - 1;

    const entry = entries[index];

    if (Number.isNaN(index) || !entry) {
        console.log("Opción inválida, intenta de nuevo.");
        return select(title, choices);
    }

    return entry[0];

}
