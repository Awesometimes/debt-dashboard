const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 3000);
const ledgerPin = process.env.LEDGER_PIN || "20000";
const publicDir = __dirname;
const dataDir = path.join(__dirname, "data");
const stateFile = path.join(dataDir, "ledger-state.json");

const defaultState = {
  principal: 20000,
  loanDate: "2018-01-09",
  noteStatus: "Needs written repayment plan",
  friendApr: 6,
  marketReturn: 9,
  monthlyPayment: 500,
  firstDue: new Date().toISOString().slice(0, 10),
  payments: [],
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function ensureStateFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, `${JSON.stringify(defaultState, null, 2)}\n`);
  }
}

function readState() {
  ensureStateFile();
  return { ...defaultState, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
}

function writeState(nextState) {
  ensureStateFile();
  const safeState = {
    ...defaultState,
    ...nextState,
    payments: Array.isArray(nextState.payments) ? nextState.payments : [],
  };
  fs.writeFileSync(stateFile, `${JSON.stringify(safeState, null, 2)}\n`);
  return safeState;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function authorized(req) {
  return req.headers["x-ledger-pin"] === ledgerPin;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  if (!authorized(req)) {
    sendJson(res, 401, { error: "Invalid PIN" });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, readState());
    return;
  }

  if (req.method === "PUT") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, writeState(JSON.parse(body)));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(publicDir, requested));

  if (!filePath.startsWith(publicDir) || filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/state")) {
    handleApi(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(port, () => {
  ensureStateFile();
  console.log(`Loan Ledger running at http://127.0.0.1:${port}/`);
  console.log(`Shared data file: ${stateFile}`);
});
