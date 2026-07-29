import * as fs from "fs/promises";
import { logger } from "./logger";
import type { NotificationEvent, Sender } from "./types";

// ---------------------------------------------------------------------------
// log — usa el logger interno, sin red ni disco
// ---------------------------------------------------------------------------

export function log(): Sender {

    return (event: NotificationEvent) => {

        if (event.type === "error") {
            logger.error(`[${event.area ?? "?"}] ${event.taskId}: ${event.message}`);
        } else {
            logger.success(`${event.taskId}: ${event.message}`);
        }

    };

}

// ---------------------------------------------------------------------------
// file — guarda cada evento como una línea JSON (formato jsonlines)
// ---------------------------------------------------------------------------

export interface FileSenderOptions {
    path: string;
}

export function file({ path }: FileSenderOptions): Sender {

    return async (event: NotificationEvent) => {
        await fs.appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
    };

}

// ---------------------------------------------------------------------------
// http — POST genérico con el evento como JSON
// ---------------------------------------------------------------------------

export interface HttpSenderOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** Transforma el evento antes de enviarlo. Por defecto se manda tal cual. */
    formatBody?: (event: NotificationEvent) => Promise<unknown> | unknown;
}

export function http({ url, method = "POST", headers = {}, formatBody }: HttpSenderOptions): Sender {

    return async (event: NotificationEvent) => {

        const body = formatBody ? await formatBody(event) : event;

        const response = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`http sender: ${url} respondió ${response.status} ${response.statusText}`);
        }

    };

}

// ---------------------------------------------------------------------------
// webhook — como http, pero pensado para Slack/Teams/Discord: formatea el
// mensaje a un payload { text } por defecto (override con `format`).
// ---------------------------------------------------------------------------

export interface WebhookSenderOptions {
    url: string;
    headers?: Record<string, string>;
    /** Formatea el payload del webhook. Por defecto: { text: event.message }. */
    format?: (event: NotificationEvent) => Promise<unknown> | unknown;
}

export function webhook({ url, headers, format }: WebhookSenderOptions): Sender {

    const formatBody = format ?? ((event: NotificationEvent) => ({
        text: event.type === "error"
            ? `❌ [${event.area}] ${event.taskId}: ${event.message}`
            : `✅ ${event.taskId}: ${event.message}`
    }));

    return http({ url, headers, formatBody });

}

// ---------------------------------------------------------------------------
// websocket — abre una conexión, manda el evento como JSON y cierra.
// Usa el WebSocket global de Node (disponible desde Node 21+, estable en 22+).
// ---------------------------------------------------------------------------

export interface WebSocketSenderOptions {
    url: string;
    /** Milisegundos a esperar antes de abortar. Default: 5000 */
    timeout?: number;
}

export function websocket({ url, timeout = 5000 }: WebSocketSenderOptions): Sender {

    return (event: NotificationEvent) => new Promise<void>((resolve, reject) => {

        if (typeof WebSocket === "undefined") {
            reject(new Error(
                "El global WebSocket no está disponible en este runtime de Node. " +
                "Usa Node >=22, o instala 'ws' en tu proyecto y arma tu propio sender con él."
            ));
            return;
        }

        const socket = new WebSocket(url);

        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`websocket sender: timeout conectando a ${url}`));
        }, timeout);

        socket.addEventListener("open", () => {
            socket.send(JSON.stringify(event));
            clearTimeout(timer);
            socket.close();
            resolve();
        });

        socket.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error(`websocket sender: error conectando a ${url}`));
        });

    });

}
