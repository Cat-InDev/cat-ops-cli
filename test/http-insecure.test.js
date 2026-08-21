const { test } = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");

const { AzureDevOpsApi, HttpService, HttpRegistry } = require("../dist");

// ---------------------------------------------------------------------------
// Servidor HTTPS con certificado autofirmado
//
// Par clave/certificado desechable generado solo para los tests (CN=localhost,
// SAN 127.0.0.1/localhost): se embebe aquí a propósito para no dejar archivos
// .pem en el repo. No representa ningún secreto ni se usa fuera de localhost.
// ---------------------------------------------------------------------------

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFlAqvdL1/e2bp
2hqNAiewwO8Oek173f3eiR9LQP/MnbnH5z+SC/NfNbdS00LuJR2JPoopbaCVR2xd
jzQIq8OlFjx7s5kUJHCShh8ugWYrIVwDt8136qzgEoh6PAKD7wQyAAKDuDIv9UqK
GSlGOEfzF4iaa0nYa3AFIw6m1ada836BSioAmaacmORWxFOQhg2nXqbQ08v6G94a
hw6i19DYOmP5OGxNs5M0PvGL92lRHLfwl/BdGxl424XbmjvuMiOwer21wKWriX7O
IdyF7ryhxX88ZjlYf4E7j8heYjzHuczFFvMvJ8RTTRbA2nIQY/SqjTykSZGdBCUE
/35sHlRRAgMBAAECggEAUOx2Re/oL59BAxYwWsHftM8I+uKP+uRtNyjtltqMCugt
MBngmTZo2326VOOvna+4/b4OQ7Khm5LR6S4er1B+xQ6q/jWMxMm6C+GAQwF/8blr
oSA2uV92qB4fJQWQOC59BuenIAEhGTB7870jgR3LJl9ktW6tI8W5b3kw5pdKwP6S
VxoSSDtvfFS8MzkO29G4HraFx6keRQTLhhZvl3FFDII52/p3ahptTQ+XIxR3SAVQ
aeZ3FXlEFblKqcDUvB9pXQ7qC8hQWQD7EVUSP5tATUoGdBja4H+nuRuMtuxPTHvP
6dW2a6zu71E3Fk+MLQWHr9PYZfVEhhErCxTp+Ec7owKBgQD0pshyxwi5TmnSIedP
yNqReSxI8VrmrE4h/Rqup2Iz45xOg12kEg3X1Rfljdfy50v6x0wV1UoXxwYAvNjM
9nIoKkciuFHXEno1yVWoGDuwm7WRPvxHt/SXcaxjoq1NcW0KGLgqzMbDgpei7QBP
SFFwfjjbCSfuo4vzP6CGF5258wKBgQDOvkSlWqwRSVFdxPsh15Twnqb7WRhj7A/Z
uCFJmsYC1UajqCQGARTb+qzf4IrlC0N2JCITkpXUCSvev+Ar9KdbmfW31UX8p4PM
qoSdGfaqffM+lQW81fggGZjLvm3smN9jyYO0CHz9Ia1uwiF/WR2WP1KNgdeXM9bv
YD/V7FElqwKBgD+Q5hwMYtPi79PNQ1CTm1aY6Uy6iSfONS7XmIswqm9ZAE/WCgqL
NlWR5HecdzOBrVgnWDmEBZBQAdtHNf1rOxX8hicbRQhgoKhA+6SFR10H2BE5EEuC
HGcM/gGVTvoEMpSg/5j/Q9WgpM2MTrxKyf40jYk7w8hZbg9xxL+Se0TJAoGBALtX
qSbZylCDysqY5CTfkOSWL6RWMQbi894Lv4ZOTR5mG3PTuokCU9+fASaB9/rjwQb+
aS6pR0Hz6aAY6U+LjFgyZHpoNdpkBcfhwPgHfgEyzsgoDCH5FrYn29DMyBl80fk/
syviATj0Wo+iNO6MV4Y97VWzkiQ+4obaBh6Y3VOvAoGANNe1k1fo+OpxrwBi3bGm
w10SA+HOdYCa7vqiNcb5HZJ12cAkKidmnskJuV+AoAJOql+7440qQoF59NAX2Kfk
0fCaJt2zMoklZZccnzGRYnOce6qkd3225kuqRskl+bFB+i1L6MTTJmVHoxzmf+8a
xFBKkBKNL06QBAfbRj2ppWA=
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIC/TCCAeWgAwIBAgIUEGTwfvwzLSjw3q+8+UmaAYPhb5EwDQYJKoZIhvcNAQEL
BQAwADAeFw0yNjA4MjExOTQwMzNaFw0zNjA4MTgxOTQwMzNaMAAwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDFlAqvdL1/e2bp2hqNAiewwO8Oek173f3e
iR9LQP/MnbnH5z+SC/NfNbdS00LuJR2JPoopbaCVR2xdjzQIq8OlFjx7s5kUJHCS
hh8ugWYrIVwDt8136qzgEoh6PAKD7wQyAAKDuDIv9UqKGSlGOEfzF4iaa0nYa3AF
Iw6m1ada836BSioAmaacmORWxFOQhg2nXqbQ08v6G94ahw6i19DYOmP5OGxNs5M0
PvGL92lRHLfwl/BdGxl424XbmjvuMiOwer21wKWriX7OIdyF7ryhxX88ZjlYf4E7
j8heYjzHuczFFvMvJ8RTTRbA2nIQY/SqjTykSZGdBCUE/35sHlRRAgMBAAGjbzBt
MB0GA1UdDgQWBBSwNbUFUAVXkiGYxDu9CC9lu3e8MTAfBgNVHSMEGDAWgBSwNbUF
UAVXkiGYxDu9CC9lu3e8MTAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGCCWxv
Y2FsaG9zdIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEAdy09HMYooawr0irDRuGO
6/Pe0m0SX/mirP2oEsyJcIwTLUU+OGBvN5XUg2yR0NYTcu88y/aPMpFvpai+wPSm
PD8DgmE7hjluZn+ei3Sw6qtAgQUjeYu8Ck+IH9/zKl5osrBhHyg38g8hZeBLwkBU
dwe3B3Pzh6e/Hq/TF10CyPhgKa2OCdSnAv5gp3HGCr364DIRdWBa8fTq8zSZbpu6
N7DmHTIinovD8L60xnMIzTLD3MoNI9lu5yGMObCtAmkFpuBj3XdfYEO3/vFKYg6m
KvgZ2gHlC8qhllNZ3JxrbZ0DOXkJYgUa2YHDFoub8mXscgIErJRIeWNR8N5ew8V9
+Q==
-----END CERTIFICATE-----`;

const TLS_OPTIONS = { key: TEST_KEY, cert: TEST_CERT };

function startHttpsServer(handler) {
    return new Promise((resolve) => {
        const server = https.createServer(TLS_OPTIONS, (req, res) => {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => handler(req, res, body));
        });
        server.listen(0, "127.0.0.1", () => {
            resolve({ server, url: `https://127.0.0.1:${server.address().port}` });
        });
    });
}

