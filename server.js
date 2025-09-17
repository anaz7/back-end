import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// === ENV Variables (diisi di Render Dashboard) ===
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_OWNER   = process.env.GITHUB_OWNER;
const GITHUB_REPO    = process.env.GITHUB_REPO;
const GITHUB_PATH    = process.env.GITHUB_PATH || "licenses.json";
const GITHUB_BRANCH  = process.env.GITHUB_BRANCH || "master";
const ADMIN_API_KEY  = process.env.ADMIN_API_KEY;

// Middleware: cek API key
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Ambil file JSON dari GitHub
async function getFile() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}?ref=${GITHUB_BRANCH}`;
  const resp = await fetch(url, {
    headers: {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "User-Agent": "ActivationBackend"
    }
  });
  if (!resp.ok) throw new Error(`GitHub GET failed ${resp.status}`);
  const j = await resp.json();
  const content = Buffer.from(j.content, "base64").toString("utf8");
  return { sha: j.sha, obj: JSON.parse(content) };
}

// Update file JSON di GitHub
async function updateFile(newObj, sha, message = "Update licenses.json") {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}`;
  const body = {
    message,
    content: Buffer.from(JSON.stringify(newObj, null, 2)).toString("base64"),
    sha,
    branch: GITHUB_BRANCH
  };
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "User-Agent": "ActivationBackend",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`GitHub PUT failed ${resp.status}: ${txt}`);
  }
  return await resp.json();
}

// Endpoint: cek license by HWID
app.get("/api/license/:hwid", requireApiKey, async (req, res) => {
  try {
    const hwid = req.params.hwid;
    const { obj } = await getFile();

    if (!obj[hwid]) {
      return res.json({ status: "Not Found" });
    }

    const entry = obj[hwid][0];
    const expiredStr = entry.Expired; // format dd-MM-yyyy
    const [day, month, year] = expiredStr.split("-").map(Number);
    const expDate = new Date(year, month - 1, day);
    const now = new Date();

    if (expDate < now) {
      return res.json({ status: false, name: entry.Name, expired: expiredStr });
    } else {
      return res.json({ status: true, name: entry.Name, expired: expiredStr });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: tambah / update license
app.post("/api/activate", requireApiKey, async (req, res) => {
  try {
    const { hwid, host, name, expired, verify } = req.body;
    if (!hwid || !host || !name || !expired) {
      return res.status(400).json({ error: "Missing fields (hwid, host, name, expired)" });
    }

    const { sha, obj } = await getFile();

    obj[hwid] = [
      {
        Host: host,
        HwID: hwid,
        Login: true,
        Name: name,
        Verify: verify || 1,
        Expired: expired
      }
    ];

    const result = await updateFile(obj, sha, `Activate or update ${hwid}`);
    res.json({ status: "Updated", hwid, github: result.commit.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.send("✅ Activation backend is running on Render 🚀");
});

// Jalankan server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
