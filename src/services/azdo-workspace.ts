import JSZip from "jszip";

/**
 * Representa un archivo dentro de un workspace de repositorio.
 * `content` siempre es un Buffer; `binary` indica si debe tratarse
 * como contenido binario (base64Encoded) al publicarse en Azure DevOps.
 */
export interface WorkspaceFile {
    path: string;
    content: Buffer;
    binary: boolean;
}

/**
 * Workspace en memoria que representa el contenido completo de una branch
 * de un repositorio. Se usa como base para "basar un repo en otro"
 * (mergeWithTemplate): descarga origen y destino, copia archivos,
 * transforma y compara para generar el push de cambios.
 */
export class RepositoryWorkspace {

    readonly files = new Map<string, WorkspaceFile>();

    get size(): number {
        return this.files.size;
    }

    has(path: string): boolean {
        return this.files.has(path);
    }

    get(path: string): WorkspaceFile | undefined {
        return this.files.get(path);
    }

    set(file: { path: string; content: Buffer | Uint8Array; binary?: boolean }): void {
        this.files.set(file.path, {
            path: file.path,
            content: Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content),
            binary: file.binary ?? false
        });
    }

    delete(path: string): void {
        this.files.delete(path);
    }

    /** Lista las rutas relativas del workspace. */
    listPaths(): string[] {
        return [...this.files.keys()];
    }

    /** Copia profunda (los Buffers se clonan para no compartir memoria). */
    clone(): RepositoryWorkspace {
        const copy = new RepositoryWorkspace();
        for (const file of this.files.values()) {
            copy.set({ path: file.path, content: Buffer.from(file.content), binary: file.binary });
        }
        return copy;
    }
}

// ---------------------------------------------------------------------------
// Detección de archivos de texto vs binarios
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
    // imágenes
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "svgz",
    // documentos / office
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    // archivos comprimidos
    "zip", "gz", "bz2", "7z", "rar", "tar", "tgz", "xz", "jar", "war", "ear",
    // binarios / libraries
    "exe", "dll", "so", "dylib", "class", "bin", "dat", "obj", "o", "a", "lib",
    // bases de datos
    "db", "sqlite", "sqlite3", "mdb", "mdf",
    // certificados / keystores
    "p12", "pfx", "jks", "keystore",
    // media
    "mp3", "mp4", "avi", "mov", "mkv", "wav", "flac", "aac", "ogg", "webm", "m4a",
    // fuentes
    "woff", "woff2", "ttf", "otf", "eot",
    // diseño
    "psd", "ai", "sketch", "fig", "indd"
]);

/**
 * Determina por extensión si un archivo es texto (p.ej. para decidir entre
 * `rawtext` y `base64Encoded` al hacer push).
 */
export function isTextFile(name: string): boolean {
    const idx = name.lastIndexOf(".");
    if (idx === -1) return true;
    const ext = name.slice(idx + 1).toLowerCase();
    return !BINARY_EXTENSIONS.has(ext);
}

/** Detecta bytes nulos, señal inequívoca de contenido binario. */
function hasNullBytes(content: Buffer): boolean {
    return content.includes(0);
}

// ---------------------------------------------------------------------------
// Filtros de omisión
// ---------------------------------------------------------------------------

/**
 * Indica si una ruta debe omitirse según la lista de patrones `omit`.
 * Acepta archivos exactos (`".gitignore"`) y carpetas (`".vscode"`,
 * `"docs"`, ...) — la omisión aplica a la carpeta y todo su contenido.
 */
export function shouldOmit(path: string, omit?: string[]): boolean {
    if (!omit || omit.length === 0) return false;
    const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
    return omit.some(pattern => {
        const p = String(pattern).replace(/^\/+/, "").replace(/\/+$/, "");
        if (!p) return false;
        if (normalized === p) return true;
        return normalized.startsWith(`${p}/`);
    });
}

// ---------------------------------------------------------------------------
// Carga de ZIP (descarga de repositorio)
// ---------------------------------------------------------------------------

/**
 * Algunas respuestas de Azure incluyen una carpeta raíz con el nombre del
 * repo dentro del ZIP. Se detecta el segmento compartido por todas las
 * entradas y se elimina para que las rutas queden relativas a la raíz del
 * repositorio.
 */
function detectCommonRoot(names: string[]): string | undefined {
    const firstSegments = names.map(name => name.split("/")[0]).filter(Boolean);
    if (firstSegments.length !== names.length || firstSegments.length === 0) return undefined;
    const root = firstSegments[0];
    return firstSegments.every(segment => segment === root) ? root : undefined;
}

function normalizeZipEntryPath(name: string, commonRoot?: string): string {
    let path = name.replace(/\\/g, "/");
    if (commonRoot && path !== commonRoot) {
        const prefix = `${commonRoot}/`;
        if (path.startsWith(prefix)) path = path.slice(prefix.length);
    }
    return `/${path}`.replace(/\/{2,}/g, "/");
}

/**
 * Descarga un repositorio como ZIP, lo desempaqueta y devuelve un
 * `RepositoryWorkspace` con todos los archivos en memoria.
 */
export async function loadRepositoryZip(zipBuffer: Buffer): Promise<RepositoryWorkspace> {
    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    const commonRoot = detectCommonRoot(entries.map(entry => entry.name));
    const workspace = new RepositoryWorkspace();
    for (const entry of entries) {
        const content = await entry.async("nodebuffer");
        const path = normalizeZipEntryPath(entry.name, commonRoot);
        const binary = !isTextFile(entry.name) || hasNullBytes(content);
        workspace.set({ path, content, binary });
    }
    return workspace;
}