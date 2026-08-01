import * as prompt from "./prompt";
import { logger } from "./logger";
import { Context } from "./Context";
import type {
    MenuDefinition,
    MenuOptionValue,
    ResolvedMenuEntry
} from "./types";

export const EXIT = Symbol("exit");

function isMenuDefinition(value: unknown): value is MenuDefinition {
    return Boolean(value)
        && typeof value === "object"
        && "title" in (value as object)
        && "options" in (value as object);
}

function resolveEntry(value: MenuOptionValue): ResolvedMenuEntry {

    if (typeof value === "function") {
        return { kind: "task", run: value };
    }

    if (isMenuDefinition(value)) {
        return { kind: "menu", menu: value };
    }

    if (value && typeof value === "object") {

        const wrapped = value as {
            selector?: string;
            action?: MenuOptionValue;
            menu?: MenuDefinition;
            onSuccess?: ResolvedMenuEntry["onSuccess"];
            onError?: ResolvedMenuEntry["onError"];
        };

        if (wrapped.menu) {
            return { kind: "menu", menu: wrapped.menu, selector: wrapped.selector };
        }

        if (typeof wrapped.action === "function") {
            return {
                kind: "task",
                run: wrapped.action,
                selector: wrapped.selector,
                onSuccess: wrapped.onSuccess,
                onError: wrapped.onError
            };
        }

    }

    throw new Error(`Item de menú inválido: ${JSON.stringify(value)}`);

}

function normalizeFlagName(flagSelector: string): string {
    return flagSelector.replace(/^--?/, "");
}

function errorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : (error as { stderr?: string })?.stderr ?? String(error);
}

export class Menu {

    static readonly EXIT = EXIT;

    /**
     * Ejecuta un item ya resuelto: si es una task, la corre, guarda su
     * resultado en `ctx.results[label]`, dispara `onSuccess`/`onError`
     * propios del item (si se pasaron) y reporta el resultado al
     * `ctx.notifier` (clasificación por área de TI + canales). Si es un
     * submenú, simplemente lo renderiza (y así hereda su propio manejo de
     * flag-selector/hooks).
     */
    private static async executeEntry(
        entry: ResolvedMenuEntry,
        label: string,
        ctx: Context
    ): Promise<typeof EXIT | void> {

        if (entry.kind === "menu" && entry.menu) {
            return Menu.render(entry.menu, ctx);
        }

        if (entry.kind === "task" && entry.run) {

            try {

                const result = await entry.run(ctx);
                ctx.results[label] = result;

                await entry.onSuccess?.(result, ctx);
                await ctx.notifier.reportSuccess(label, result, ctx);

            } catch (error) {

                await entry.onError?.(error, ctx);
                await ctx.notifier.reportError(label, error, ctx);

                logger.error(errorMessage(error));
                if(ctx.params.catch === "throw" || ctx.flags.catch === "throw") throw error;
            }

            return;

        }

        logger.warn(`Opción "${label}" no tiene acción definida.`);

    }

    /**
     * Renderiza un menú. Si `definition["flag-selector"]` está presente y el
     * Context trae un param que matchea el `selector` de alguno de los
     * items, esa opción se ejecuta automáticamente sin pedir input al
     * usuario (y, si es un submenú, este a su vez revisa su propio
     * "flag-selector", permitiendo encadenar varios niveles).
     */
    static async render(
        definition: MenuDefinition,
        ctx?: Context
    ): Promise<typeof EXIT | void> {

        const activeCtx: Context = ctx ?? Context.current();

        const { title, options } = definition;

        const flagSelector = definition["flag-selector"];

        if (flagSelector) {

            const flagKey = normalizeFlagName(flagSelector);
            const wantedValue = activeCtx.params[flagKey];

            if (wantedValue !== undefined) {

                const match = Object.entries(options).find(([, value]) => {
                    try {
                        return resolveEntry(value).selector === wantedValue;
                    } catch {
                        return false;
                    }
                });

                if (match) {

                    const [label, value] = match;
                    const entry = resolveEntry(value);

                    logger.info(
                        `Selector automático: "${label}" (${flagSelector}=${wantedValue})`
                    );

                    return Menu.executeEntry(entry, label, activeCtx);

                }

                logger.warn(
                    `Ningún item de "${title}" coincide con ${flagSelector}=${wantedValue}; se muestra el menú interactivo.`
                );

            }

        }

        const labels = Object.keys(options);
        labels.push("Salir");

        while (true) {

            const choiceKey = await prompt.select(title, labels);
            const label = labels[Number(choiceKey)];

            if (label === "Salir") {
                return EXIT;
            }

            const entry = resolveEntry(options[label]);
            const result = await Menu.executeEntry(entry, label, activeCtx);

            if (result === EXIT) continue;

        }

    }

}