function jsonHandler(payload) {
    return (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(typeof payload === "function" ? payload(req) : payload));
    };
}

// ---------------------------------------------------------------------------
// HttpService
// ---------------------------------------------------------------------------

test("HttpService por defecto rechaza un certificado autofirmado", async () => {

    const { server, url } = await startHttpsServer(jsonHandler({ ok: true }));

    try {
        const http = new HttpService();
        const err = await http.get(`${url}/ping`).catch(e => e);

        // Fallo a nivel de red/TLS: status 0 y mensaje descriptivo (no "fetch failed")
        assert.equal(err.status, 0);
        assert.match(err.message, /falló antes de recibir respuesta/i);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("configure({ insecureTls: true }) acepta el certificado autofirmado", async () => {

    const { server, url } = await startHttpsServer(jsonHandler({ ok: true }));

    try {
        const http = new HttpService().configure({ insecureTls: true });

        assert.equal(http.isInsecureTls(), true);

        const res = await http.get(`${url}/ping`);
        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("el override por-petición insecureTls tiene prioridad sobre el default seguro", async () => {

    const { server, url } = await startHttpsServer(jsonHandler({ ok: true }));

    try {
        const http = new HttpService(); // seguro por defecto

        assert.equal(http.isInsecureTls(), false);

        const res = await http.get(`${url}/ping`, { insecureTls: true });
        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("createAgent() hereda insecureTls del config del agente nombrado", async () => {

    const { server, url } = await startHttpsServer(jsonHandler({ ok: true }));

    try {
        const registry = new HttpRegistry();
        registry.createAgent("selfsigned", { insecureTls: true });

        const agent = registry.agent("selfsigned");
        assert.equal(agent.isInsecureTls(), true);

        const res = await agent.get(`${url}/ping`);
        assert.equal(res.body.ok, true);
    } finally {
        await new Promise(r => server.close(r));
    }

});

// ---------------------------------------------------------------------------
// AzureDevOpsApi — herencia de insecureTls
// ---------------------------------------------------------------------------

const AZDO_PAYLOAD = { count: 1, value: [{ id: "proj-1", name: "my-project" }] };

test("AzureDevOpsApi hereda insecureTls al agente interno perezoso", async () => {

    const { server, url } = await startHttpsServer(jsonHandler(AZDO_PAYLOAD));

    try {
        const api = new AzureDevOpsApi().configure({
            baseUrl: url,
            pat: "pat",
            project: "my-project",
            insecureTls: true
        });

        assert.equal(api.isInsecureTls(), true);

        // El agente interno no existe aún — debe crearse ya configurado
        const res = await api.listProjects();
        assert.equal(res.status, 200);
        assert.equal(res.body.count, 1);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("AzureDevOpsApi hereda insecureTls al agente externo inyectado", async () => {

    const { server, url } = await startHttpsServer(jsonHandler((req) => {
        if (req.url.includes("/_apis/projects")) {
            return { count: 1, value: [{ id: "proj-1", name: "my-project" }] };
        }
        return { direct: true };
    }));

    try {
        const agent = new HttpService();
        const api = new AzureDevOpsApi().configure({
            baseUrl: url,
            pat: "pat",
            project: "my-project",
            agent,
            insecureTls: true
        });

        // El agente externo quedó configurado para peticiones directas también
        assert.equal(agent.isInsecureTls(), true);
        const direct = await agent.get(`${url}/direct`);
        assert.equal(direct.body.direct, true);

        const res = await api.listProjects();
        assert.equal(res.status, 200);
        assert.equal(res.body.count, 1);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("AzureDevOpsApi: override por-llamada insecureTls sin configuración global", async () => {

    const { server, url } = await startHttpsServer(jsonHandler(AZDO_PAYLOAD));

    try {
        const api = new AzureDevOpsApi().configure({
            baseUrl: url,
            pat: "pat",
            project: "my-project"
        });

        assert.equal(api.isInsecureTls(), false);

        const res = await api.listProjects({ insecureTls: true });
        assert.equal(res.status, 200);
        assert.equal(res.body.count, 1);

        // Y sin el override sigue fallando (cert autofirmado rechazado)
        const err = await api.listProjects().catch(e => e);
        assert.equal(err.status, 0);
    } finally {
        await new Promise(r => server.close(r));
    }

});
