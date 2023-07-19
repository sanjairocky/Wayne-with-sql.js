/*
 * Wayne - Server Worker Routing library (v. 0.10.1)
 *
 * Copyright (c) 2022-2023 Jakub T. Jankiewicz <https://jcubic.pl/me>
 * Released under MIT license
 *
 * Sun, 02 Jul 2023 18:55:16 +0000
 */
const root_url = location.pathname.replace(/\/[^\/]+$/, "");
const root_url_re = new RegExp("^" + escape_re(root_url));
function normalize_url(url) {
  return url.replace(root_url_re, "");
}
function escape_re(str) {
  if (typeof str == "string") {
    let special = /([\^\$\[\]\(\)\{\}\+\*\.\|\?])/g;
    return str.replace(special, "\\$1");
  }
}
function is_function(arg) {
  return typeof arg === "function";
}
function is_promise(arg) {
  return arg && typeof arg === "object" && is_function(arg.then);
}
function isPromiseFs(fs) {
  const test = (targetFs) => {
    try {
      return targetFs.readFile().catch((e) => e);
    } catch (e) {
      return e;
    }
  };
  return is_promise(test(fs));
}
export class HTTPResponse {
  constructor(resolve) {
    this._resolve = resolve;
  }
  html(data, init) {
    this.send(data, { type: "text/html", ...init });
  }
  text(data, init) {
    this.send(data, init);
  }
  json(data, init) {
    this.send(JSON.stringify(data), { type: "application/json", ...init });
  }
  blob(blob, init = {}) {
    this._resolve(new Response(blob, init));
  }
  send(data, { type = "text/plain", ...init } = {}) {
    if (![undefined, null].includes(data)) {
      data = new Blob([data], { type: type });
    }
    this.blob(data, init);
  }
  async fetch(url) {
    const _res = await fetch(url);
    const type = _res.headers.get("Content-Type") ?? "application/octet-stream";
    this.send(await _res.arrayBuffer(), { type: type });
  }
  download(
    content,
    { filename = "download", type = "text/plain", ...init } = {}
  ) {
    const headers = {
      "Content-Disposition": `attachment; filename="${filename}"`,
    };
    this.send(content, { type: type, headers: headers, ...init });
  }
  redirect(code, url) {
    if (url === undefined) {
      url = code;
      code = 302;
    }
    if (!url.match(/https?:\/\//)) {
      url = root_url + url;
    }
    this._resolve(Response.redirect(url, code));
  }
  sse({ onClose } = {}) {
    let send, close, stream, defunct;
    stream = new ReadableStream({
      cancel() {
        defunct = true;
        trigger(onClose);
      },
      start: (controller) => {
        send = function (event) {
          if (!defunct) {
            const chunk = createChunk(event);
            const payload = new TextEncoder().encode(chunk);
            controller.enqueue(payload);
          }
        };
        close = function close() {
          controller.close();
          stream = null;
          trigger(onClose);
        };
      },
    });
    this._resolve(
      new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Transfer-Encoding": "chunked",
          Connection: "keep-alive",
        },
      })
    );
    return { send: send, close: close };
  }
}
export function RouteParser() {
  const name_re = "[a-zA-Z_][a-zA-Z_0-9]*";
  const self = this;
  const open_tag = "{";
  const close_tag = "}";
  const glob = "*";
  const number = "\\d";
  const optional = "?";
  const open_group = "(";
  const close_group = ")";
  const plus = "+";
  const dot = ".";
  self.route_parser = function (open, close) {
    const routes = {};
    const tag_re = new RegExp(
      "(" + escape_re(open) + name_re + escape_re(close) + ")",
      "g"
    );
    const tokenizer_re = new RegExp(
      [
        "(",
        escape_re(open),
        name_re,
        escape_re(close),
        "|",
        escape_re(glob),
        "|",
        escape_re(number),
        "|",
        escape_re(dot),
        "|",
        escape_re(optional),
        "|",
        escape_re(open_group),
        "|",
        escape_re(close_group),
        "|",
        escape_re(plus),
        ")",
      ].join(""),
      "g"
    );
    const clear_re = new RegExp(
      escape_re(open) + "(" + name_re + ")" + escape_re(close),
      "g"
    );
    return function (str) {
      const result = [];
      let index = 0;
      let parentheses = 0;
      str = str
        .split(tokenizer_re)
        .map(function (chunk, i, chunks) {
          if (chunk === open_group) {
            parentheses++;
          } else if (chunk === close_group) {
            parentheses--;
          }
          if (
            [open_group, plus, close_group, optional, dot, number].includes(
              chunk
            )
          ) {
            return chunk;
          } else if (chunk === glob) {
            result.push(index++);
            return "(.*?)";
          } else if (chunk.match(tag_re)) {
            result.push(chunk.replace(clear_re, "$1"));
            return "([^\\/]+)";
          } else {
            return chunk;
          }
        })
        .join("");
      if (parentheses !== 0) {
        throw new Error(
          `Wayne: Unbalanced parentheses in an expression: ${str}`
        );
      }
      return { re: str, names: result };
    };
  };
  const parse = self.route_parser(open_tag, close_tag);
  self.parse = parse;
  self.pick = function (routes, url) {
    let input;
    let keys;
    if (routes instanceof Array) {
      input = {};
      keys = routes;
      routes.map(function (route) {
        input[route] = route;
      });
    } else {
      keys = Object.keys(routes);
      input = routes;
    }
    const results = [];
    for (let i = keys.length; i--; ) {
      const pattern = keys[i];
      const parts = parse(pattern);
      const m = url.match(new RegExp("^" + parts.re + "$"));
      if (m) {
        const matched = m.slice(1);
        const data = {};
        if (matched.length) {
          parts.names.forEach((name, i) => {
            data[name] = matched[i];
          });
        }
        results.push({ pattern: pattern, data: data });
      }
    }
    return results;
  };
}
function html(content) {
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    '<meta charset="UTF-8">',
    "<title>Wayne Service Worker</title>",
    "</head>",
    "<body>",
    ...content,
    "</body>",
    "</html>",
  ].join("\n");
}
function error500(error) {
  var output = html([
    "<h1>Wayne: 500 Server Error</h1>",
    "<p>Service worker give 500 error</p>",
    `<p>${error.message || error}</p>`,
    `<pre>${error.stack || ""}</pre>`,
  ]);
  return [output, { status: 500, statusText: "500 Server Error" }];
}
function dir(prefix, path, list) {
  var output = html([
    "<h1>Wayne</h1>",
    `<p>Content of ${path}</p>`,
    "<ul>",
    ...list.map((name) => {
      return `<li><a href="${root_url}${prefix}${path}${name}">${name}</a></li>`;
    }),
    "</ul>",
  ]);
  return [output, { status: 404, statusText: "404 Page Not Found" }];
}
function error404(path) {
  var output = html([
    "<h1>Wayne: 404 File Not Found</h1>",
    `<p>File ${path} not found`,
  ]);
  return [output, { status: 404, statusText: "404 Page Not Found" }];
}
function createChunk({ data, event, retry, id }) {
  return (
    Object.entries({ event: event, id: id, data: data, retry: retry })
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n") + "\n\n"
  );
}
function trigger(maybeFn, ...args) {
  if (typeof maybeFn === "function") {
    maybeFn(...args);
  }
}
function chain_handlers(handlers, callback) {
  if (handlers.length) {
    return new Promise((resolve, reject) => {
      let i = 0;
      (async function recur() {
        const handler = handlers[i];
        if (!handler) {
          return resolve();
        }
        try {
          await callback(handler, function next() {
            i++;
            recur();
          });
        } catch (error) {
          reject(error);
        }
      })();
    });
  }
}
async function list_dir({ fs, path }, path_name) {
  const names = await fs.readdir(path_name);
  return Promise.all(
    names.map(async (name) => {
      const fullname = path.join(path_name, name);
      const stat = await fs.stat(fullname);
      if (stat.isDirectory()) {
        return `${name}/`;
      }
      return name;
    })
  );
}
export function FileSystem({ prefix, path, fs, mime }) {
  if (!isPromiseFs(fs)) {
    throw new Error("Wayne: only promise based FS accepted");
  }
  const parser = new RouteParser();
  if (!prefix.startsWith("/")) {
    prefix = `/${prefix}`;
  }
  return async function (req, res, next) {
    const method = req.method;
    const url = new URL(req.url);
    let path_name = normalize_url(decodeURIComponent(url.pathname));
    if (path_name.startsWith(prefix)) {
      if (req.method !== "GET") {
        return res.send("Method Not Allowed", { status: 405 });
      }
      path_name = path_name.substring(prefix.length);
      if (!path_name) {
        path_name = "/";
      }
      try {
        const stat = await fs.stat(path_name);
        if (stat.isFile()) {
          const ext = path.extname(path_name);
          const type = mime.getType(ext);
          const data = await fs.readFile(path_name);
          res.send(data, { type: type });
        } else if (stat.isDirectory()) {
          res.html(
            ...dir(
              prefix,
              path_name,
              await list_dir({ fs: fs, path: path }, path_name)
            )
          );
        }
      } catch (e) {
        if (typeof stat === "undefined") {
          res.html(...error404(path_name));
        } else {
          res.html(...error500(error));
        }
      }
    } else {
      next();
    }
  };
}
export class Wayne {
  constructor() {
    this._er_handlers = [];
    this._middlewares = [];
    this._routes = {};
    this._timeout = 5 * 60 * 1e3;
    this._parser = new RouteParser();
    self.addEventListener("fetch", (event) => {
      event.respondWith(
        new Promise(async (resolve, reject) => {
          const req = event.request;
          try {
            const res = new HTTPResponse(resolve);
            await chain_handlers(this._middlewares, function (fn, next) {
              return fn(req, res, next);
            });
            const method = req.method;
            const url = new URL(req.url);
            const path = normalize_url(url.pathname);
            const routes = this._routes[method];
            if (routes) {
              const match = this._parser.pick(routes, path);
              if (match.length) {
                const [first_match] = match;
                const fns = [
                  ...this._middlewares,
                  ...routes[first_match.pattern],
                ];
                req.params = first_match.data;
                setTimeout(function () {
                  reject("Timeout Error");
                }, this._timeout);
                await chain_handlers(fns, (fn, next) => {
                  return fn(req, res, next);
                });
                return;
              }
            }
            if (
              event.request.cache === "only-if-cached" &&
              event.request.mode !== "same-origin"
            ) {
              return;
            }
            fetch(event.request).then(resolve).catch(reject);
          } catch (error) {
            this._handle_error(resolve, req, error);
          }
        })
      );
    });
    ["GET", "POST", "DELETE", "PATCH", "PUT"].forEach((method) => {
      this[method.toLowerCase()] = this.method(method);
    });
  }
  _handle_error(resolve, req, error) {
    const res = new HTTPResponse(resolve);
    if (this._er_handlers.length) {
      chain_handlers(
        this._er_handlers,
        function (handler, next) {
          handler(error, req, res, next);
        },
        function (error) {
          res.html(...error500(error));
        }
      );
    } else {
      res.html(...error500(error));
    }
  }
  use(...fns) {
    fns.forEach((fn) => {
      if (typeof fn === "function") {
        if (fn.length === 4) {
          this._er_handlers.push(fn);
        } else if (fn.length === 3) {
          this._middlewares.push(fn);
        }
      }
    });
  }
  method(method) {
    return function (url, fn) {
      if (!this._routes[method]) {
        this._routes[method] = {};
      }
      const routes = this._routes[method];
      if (!routes[url]) {
        routes[url] = [];
      }
      routes[url].push(fn);
      return this;
    };
  }
}
export function rpc(channel, methods) {
  channel.addEventListener("message", async function handler(message) {
    if (Object.keys(message.data).includes("method", "id", "args")) {
      const { method, id, args } = message.data;
      try {
        const result = await methods[method](...args);
        channel.postMessage({ id: id, result: result });
      } catch (error) {
        channel.postMessage({ id: id, error: error });
      }
    }
  });
}
let rpc_id = 0;
export function send(channel, method, args) {
  return new Promise((resolve, reject) => {
    const id = ++rpc_id;
    const payload = { id: id, method: method, args: args };
    channel.addEventListener("message", function handler(message) {
      if (id == message.data.id) {
        const data = message.data;
        channel.removeEventListener("message", handler);
        if (data.error) {
          reject(data.error);
        } else {
          resolve(message.data);
        }
      }
    });
    channel.postMessage(payload);
  });
}