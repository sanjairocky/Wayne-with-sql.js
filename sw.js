importScripts("/routing.umd.min.js");
importScripts("/sql-wasm.min.js");
importScripts("/lightning-fs.min.js");

const registerApis = async () => {
  const { Wayne } = wayne;

  const app = new Wayne();

  const sqlPromise = initSqlJs();
  const dataPromise = fetch("/db.sqlite").then((res) => res.arrayBuffer());
  const [SQL, buf] = await Promise.all([sqlPromise, dataPromise]);
  const db = new SQL.Database(new Uint8Array(buf));

  const getTableNames = () => {
    const tables = db.prepare(
      "SELECT * FROM sqlite_master WHERE type='table' OR type='view' ORDER BY name"
    );
    const names = [];
    while (tables.step()) {
      const row = tables.getAsObject();
      names.push({
        name: row.name,
        rows: getTableRowsCount(row.name),
      });
    }
    return names;
  };

  function getTableRowsCount(name) {
    let sel = db.prepare("SELECT COUNT(*) AS count FROM '" + name + "'");
    if (sel.step()) {
      return sel.getAsObject().count;
    } else {
      return -1;
    }
  }

  app.get("/api/foo/{id}", (req, res) => {
    console.log(req);
    res.json(getTableNames());
  });
};

registerApis();

// take control of uncontrolled clients on first load
// ref: https://web.dev/service-worker-lifecycle/#clientsclaim
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
