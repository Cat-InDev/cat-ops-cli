import type { Context } from "./Context";
import type { ErrorClassifier, NotificationEvent, Sender } from "./types";

const WILDCARD = "*";

function toMessage(error: unknown): string {

    if (error instanceof Error) {
        return error.message;
    }

    const maybeExecError = error as { stderr?: string; message?: string } | undefined;

    if (maybeExecError?.stderr) {
        return maybeExecError.stderr.trim().split("\n").pop() || maybeExecError.stderr;
    }

    if (maybeExecError?.message) {
        return maybeExecError.message;
    }

    return String(error);

}

export class Notifier {

    private classifiers: ErrorClassifier[] = [];
    private channels: Map<string, Sender[]> = new Map();
    private successSenders: Sender[] = [];
    private defaultArea = "unclassified";

    /**
     * Registra una función que decide a qué área de TI corresponde un
     * error. Se prueban en el orden en que se registraron; gana la primera
     * que devuelva un string. Si ninguna matchea, se usa el área "unclassified"
     * (configurable con `setDefaultArea`).
     */
    classify(classifier: ErrorClassifier): this {
        this.classifiers.push(classifier);
        return this;
    }

    setDefaultArea(area: string): this {
        this.defaultArea = area;
        return this;
    }

    /**
     * Asocia uno o más senders a un área. Puedes registrar el mismo sender
     * en varias áreas, o usar el área especial "*" para que reciba TODOS
     * los errores sin importar la clasificación.
     */
    channel(area: string, ...senders: Sender[]): this {
        const existing = this.channels.get(area) ?? [];
        this.channels.set(area, [...existing, ...senders]);
        return this;
    }

    /** Senders que se disparan en cada tarea exitosa, sin clasificación. */
    onSuccess(...senders: Sender[]): this {
        this.successSenders.push(...senders);
        return this;
    }

    private resolveArea(error: unknown, ctx: Context): string {

        for (const classifier of this.classifiers) {

            const area = classifier(error, ctx);

            if (area) return area;

        }

        return this.defaultArea;

    }

    async reportSuccess(taskId: string, result: unknown, ctx: Context): Promise<void> {

        if (!this.successSenders.length) return;

        const event: NotificationEvent = {
            type: "success",
            taskId,
            result,
            message: `Tarea "${taskId}" finalizó correctamente`,
            timestamp: new Date().toISOString()
        };

        await Promise.allSettled(
            this.successSenders.map(sender => sender(event))
        );

    }

    async reportError(taskId: string, error: unknown, ctx: Context): Promise<string> {

        const area = this.resolveArea(error, ctx);

        const senders = [
            ...(this.channels.get(area) ?? []),
            ...(area !== WILDCARD ? this.channels.get(WILDCARD) ?? [] : [])
        ];

        const event: NotificationEvent = {
            type: "error",
            taskId,
            area,
            error,
            message: toMessage(error),
            timestamp: new Date().toISOString()
        };

        await Promise.allSettled(
            senders.map(sender => sender(event))
        );

        return area;

    }

}
