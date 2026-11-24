import type { Context } from "./Context";
import type {
    ErrorClassifier,
    ErrorCodeInfo,
    ErrorCodeOverride,
    ErrorCodeResolver,
    ErrorMessageFormatter,
    NotificationEvent,
    Sender
} from "./types";
import { ServiceError } from "./types";
import { builtInErrorCode, codeMatches, errorCauses, isErrorCode } from "./errorCodes";
import type { ErrorCodeMatcher } from "./errorCodes";

const WILDCARD = "*";

function toMessage(error: unknown): string {

    if (error instanceof ServiceError) {
        return error.message;
    }

    if (error instanceof Error) {
        return error.message;
    }

    const maybeExecError = error as { stdout?: string; stderr?: string; message?: string } | undefined;

    const lastLine = (text: string | undefined): string | undefined => {
        return text ? text.trim().split("\n").pop() || text : undefined;
    };

    return lastLine(maybeExecError?.stderr)
        || lastLine(maybeExecError?.stdout)
        || maybeExecError?.message
        || String(error);

}

function renderOverrideMessage(message: NonNullable<ErrorCodeOverride["message"]>, info: ErrorCodeInfo, ctx: Context): string {

    if (typeof message === "function") return message(info, ctx);

    return message.replace(/\{(code|matchedCode|taskId|rawMessage)\}/g, (_, key: keyof ErrorCodeInfo) => String(info[key]));

}

export class Notifier {

    private classifiers: ErrorClassifier[] = [];
    private messageFormatters: ErrorMessageFormatter[] = [];
    private codeResolvers: ErrorCodeResolver[] = [];
    private codeOverrides: Array<{ matcher: ErrorCodeMatcher; override: ErrorCodeOverride }> = [];
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

    /**
     * Registra una función que, dado el error, devuelve el mensaje
     * personalizado a reportar (reemplaza el stderr/mensaje crudo). Se
     * prueban en orden; gana la primera que devuelva un string. Si ninguna
     * matchea, se usa el mensaje crudo del error (stderr/Error.message).
     *
     * Ejemplo:
     *   notifier.describeError(messages.byPattern([
     *       [/500 Internal Server Error/, "Se reportó a infraestructura: falta de espacio en el registry"],
     *       [/unauthorized|403/, "Credenciales inválidas contra el registry, revisa el secret"]
     *   ]));
     */
    describeError(formatter: ErrorMessageFormatter): this {
        this.messageFormatters.push(formatter);
        return this;
    }

    /**
     * Registra un resolver que asigna un código propio (DOMINIO-NNN-NOMBRE)
     * a un error. Se prueban en orden; gana el primero que devuelva un código
     * válido. Si ninguno matchea, se usa el código propio del error (p. ej.
     * "K8S-102-MAXREINIT", o un `CodedError`) o un genérico ("GEN-000-UNKNOWN",
     * "GEN-001-EXEC", "GEN-002-EXECTIMEOUT").
     *
     *   notifier.code(codes.byRule([{ command: "docker", args: "push", code: "DOCKER-100-PUSH" }]));
     */
    code(resolver: ErrorCodeResolver): this {
        this.codeResolvers.push(resolver);
        return this;
    }

    /**
     * Intercepta los errores con cierto código para cambiar el mensaje que
     * llega a los canales y/o el área a la que se enrutan. `matcher` puede ser
     * un código exacto, un glob ("K8S-2*"), un RegExp o una lista.
     *
     * Primero se busca un mapeo para el código principal; si no hay, para
     * las causas secundarias del error en orden (p. ej. mapear
     * "K8S-201-OOMKILLED" aplica a un K8S-101-TIMEOUT causado por OOM).
     * `message` y `area` se resuelven por separado: cada uno toma el primer
     * mapeo registrado que matchee Y defina ese campo. Tiene prioridad sobre
     * `classify` y `describeError`.
     *
     *   notifier.mapCode("K8S-201-OOMKILLED", { message: "Sin memoria en {taskId}: subir limits", area: "apps" });
     */
    mapCode(matcher: ErrorCodeMatcher, override: ErrorCodeOverride): this {
        this.codeOverrides.push({ matcher, override });
        return this;
    }

    /** Código del error, con la misma resolución que usa `reportError`. */
    resolveCode(error: unknown, ctx: Context): string {

        for (const resolver of this.codeResolvers) {
            const code = resolver(error, ctx);
            if (isErrorCode(code)) return code;
        }

        return builtInErrorCode(error);

    }

    /**
     * Primer mapeo que defina `field`, probando el código principal y luego
     * las causas en orden. Mensaje y área se resuelven por separado: un
     * `mapCode("K8S-1*", { area })` no tapa el `message` de un mapeo de causa.
     */
    private findOverride<K extends keyof ErrorCodeOverride>(
        codes: string[],
        field: K
    ): { value: NonNullable<ErrorCodeOverride[K]>; matchedCode: string } | undefined {

        for (const code of codes) {
            const found = this.codeOverrides.find(entry => entry.override[field] !== undefined && codeMatches(entry.matcher, code));
            if (found) return { value: found.override[field] as NonNullable<ErrorCodeOverride[K]>, matchedCode: code };
        }

        return undefined;

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

    private resolveMessage(error: unknown, ctx: Context): string {

        for (const formatter of this.messageFormatters) {

            const message = formatter(error, ctx);

            if (message) return message;

        }

        return toMessage(error);

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

        const code = this.resolveCode(error, ctx);
        const causes = errorCauses(error);
        const rawMessage = toMessage(error);
        const candidates = [code, ...causes.map(cause => cause.code)];
        const messageMapping = this.findOverride(candidates, "message");
        const areaMapping = this.findOverride(candidates, "area");

        const area = areaMapping?.value ?? this.resolveArea(error, ctx);
        const mappedCode = messageMapping?.matchedCode ?? areaMapping?.matchedCode;

        const senders = [
            ...(this.channels.get(area) ?? []),
            ...(area !== WILDCARD ? this.channels.get(WILDCARD) ?? [] : [])
        ];

        const serviceError = error instanceof ServiceError ? error : undefined;

        const event: NotificationEvent = {
            type: "error",
            taskId,
            area,
            error,
            message: messageMapping
                ? renderOverrideMessage(messageMapping.value, { taskId, code, matchedCode: messageMapping.matchedCode, causes, error, rawMessage }, ctx)
                : this.resolveMessage(error, ctx),
            timestamp: new Date().toISOString(),
            code,
            rawMessage,
            ...(causes.length ? { causes } : {}),
            ...(mappedCode ? { mappedCode } : {}),
            ...(serviceError ? {
                service: serviceError.service,
                method: serviceError.method,
                args: serviceError.args
            } : {})
        };

        await Promise.allSettled(
            senders.map(sender => sender(event))
        );

        return area;

    }

}