var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/loglevel/lib/loglevel.js
var require_loglevel = __commonJS({
  "node_modules/loglevel/lib/loglevel.js"(exports, module) {
    (function(root, definition) {
      "use strict";
      if (typeof define === "function" && define.amd) {
        define(definition);
      } else if (typeof module === "object" && module.exports) {
        module.exports = definition();
      } else {
        root.log = definition();
      }
    })(exports, function() {
      "use strict";
      var noop = function() {
      };
      var undefinedType = "undefined";
      var isIE = typeof window !== undefinedType && typeof window.navigator !== undefinedType && /Trident\/|MSIE /.test(window.navigator.userAgent);
      var logMethods = [
        "trace",
        "debug",
        "info",
        "warn",
        "error"
      ];
      var _loggersByName = {};
      var defaultLogger = null;
      function bindMethod(obj, methodName) {
        var method = obj[methodName];
        if (typeof method.bind === "function") {
          return method.bind(obj);
        } else {
          try {
            return Function.prototype.bind.call(method, obj);
          } catch (e) {
            return function() {
              return Function.prototype.apply.apply(method, [obj, arguments]);
            };
          }
        }
      }
      function traceForIE() {
        if (console.log) {
          if (console.log.apply) {
            console.log.apply(console, arguments);
          } else {
            Function.prototype.apply.apply(console.log, [console, arguments]);
          }
        }
        if (console.trace) console.trace();
      }
      function realMethod(methodName) {
        if (methodName === "debug") {
          methodName = "log";
        }
        if (typeof console === undefinedType) {
          return false;
        } else if (methodName === "trace" && isIE) {
          return traceForIE;
        } else if (console[methodName] !== void 0) {
          return bindMethod(console, methodName);
        } else if (console.log !== void 0) {
          return bindMethod(console, "log");
        } else {
          return noop;
        }
      }
      function replaceLoggingMethods() {
        var level = this.getLevel();
        for (var i = 0; i < logMethods.length; i++) {
          var methodName = logMethods[i];
          this[methodName] = i < level ? noop : this.methodFactory(methodName, level, this.name);
        }
        this.log = this.debug;
        if (typeof console === undefinedType && level < this.levels.SILENT) {
          return "No console available for logging";
        }
      }
      function enableLoggingWhenConsoleArrives(methodName) {
        return function() {
          if (typeof console !== undefinedType) {
            replaceLoggingMethods.call(this);
            this[methodName].apply(this, arguments);
          }
        };
      }
      function defaultMethodFactory(methodName, _level, _loggerName) {
        return realMethod(methodName) || enableLoggingWhenConsoleArrives.apply(this, arguments);
      }
      function Logger(name, factory) {
        var self = this;
        var inheritedLevel;
        var defaultLevel;
        var userLevel;
        var storageKey = "loglevel";
        if (typeof name === "string") {
          storageKey += ":" + name;
        } else if (typeof name === "symbol") {
          storageKey = void 0;
        }
        function persistLevelIfPossible(levelNum) {
          var levelName = (logMethods[levelNum] || "silent").toUpperCase();
          if (typeof window === undefinedType || !storageKey) return;
          try {
            window.localStorage[storageKey] = levelName;
            return;
          } catch (ignore) {
          }
          try {
            window.document.cookie = encodeURIComponent(storageKey) + "=" + levelName + ";";
          } catch (ignore) {
          }
        }
        function getPersistedLevel() {
          var storedLevel;
          if (typeof window === undefinedType || !storageKey) return;
          try {
            storedLevel = window.localStorage[storageKey];
          } catch (ignore) {
          }
          if (typeof storedLevel === undefinedType) {
            try {
              var cookie = window.document.cookie;
              var cookieName = encodeURIComponent(storageKey);
              var location = cookie.indexOf(cookieName + "=");
              if (location !== -1) {
                storedLevel = /^([^;]+)/.exec(
                  cookie.slice(location + cookieName.length + 1)
                )[1];
              }
            } catch (ignore) {
            }
          }
          if (self.levels[storedLevel] === void 0) {
            storedLevel = void 0;
          }
          return storedLevel;
        }
        function clearPersistedLevel() {
          if (typeof window === undefinedType || !storageKey) return;
          try {
            window.localStorage.removeItem(storageKey);
          } catch (ignore) {
          }
          try {
            window.document.cookie = encodeURIComponent(storageKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC";
          } catch (ignore) {
          }
        }
        function normalizeLevel(input) {
          var level = input;
          if (typeof level === "string" && self.levels[level.toUpperCase()] !== void 0) {
            level = self.levels[level.toUpperCase()];
          }
          if (typeof level === "number" && level >= 0 && level <= self.levels.SILENT) {
            return level;
          } else {
            throw new TypeError("log.setLevel() called with invalid level: " + input);
          }
        }
        self.name = name;
        self.levels = {
          "TRACE": 0,
          "DEBUG": 1,
          "INFO": 2,
          "WARN": 3,
          "ERROR": 4,
          "SILENT": 5
        };
        self.methodFactory = factory || defaultMethodFactory;
        self.getLevel = function() {
          if (userLevel != null) {
            return userLevel;
          } else if (defaultLevel != null) {
            return defaultLevel;
          } else {
            return inheritedLevel;
          }
        };
        self.setLevel = function(level, persist) {
          userLevel = normalizeLevel(level);
          if (persist !== false) {
            persistLevelIfPossible(userLevel);
          }
          return replaceLoggingMethods.call(self);
        };
        self.setDefaultLevel = function(level) {
          defaultLevel = normalizeLevel(level);
          if (!getPersistedLevel()) {
            self.setLevel(level, false);
          }
        };
        self.resetLevel = function() {
          userLevel = null;
          clearPersistedLevel();
          replaceLoggingMethods.call(self);
        };
        self.enableAll = function(persist) {
          self.setLevel(self.levels.TRACE, persist);
        };
        self.disableAll = function(persist) {
          self.setLevel(self.levels.SILENT, persist);
        };
        self.rebuild = function() {
          if (defaultLogger !== self) {
            inheritedLevel = normalizeLevel(defaultLogger.getLevel());
          }
          replaceLoggingMethods.call(self);
          if (defaultLogger === self) {
            for (var childName in _loggersByName) {
              _loggersByName[childName].rebuild();
            }
          }
        };
        inheritedLevel = normalizeLevel(
          defaultLogger ? defaultLogger.getLevel() : "WARN"
        );
        var initialLevel = getPersistedLevel();
        if (initialLevel != null) {
          userLevel = normalizeLevel(initialLevel);
        }
        replaceLoggingMethods.call(self);
      }
      defaultLogger = new Logger();
      defaultLogger.getLogger = function getLogger(name) {
        if (typeof name !== "symbol" && typeof name !== "string" || name === "") {
          throw new TypeError("You must supply a name when creating a logger.");
        }
        var logger = _loggersByName[name];
        if (!logger) {
          logger = _loggersByName[name] = new Logger(
            name,
            defaultLogger.methodFactory
          );
        }
        return logger;
      };
      var _log = typeof window !== undefinedType ? window.log : void 0;
      defaultLogger.noConflict = function() {
        if (typeof window !== undefinedType && window.log === defaultLogger) {
          window.log = _log;
        }
        return defaultLogger;
      };
      defaultLogger.getLoggers = function getLoggers() {
        return _loggersByName;
      };
      defaultLogger["default"] = defaultLogger;
      return defaultLogger;
    });
  }
});

// node_modules/idb/build/index.js
var instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
var idbProxyableTypes;
var cursorAdvanceMethods;
function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [
    IDBDatabase,
    IDBObjectStore,
    IDBIndex,
    IDBCursor,
    IDBTransaction
  ]);
}
function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [
    IDBCursor.prototype.advance,
    IDBCursor.prototype.continue,
    IDBCursor.prototype.continuePrimaryKey
  ]);
}
var transactionDoneMap = /* @__PURE__ */ new WeakMap();
var transformCache = /* @__PURE__ */ new WeakMap();
var reverseTransformCache = /* @__PURE__ */ new WeakMap();
function promisifyRequest(request) {
  const promise = new Promise((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener("success", success);
      request.removeEventListener("error", error);
    };
    const success = () => {
      resolve(wrap(request.result));
      unlisten();
    };
    const error = () => {
      reject(request.error);
      unlisten();
    };
    request.addEventListener("success", success);
    request.addEventListener("error", error);
  });
  reverseTransformCache.set(promise, request);
  return promise;
}
function cacheDonePromiseForTransaction(tx) {
  if (transactionDoneMap.has(tx))
    return;
  const done = new Promise((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener("complete", complete);
      tx.removeEventListener("error", error);
      tx.removeEventListener("abort", error);
    };
    const complete = () => {
      resolve();
      unlisten();
    };
    const error = () => {
      reject(tx.error || new DOMException("AbortError", "AbortError"));
      unlisten();
    };
    tx.addEventListener("complete", complete);
    tx.addEventListener("error", error);
    tx.addEventListener("abort", error);
  });
  transactionDoneMap.set(tx, done);
}
var idbProxyTraps = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      if (prop === "done")
        return transactionDoneMap.get(target);
      if (prop === "store") {
        return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    }
    return wrap(target[prop]);
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
      return true;
    }
    return prop in target;
  }
};
function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}
function wrapFunction(func) {
  if (getCursorAdvanceMethods().includes(func)) {
    return function(...args) {
      func.apply(unwrap(this), args);
      return wrap(this.request);
    };
  }
  return function(...args) {
    return wrap(func.apply(unwrap(this), args));
  };
}
function transformCachableValue(value) {
  if (typeof value === "function")
    return wrapFunction(value);
  if (value instanceof IDBTransaction)
    cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes()))
    return new Proxy(value, idbProxyTraps);
  return value;
}
function wrap(value) {
  if (value instanceof IDBRequest)
    return promisifyRequest(value);
  if (transformCache.has(value))
    return transformCache.get(value);
  const newValue = transformCachableValue(value);
  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }
  return newValue;
}
var unwrap = (value) => reverseTransformCache.get(value);
function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
  const request = indexedDB.open(name, version);
  const openPromise = wrap(request);
  if (upgrade) {
    request.addEventListener("upgradeneeded", (event) => {
      upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
    });
  }
  if (blocked) {
    request.addEventListener("blocked", (event) => blocked(
      // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
      event.oldVersion,
      event.newVersion,
      event
    ));
  }
  openPromise.then((db) => {
    if (terminated)
      db.addEventListener("close", () => terminated());
    if (blocking) {
      db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
    }
  }).catch(() => {
  });
  return openPromise;
}
var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
var writeMethods = ["put", "add", "delete", "clear"];
var cachedMethods = /* @__PURE__ */ new Map();
function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
    return;
  }
  if (cachedMethods.get(prop))
    return cachedMethods.get(prop);
  const targetFuncName = prop.replace(/FromIndex$/, "");
  const useIndex = prop !== targetFuncName;
  const isWrite = writeMethods.includes(targetFuncName);
  if (
    // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
    !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
  ) {
    return;
  }
  const method = async function(storeName, ...args) {
    const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
    let target2 = tx.store;
    if (useIndex)
      target2 = target2.index(args.shift());
    return (await Promise.all([
      target2[targetFuncName](...args),
      isWrite && tx.done
    ]))[0];
  };
  cachedMethods.set(prop, method);
  return method;
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
  has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
}));
var advanceMethodProps = ["continue", "continuePrimaryKey", "advance"];
var methodMap = {};
var advanceResults = /* @__PURE__ */ new WeakMap();
var ittrProxiedCursorToOriginalProxy = /* @__PURE__ */ new WeakMap();
var cursorIteratorTraps = {
  get(target, prop) {
    if (!advanceMethodProps.includes(prop))
      return target[prop];
    let cachedFunc = methodMap[prop];
    if (!cachedFunc) {
      cachedFunc = methodMap[prop] = function(...args) {
        advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
      };
    }
    return cachedFunc;
  }
};
async function* iterate(...args) {
  let cursor = this;
  if (!(cursor instanceof IDBCursor)) {
    cursor = await cursor.openCursor(...args);
  }
  if (!cursor)
    return;
  cursor = cursor;
  const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
  ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
  reverseTransformCache.set(proxiedCursor, unwrap(cursor));
  while (cursor) {
    yield proxiedCursor;
    cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
    advanceResults.delete(proxiedCursor);
  }
}
function isIteratorProp(target, prop) {
  return prop === Symbol.asyncIterator && instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor]) || prop === "iterate" && instanceOfAny(target, [IDBIndex, IDBObjectStore]);
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get(target, prop, receiver) {
    if (isIteratorProp(target, prop))
      return iterate;
    return oldTraps.get(target, prop, receiver);
  },
  has(target, prop) {
    return isIteratorProp(target, prop) || oldTraps.has(target, prop);
  }
}));

// node_modules/dxf-parser/dist/DxfArrayScanner.js
var DxfArrayScanner = class {
  constructor(data) {
    this._pointer = 0;
    this._eof = false;
    this._data = data;
  }
  /**
   * Gets the next group (code, value) from the array. A group is two consecutive elements
   * in the array. The first is the code, the second is the value.
   * @returns {{code: Number}|*}
   */
  next() {
    if (!this.hasNext()) {
      if (!this._eof)
        throw new Error("Unexpected end of input: EOF group not read before end of file. Ended on code " + this._data[this._pointer]);
      else
        throw new Error("Cannot call 'next' after EOF group has been read");
    }
    const group = {
      code: parseInt(this._data[this._pointer])
    };
    this._pointer++;
    group.value = parseGroupValue(group.code, this._data[this._pointer].trim());
    this._pointer++;
    if (group.code === 0 && group.value === "EOF")
      this._eof = true;
    this.lastReadGroup = group;
    return group;
  }
  peek() {
    if (!this.hasNext()) {
      if (!this._eof)
        throw new Error("Unexpected end of input: EOF group not read before end of file. Ended on code " + this._data[this._pointer]);
      else
        throw new Error("Cannot call 'next' after EOF group has been read");
    }
    const group = {
      code: parseInt(this._data[this._pointer])
    };
    group.value = parseGroupValue(group.code, this._data[this._pointer + 1].trim());
    return group;
  }
  rewind(numberOfGroups = 1) {
    this._pointer = this._pointer - numberOfGroups * 2;
  }
  /**
   * Returns true if there is another code/value pair (2 elements in the array).
   * @returns {boolean}
   */
  hasNext() {
    if (this._eof) {
      return false;
    }
    if (this._pointer > this._data.length - 2) {
      return false;
    }
    return true;
  }
  /**
   * Returns true if the scanner is at the end of the array
   * @returns {boolean}
   */
  isEOF() {
    return this._eof;
  }
};
function parseGroupValue(code, value) {
  if (code <= 9)
    return value;
  if (code >= 10 && code <= 59)
    return parseFloat(value);
  if (code >= 60 && code <= 99)
    return parseInt(value);
  if (code >= 100 && code <= 109)
    return value;
  if (code >= 110 && code <= 149)
    return parseFloat(value);
  if (code >= 160 && code <= 179)
    return parseInt(value);
  if (code >= 210 && code <= 239)
    return parseFloat(value);
  if (code >= 270 && code <= 289)
    return parseInt(value);
  if (code >= 290 && code <= 299)
    return parseBoolean(value);
  if (code >= 300 && code <= 369)
    return value;
  if (code >= 370 && code <= 389)
    return parseInt(value);
  if (code >= 390 && code <= 399)
    return value;
  if (code >= 400 && code <= 409)
    return parseInt(value);
  if (code >= 410 && code <= 419)
    return value;
  if (code >= 420 && code <= 429)
    return parseInt(value);
  if (code >= 430 && code <= 439)
    return value;
  if (code >= 440 && code <= 459)
    return parseInt(value);
  if (code >= 460 && code <= 469)
    return parseFloat(value);
  if (code >= 470 && code <= 481)
    return value;
  if (code === 999)
    return value;
  if (code >= 1e3 && code <= 1009)
    return value;
  if (code >= 1010 && code <= 1059)
    return parseFloat(value);
  if (code >= 1060 && code <= 1071)
    return parseInt(value);
  console.log("WARNING: Group code does not have a defined type: %j", { code, value });
  return value;
}
function parseBoolean(str) {
  if (str === "0")
    return false;
  if (str === "1")
    return true;
  throw TypeError("String '" + str + "' cannot be cast to Boolean type");
}

// node_modules/dxf-parser/dist/AutoCadColorIndex.js
var AutoCadColorIndex_default = [
  0,
  16711680,
  16776960,
  65280,
  65535,
  255,
  16711935,
  16777215,
  8421504,
  12632256,
  16711680,
  16744319,
  13369344,
  13395558,
  10027008,
  10046540,
  8323072,
  8339263,
  4980736,
  4990502,
  16727808,
  16752511,
  13382400,
  13401958,
  10036736,
  10051404,
  8331008,
  8343359,
  4985600,
  4992806,
  16744192,
  16760703,
  13395456,
  13408614,
  10046464,
  10056268,
  8339200,
  8347455,
  4990464,
  4995366,
  16760576,
  16768895,
  13408512,
  13415014,
  10056192,
  10061132,
  8347392,
  8351551,
  4995328,
  4997670,
  16776960,
  16777087,
  13421568,
  13421670,
  10000384,
  10000460,
  8355584,
  8355647,
  5000192,
  5000230,
  12582656,
  14679935,
  10079232,
  11717734,
  7510016,
  8755276,
  6258432,
  7307071,
  3755008,
  4344870,
  8388352,
  12582783,
  6736896,
  10079334,
  5019648,
  7510092,
  4161280,
  6258495,
  2509824,
  3755046,
  4194048,
  10485631,
  3394560,
  8375398,
  2529280,
  6264908,
  2064128,
  5209919,
  1264640,
  3099686,
  65280,
  8388479,
  52224,
  6736998,
  38912,
  5019724,
  32512,
  4161343,
  19456,
  2509862,
  65343,
  8388511,
  52275,
  6737023,
  38950,
  5019743,
  32543,
  4161359,
  19475,
  2509871,
  65407,
  8388543,
  52326,
  6737049,
  38988,
  5019762,
  32575,
  4161375,
  19494,
  2509881,
  65471,
  8388575,
  52377,
  6737074,
  39026,
  5019781,
  32607,
  4161391,
  19513,
  2509890,
  65535,
  8388607,
  52428,
  6737100,
  39064,
  5019800,
  32639,
  4161407,
  19532,
  2509900,
  49151,
  8380415,
  39372,
  6730444,
  29336,
  5014936,
  24447,
  4157311,
  14668,
  2507340,
  32767,
  8372223,
  26316,
  6724044,
  19608,
  5010072,
  16255,
  4153215,
  9804,
  2505036,
  16383,
  8364031,
  13260,
  6717388,
  9880,
  5005208,
  8063,
  4149119,
  4940,
  2502476,
  255,
  8355839,
  204,
  6710988,
  152,
  5000344,
  127,
  4145023,
  76,
  2500172,
  4129023,
  10452991,
  3342540,
  8349388,
  2490520,
  6245528,
  2031743,
  5193599,
  1245260,
  3089996,
  8323327,
  12550143,
  6684876,
  10053324,
  4980888,
  7490712,
  4128895,
  6242175,
  2490444,
  3745356,
  12517631,
  14647295,
  10027212,
  11691724,
  7471256,
  8735896,
  6226047,
  7290751,
  3735628,
  4335180,
  16711935,
  16744447,
  13369548,
  13395660,
  9961624,
  9981080,
  8323199,
  8339327,
  4980812,
  4990540,
  16711871,
  16744415,
  13369497,
  13395634,
  9961586,
  9981061,
  8323167,
  8339311,
  4980793,
  4990530,
  16711807,
  16744383,
  13369446,
  13395609,
  9961548,
  9981042,
  8323135,
  8339295,
  4980774,
  4990521,
  16711743,
  16744351,
  13369395,
  13395583,
  9961510,
  9981023,
  8323103,
  8339279,
  4980755,
  4990511,
  3355443,
  5987163,
  8684676,
  11382189,
  14079702,
  16777215
];

// node_modules/dxf-parser/dist/ParseHelpers.js
function getAcadColor(index) {
  return AutoCadColorIndex_default[index];
}
function parsePoint(scanner) {
  const point = {};
  scanner.rewind();
  let curr = scanner.next();
  let code = curr.code;
  point.x = curr.value;
  code += 10;
  curr = scanner.next();
  if (curr.code != code)
    throw new Error("Expected code for point value to be " + code + " but got " + curr.code + ".");
  point.y = curr.value;
  code += 10;
  curr = scanner.next();
  if (curr.code != code) {
    scanner.rewind();
    return point;
  }
  point.z = curr.value;
  return point;
}
function checkCommonEntityProperties(entity, curr, scanner) {
  switch (curr.code) {
    case 0:
      entity.type = curr.value;
      break;
    case 5:
      entity.handle = curr.value;
      break;
    case 6:
      entity.lineType = curr.value;
      break;
    case 8:
      entity.layer = curr.value;
      break;
    case 48:
      entity.lineTypeScale = curr.value;
      break;
    case 60:
      entity.visible = curr.value === 0;
      break;
    case 62:
      entity.colorIndex = curr.value;
      entity.color = getAcadColor(Math.abs(curr.value));
      break;
    case 67:
      entity.inPaperSpace = curr.value !== 0;
      break;
    case 100:
      break;
    case 101:
      while (curr.code != 0) {
        curr = scanner.next();
      }
      scanner.rewind();
      break;
    case 330:
      entity.ownerHandle = curr.value;
      break;
    case 347:
      entity.materialObjectHandle = curr.value;
      break;
    case 370:
      entity.lineweight = curr.value;
      break;
    case 420:
      entity.color = curr.value;
      break;
    case 1e3:
      entity.extendedData = entity.extendedData || {};
      entity.extendedData.customStrings = entity.extendedData.customStrings || [];
      entity.extendedData.customStrings.push(curr.value);
      break;
    case 1001:
      entity.extendedData = entity.extendedData || {};
      entity.extendedData.applicationName = curr.value;
      break;
    default:
      return false;
  }
  return true;
}

// node_modules/dxf-parser/dist/entities/3dface.js
var ThreeDface = class {
  constructor() {
    this.ForEntityName = "3DFACE";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value, vertices: [] };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 70:
          entity.shape = (curr.value & 1) === 1;
          entity.hasContinuousLinetypePattern = (curr.value & 128) === 128;
          break;
        case 10:
          entity.vertices = parse3dFaceVertices(scanner, curr);
          curr = scanner.lastReadGroup;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};
function parse3dFaceVertices(scanner, curr) {
  var vertices = [];
  var vertexIsStarted = false;
  var vertexIsFinished = false;
  var verticesPer3dFace = 4;
  for (let i = 0; i <= verticesPer3dFace; i++) {
    var vertex = {};
    while (!scanner.isEOF()) {
      if (curr.code === 0 || vertexIsFinished)
        break;
      switch (curr.code) {
        case 10:
        // X0
        case 11:
        // X1
        case 12:
        // X2
        case 13:
          if (vertexIsStarted) {
            vertexIsFinished = true;
            continue;
          }
          vertex.x = curr.value;
          vertexIsStarted = true;
          break;
        case 20:
        // Y
        case 21:
        case 22:
        case 23:
          vertex.y = curr.value;
          break;
        case 30:
        // Z
        case 31:
        case 32:
        case 33:
          vertex.z = curr.value;
          break;
        default:
          return vertices;
      }
      curr = scanner.next();
    }
    vertices.push(vertex);
    vertexIsStarted = false;
    vertexIsFinished = false;
  }
  scanner.rewind();
  return vertices;
}

// node_modules/dxf-parser/dist/entities/arc.js
var Arc = class {
  constructor() {
    this.ForEntityName = "ARC";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.center = parsePoint(scanner);
          break;
        case 40:
          entity.radius = curr.value;
          break;
        case 50:
          entity.startAngle = Math.PI / 180 * curr.value;
          break;
        case 51:
          entity.endAngle = Math.PI / 180 * curr.value;
          entity.angleLength = entity.endAngle - entity.startAngle;
          break;
        case 210:
          entity.extrusionDirectionX = curr.value;
          break;
        case 220:
          entity.extrusionDirectionY = curr.value;
          break;
        case 230:
          entity.extrusionDirectionZ = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/attdef.js
var Attdef = class {
  constructor() {
    this.ForEntityName = "ATTDEF";
  }
  parseEntity(scanner, curr) {
    var entity = {
      type: curr.value,
      scale: 1,
      textStyle: "STANDARD"
    };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0) {
        break;
      }
      switch (curr.code) {
        case 1:
          entity.text = curr.value;
          break;
        case 2:
          entity.tag = curr.value;
          break;
        case 3:
          entity.prompt = curr.value;
          break;
        case 7:
          entity.textStyle = curr.value;
          break;
        case 10:
          entity.startPoint = parsePoint(scanner);
          break;
        case 11:
          entity.endPoint = parsePoint(scanner);
          break;
        case 39:
          entity.thickness = curr.value;
          break;
        case 40:
          entity.textHeight = curr.value;
          break;
        case 41:
          entity.scale = curr.value;
          break;
        case 50:
          entity.rotation = curr.value;
          break;
        case 51:
          entity.obliqueAngle = curr.value;
          break;
        case 70:
          entity.invisible = !!(curr.value & 1);
          entity.constant = !!(curr.value & 2);
          entity.verificationRequired = !!(curr.value & 4);
          entity.preset = !!(curr.value & 8);
          break;
        case 71:
          entity.backwards = !!(curr.value & 2);
          entity.mirrored = !!(curr.value & 4);
          break;
        case 72:
          entity.horizontalJustification = curr.value;
          break;
        case 73:
          entity.fieldLength = curr.value;
          break;
        case 74:
          entity.verticalJustification = curr.value;
          break;
        case 100:
          break;
        case 210:
          entity.extrusionDirectionX = curr.value;
          break;
        case 220:
          entity.extrusionDirectionY = curr.value;
          break;
        case 230:
          entity.extrusionDirectionZ = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/circle.js
var Circle = class {
  constructor() {
    this.ForEntityName = "CIRCLE";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.center = parsePoint(scanner);
          break;
        case 40:
          entity.radius = curr.value;
          break;
        case 50:
          entity.startAngle = Math.PI / 180 * curr.value;
          break;
        case 51:
          const endAngle = Math.PI / 180 * curr.value;
          if (endAngle < entity.startAngle)
            entity.angleLength = endAngle + 2 * Math.PI - entity.startAngle;
          else
            entity.angleLength = endAngle - entity.startAngle;
          entity.endAngle = endAngle;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/dimension.js
var Dimension = class {
  constructor() {
    this.ForEntityName = "DIMENSION";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 2:
          entity.block = curr.value;
          break;
        case 10:
          entity.anchorPoint = parsePoint(scanner);
          break;
        case 11:
          entity.middleOfText = parsePoint(scanner);
          break;
        case 12:
          entity.insertionPoint = parsePoint(scanner);
          break;
        case 13:
          entity.linearOrAngularPoint1 = parsePoint(scanner);
          break;
        case 14:
          entity.linearOrAngularPoint2 = parsePoint(scanner);
          break;
        case 15:
          entity.diameterOrRadiusPoint = parsePoint(scanner);
          break;
        case 16:
          entity.arcPoint = parsePoint(scanner);
          break;
        case 70:
          entity.dimensionType = curr.value;
          break;
        case 71:
          entity.attachmentPoint = curr.value;
          break;
        case 42:
          entity.actualMeasurement = curr.value;
          break;
        case 1:
          entity.text = curr.value;
          break;
        case 50:
          entity.angle = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/ellipse.js
var Ellipse = class {
  constructor() {
    this.ForEntityName = "ELLIPSE";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.center = parsePoint(scanner);
          break;
        case 11:
          entity.majorAxisEndPoint = parsePoint(scanner);
          break;
        case 40:
          entity.axisRatio = curr.value;
          break;
        case 41:
          entity.startAngle = curr.value;
          break;
        case 42:
          entity.endAngle = curr.value;
          break;
        case 2:
          entity.name = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/insert.js
var Insert = class {
  constructor() {
    this.ForEntityName = "INSERT";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 2:
          entity.name = curr.value;
          break;
        case 41:
          entity.xScale = curr.value;
          break;
        case 42:
          entity.yScale = curr.value;
          break;
        case 43:
          entity.zScale = curr.value;
          break;
        case 10:
          entity.position = parsePoint(scanner);
          break;
        case 50:
          entity.rotation = curr.value;
          break;
        case 70:
          entity.columnCount = curr.value;
          break;
        case 71:
          entity.rowCount = curr.value;
          break;
        case 44:
          entity.columnSpacing = curr.value;
          break;
        case 45:
          entity.rowSpacing = curr.value;
          break;
        case 210:
          entity.extrusionDirection = parsePoint(scanner);
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/line.js
var Line = class {
  constructor() {
    this.ForEntityName = "LINE";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value, vertices: [] };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.vertices.unshift(parsePoint(scanner));
          break;
        case 11:
          entity.vertices.push(parsePoint(scanner));
          break;
        case 210:
          entity.extrusionDirection = parsePoint(scanner);
          break;
        case 100:
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/lwpolyline.js
var Lwpolyline = class {
  constructor() {
    this.ForEntityName = "LWPOLYLINE";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value, vertices: [] };
    let numberOfVertices = 0;
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 38:
          entity.elevation = curr.value;
          break;
        case 39:
          entity.depth = curr.value;
          break;
        case 70:
          entity.shape = (curr.value & 1) === 1;
          entity.hasContinuousLinetypePattern = (curr.value & 128) === 128;
          break;
        case 90:
          numberOfVertices = curr.value;
          break;
        case 10:
          entity.vertices = parseLWPolylineVertices(numberOfVertices, scanner);
          break;
        case 43:
          if (curr.value !== 0)
            entity.width = curr.value;
          break;
        case 210:
          entity.extrusionDirectionX = curr.value;
          break;
        case 220:
          entity.extrusionDirectionY = curr.value;
          break;
        case 230:
          entity.extrusionDirectionZ = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};
function parseLWPolylineVertices(n, scanner) {
  if (!n || n <= 0)
    throw Error("n must be greater than 0 verticies");
  const vertices = [];
  let vertexIsStarted = false;
  let vertexIsFinished = false;
  let curr = scanner.lastReadGroup;
  for (let i = 0; i < n; i++) {
    const vertex = {};
    while (!scanner.isEOF()) {
      if (curr.code === 0 || vertexIsFinished)
        break;
      switch (curr.code) {
        case 10:
          if (vertexIsStarted) {
            vertexIsFinished = true;
            continue;
          }
          vertex.x = curr.value;
          vertexIsStarted = true;
          break;
        case 20:
          vertex.y = curr.value;
          break;
        case 30:
          vertex.z = curr.value;
          break;
        case 40:
          vertex.startWidth = curr.value;
          break;
        case 41:
          vertex.endWidth = curr.value;
          break;
        case 42:
          if (curr.value != 0)
            vertex.bulge = curr.value;
          break;
        default:
          scanner.rewind();
          if (vertexIsStarted) {
            vertices.push(vertex);
          }
          scanner.rewind();
          return vertices;
      }
      curr = scanner.next();
    }
    vertices.push(vertex);
    vertexIsStarted = false;
    vertexIsFinished = false;
  }
  scanner.rewind();
  return vertices;
}

// node_modules/dxf-parser/dist/entities/mtext.js
var Mtext = class {
  constructor() {
    this.ForEntityName = "MTEXT";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 3:
          entity.text ? entity.text += curr.value : entity.text = curr.value;
          break;
        case 1:
          entity.text ? entity.text += curr.value : entity.text = curr.value;
          break;
        case 10:
          entity.position = parsePoint(scanner);
          break;
        case 11:
          entity.directionVector = parsePoint(scanner);
          break;
        case 40:
          entity.height = curr.value;
          break;
        case 41:
          entity.width = curr.value;
          break;
        case 50:
          entity.rotation = curr.value;
          break;
        case 71:
          entity.attachmentPoint = curr.value;
          break;
        case 72:
          entity.drawingDirection = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/point.js
var Point = class {
  constructor() {
    this.ForEntityName = "POINT";
  }
  parseEntity(scanner, curr) {
    const type = curr.value;
    const entity = { type };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.position = parsePoint(scanner);
          break;
        case 39:
          entity.thickness = curr.value;
          break;
        case 210:
          entity.extrusionDirection = parsePoint(scanner);
          break;
        case 100:
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/vertex.js
var Vertex = class {
  constructor() {
    this.ForEntityName = "VERTEX";
  }
  parseEntity(scanner, curr) {
    var entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.x = curr.value;
          break;
        case 20:
          entity.y = curr.value;
          break;
        case 30:
          entity.z = curr.value;
          break;
        case 40:
          break;
        case 41:
          break;
        case 42:
          if (curr.value != 0)
            entity.bulge = curr.value;
          break;
        case 70:
          entity.curveFittingVertex = (curr.value & 1) !== 0;
          entity.curveFitTangent = (curr.value & 2) !== 0;
          entity.splineVertex = (curr.value & 8) !== 0;
          entity.splineControlPoint = (curr.value & 16) !== 0;
          entity.threeDPolylineVertex = (curr.value & 32) !== 0;
          entity.threeDPolylineMesh = (curr.value & 64) !== 0;
          entity.polyfaceMeshVertex = (curr.value & 128) !== 0;
          break;
        case 50:
          break;
        case 71:
          entity.faceA = curr.value;
          break;
        case 72:
          entity.faceB = curr.value;
          break;
        case 73:
          entity.faceC = curr.value;
          break;
        case 74:
          entity.faceD = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/polyline.js
var Polyline = class {
  constructor() {
    this.ForEntityName = "POLYLINE";
  }
  parseEntity(scanner, curr) {
    var entity = { type: curr.value, vertices: [] };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          break;
        case 20:
          break;
        case 30:
          break;
        case 39:
          entity.thickness = curr.value;
          break;
        case 40:
          break;
        case 41:
          break;
        case 70:
          entity.shape = (curr.value & 1) !== 0;
          entity.includesCurveFitVertices = (curr.value & 2) !== 0;
          entity.includesSplineFitVertices = (curr.value & 4) !== 0;
          entity.is3dPolyline = (curr.value & 8) !== 0;
          entity.is3dPolygonMesh = (curr.value & 16) !== 0;
          entity.is3dPolygonMeshClosed = (curr.value & 32) !== 0;
          entity.isPolyfaceMesh = (curr.value & 64) !== 0;
          entity.hasContinuousLinetypePattern = (curr.value & 128) !== 0;
          break;
        case 71:
          break;
        case 72:
          break;
        case 73:
          break;
        case 74:
          break;
        case 75:
          break;
        case 210:
          entity.extrusionDirection = parsePoint(scanner);
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    entity.vertices = parsePolylineVertices(scanner, curr);
    return entity;
  }
};
function parsePolylineVertices(scanner, curr) {
  const vertexParser = new Vertex();
  const vertices = [];
  while (!scanner.isEOF()) {
    if (curr.code === 0) {
      if (curr.value === "VERTEX") {
        vertices.push(vertexParser.parseEntity(scanner, curr));
        curr = scanner.lastReadGroup;
      } else if (curr.value === "SEQEND") {
        parseSeqEnd(scanner, curr);
        break;
      }
    }
  }
  return vertices;
}
function parseSeqEnd(scanner, curr) {
  const entity = { type: curr.value };
  curr = scanner.next();
  while (!scanner.isEOF()) {
    if (curr.code == 0)
      break;
    checkCommonEntityProperties(entity, curr, scanner);
    curr = scanner.next();
  }
  return entity;
}

// node_modules/dxf-parser/dist/entities/solid.js
var Solid = class {
  constructor() {
    this.ForEntityName = "SOLID";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value, points: [] };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.points[0] = parsePoint(scanner);
          break;
        case 11:
          entity.points[1] = parsePoint(scanner);
          break;
        case 12:
          entity.points[2] = parsePoint(scanner);
          break;
        case 13:
          entity.points[3] = parsePoint(scanner);
          break;
        case 210:
          entity.extrusionDirection = parsePoint(scanner);
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/spline.js
var Spline = class {
  constructor() {
    this.ForEntityName = "SPLINE";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          if (!entity.controlPoints)
            entity.controlPoints = [];
          entity.controlPoints.push(parsePoint(scanner));
          break;
        case 11:
          if (!entity.fitPoints)
            entity.fitPoints = [];
          entity.fitPoints.push(parsePoint(scanner));
          break;
        case 12:
          entity.startTangent = parsePoint(scanner);
          break;
        case 13:
          entity.endTangent = parsePoint(scanner);
          break;
        case 40:
          if (!entity.knotValues)
            entity.knotValues = [];
          entity.knotValues.push(curr.value);
          break;
        case 70:
          if ((curr.value & 1) != 0)
            entity.closed = true;
          if ((curr.value & 2) != 0)
            entity.periodic = true;
          if ((curr.value & 4) != 0)
            entity.rational = true;
          if ((curr.value & 8) != 0)
            entity.planar = true;
          if ((curr.value & 16) != 0) {
            entity.planar = true;
            entity.linear = true;
          }
          break;
        case 71:
          entity.degreeOfSplineCurve = curr.value;
          break;
        case 72:
          entity.numberOfKnots = curr.value;
          break;
        case 73:
          entity.numberOfControlPoints = curr.value;
          break;
        case 74:
          entity.numberOfFitPoints = curr.value;
          break;
        case 210:
          entity.normalVector = parsePoint(scanner);
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/entities/text.js
var Text = class {
  constructor() {
    this.ForEntityName = "TEXT";
  }
  parseEntity(scanner, curr) {
    const entity = { type: curr.value };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0)
        break;
      switch (curr.code) {
        case 10:
          entity.startPoint = parsePoint(scanner);
          break;
        case 11:
          entity.endPoint = parsePoint(scanner);
          break;
        case 40:
          entity.textHeight = curr.value;
          break;
        case 41:
          entity.xScale = curr.value;
          break;
        case 50:
          entity.rotation = curr.value;
          break;
        case 1:
          entity.text = curr.value;
          break;
        // NOTE: 72 and 73 are meaningless without 11 (second alignment point)
        case 72:
          entity.halign = curr.value;
          break;
        case 73:
          entity.valign = curr.value;
          break;
        default:
          checkCommonEntityProperties(entity, curr, scanner);
          break;
      }
      curr = scanner.next();
    }
    return entity;
  }
};

// node_modules/dxf-parser/dist/DxfParser.js
var import_loglevel = __toESM(require_loglevel());
import_loglevel.default.setLevel("error");
function registerDefaultEntityHandlers(dxfParser) {
  dxfParser.registerEntityHandler(ThreeDface);
  dxfParser.registerEntityHandler(Arc);
  dxfParser.registerEntityHandler(Attdef);
  dxfParser.registerEntityHandler(Circle);
  dxfParser.registerEntityHandler(Dimension);
  dxfParser.registerEntityHandler(Ellipse);
  dxfParser.registerEntityHandler(Insert);
  dxfParser.registerEntityHandler(Line);
  dxfParser.registerEntityHandler(Lwpolyline);
  dxfParser.registerEntityHandler(Mtext);
  dxfParser.registerEntityHandler(Point);
  dxfParser.registerEntityHandler(Polyline);
  dxfParser.registerEntityHandler(Solid);
  dxfParser.registerEntityHandler(Spline);
  dxfParser.registerEntityHandler(Text);
}
var DxfParser = class {
  constructor() {
    this._entityHandlers = {};
    registerDefaultEntityHandlers(this);
  }
  parse(source) {
    if (typeof source === "string") {
      return this._parse(source);
    } else {
      console.error("Cannot read dxf source of type `" + typeof source);
      return null;
    }
  }
  registerEntityHandler(handlerType) {
    const instance = new handlerType();
    this._entityHandlers[instance.ForEntityName] = instance;
  }
  parseSync(source) {
    return this.parse(source);
  }
  parseStream(stream) {
    let dxfString = "";
    const self = this;
    return new Promise((res, rej) => {
      stream.on("data", (chunk) => {
        dxfString += chunk;
      });
      stream.on("end", () => {
        try {
          res(self._parse(dxfString));
        } catch (err) {
          rej(err);
        }
      });
      stream.on("error", (err) => {
        rej(err);
      });
    });
  }
  _parse(dxfString) {
    const dxf = {};
    let lastHandle = 0;
    const dxfLinesArray = dxfString.split(/\r\n|\r|\n/g);
    const scanner = new DxfArrayScanner(dxfLinesArray);
    if (!scanner.hasNext())
      throw Error("Empty file");
    const self = this;
    let curr;
    function parseAll() {
      curr = scanner.next();
      while (!scanner.isEOF()) {
        if (curr.code === 0 && curr.value === "SECTION") {
          curr = scanner.next();
          if (curr.code !== 2) {
            console.error("Unexpected code %s after 0:SECTION", debugCode(curr));
            curr = scanner.next();
            continue;
          }
          if (curr.value === "HEADER") {
            import_loglevel.default.debug("> HEADER");
            dxf.header = parseHeader();
            import_loglevel.default.debug("<");
          } else if (curr.value === "BLOCKS") {
            import_loglevel.default.debug("> BLOCKS");
            dxf.blocks = parseBlocks();
            import_loglevel.default.debug("<");
          } else if (curr.value === "ENTITIES") {
            import_loglevel.default.debug("> ENTITIES");
            dxf.entities = parseEntities(false);
            import_loglevel.default.debug("<");
          } else if (curr.value === "TABLES") {
            import_loglevel.default.debug("> TABLES");
            dxf.tables = parseTables();
            import_loglevel.default.debug("<");
          } else if (curr.value === "EOF") {
            import_loglevel.default.debug("EOF");
          } else {
            import_loglevel.default.warn("Skipping section '%s'", curr.value);
          }
        } else {
          curr = scanner.next();
        }
      }
    }
    function parseHeader() {
      let currVarName = null;
      let currVarValue = null;
      const header = {};
      curr = scanner.next();
      while (true) {
        if (groupIs(curr, 0, "ENDSEC")) {
          if (currVarName)
            header[currVarName] = currVarValue;
          break;
        } else if (curr.code === 9) {
          if (currVarName)
            header[currVarName] = currVarValue;
          currVarName = curr.value;
        } else {
          if (curr.code === 10) {
            currVarValue = { x: curr.value };
          } else if (curr.code === 20) {
            currVarValue.y = curr.value;
          } else if (curr.code === 30) {
            currVarValue.z = curr.value;
          } else {
            currVarValue = curr.value;
          }
        }
        curr = scanner.next();
      }
      curr = scanner.next();
      return header;
    }
    function parseBlocks() {
      const blocks = {};
      curr = scanner.next();
      while (curr.value !== "EOF") {
        if (groupIs(curr, 0, "ENDSEC")) {
          break;
        }
        if (groupIs(curr, 0, "BLOCK")) {
          import_loglevel.default.debug("block {");
          const block = parseBlock();
          import_loglevel.default.debug("}");
          ensureHandle(block);
          if (!block.name)
            import_loglevel.default.error('block with handle "' + block.handle + '" is missing a name.');
          else
            blocks[block.name] = block;
        } else {
          logUnhandledGroup(curr);
          curr = scanner.next();
        }
      }
      return blocks;
    }
    function parseBlock() {
      const block = {};
      curr = scanner.next();
      while (curr.value !== "EOF") {
        switch (curr.code) {
          case 1:
            block.xrefPath = curr.value;
            curr = scanner.next();
            break;
          case 2:
            block.name = curr.value;
            curr = scanner.next();
            break;
          case 3:
            block.name2 = curr.value;
            curr = scanner.next();
            break;
          case 5:
            block.handle = curr.value;
            curr = scanner.next();
            break;
          case 8:
            block.layer = curr.value;
            curr = scanner.next();
            break;
          case 10:
            block.position = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 67:
            block.paperSpace = curr.value && curr.value == 1 ? true : false;
            curr = scanner.next();
            break;
          case 70:
            if (curr.value != 0) {
              block.type = curr.value;
            }
            curr = scanner.next();
            break;
          case 100:
            curr = scanner.next();
            break;
          case 330:
            block.ownerHandle = curr.value;
            curr = scanner.next();
            break;
          case 0:
            if (curr.value == "ENDBLK")
              break;
            block.entities = parseEntities(true);
            break;
          default:
            logUnhandledGroup(curr);
            curr = scanner.next();
        }
        if (groupIs(curr, 0, "ENDBLK")) {
          curr = scanner.next();
          break;
        }
      }
      return block;
    }
    function parseTables() {
      const tables = {};
      curr = scanner.next();
      while (curr.value !== "EOF") {
        if (groupIs(curr, 0, "ENDSEC"))
          break;
        if (groupIs(curr, 0, "TABLE")) {
          curr = scanner.next();
          const tableDefinition = tableDefinitions[curr.value];
          if (tableDefinition) {
            import_loglevel.default.debug(curr.value + " Table {");
            tables[tableDefinitions[curr.value].tableName] = parseTable(curr);
            import_loglevel.default.debug("}");
          } else {
            import_loglevel.default.debug("Unhandled Table " + curr.value);
          }
        } else {
          curr = scanner.next();
        }
      }
      curr = scanner.next();
      return tables;
    }
    const END_OF_TABLE_VALUE = "ENDTAB";
    function parseTable(group) {
      const tableDefinition = tableDefinitions[group.value];
      const table = {};
      let expectedCount = 0;
      curr = scanner.next();
      while (!groupIs(curr, 0, END_OF_TABLE_VALUE)) {
        switch (curr.code) {
          case 5:
            table.handle = curr.value;
            curr = scanner.next();
            break;
          case 330:
            table.ownerHandle = curr.value;
            curr = scanner.next();
            break;
          case 100:
            if (curr.value === "AcDbSymbolTable") {
              curr = scanner.next();
            } else {
              logUnhandledGroup(curr);
              curr = scanner.next();
            }
            break;
          case 70:
            expectedCount = curr.value;
            curr = scanner.next();
            break;
          case 0:
            if (curr.value === tableDefinition.dxfSymbolName) {
              table[tableDefinition.tableRecordsProperty] = tableDefinition.parseTableRecords();
            } else {
              logUnhandledGroup(curr);
              curr = scanner.next();
            }
            break;
          default:
            logUnhandledGroup(curr);
            curr = scanner.next();
        }
      }
      const tableRecords = table[tableDefinition.tableRecordsProperty];
      if (tableRecords) {
        let actualCount = (() => {
          if (tableRecords.constructor === Array) {
            return tableRecords.length;
          } else if (typeof tableRecords === "object") {
            return Object.keys(tableRecords).length;
          }
          return void 0;
        })();
        if (expectedCount !== actualCount)
          import_loglevel.default.warn("Parsed " + actualCount + " " + tableDefinition.dxfSymbolName + "'s but expected " + expectedCount);
      }
      curr = scanner.next();
      return table;
    }
    function parseViewPortRecords() {
      const viewPorts = [];
      let viewPort = {};
      import_loglevel.default.debug("ViewPort {");
      curr = scanner.next();
      while (!groupIs(curr, 0, END_OF_TABLE_VALUE)) {
        switch (curr.code) {
          case 2:
            viewPort.name = curr.value;
            curr = scanner.next();
            break;
          case 10:
            viewPort.lowerLeftCorner = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 11:
            viewPort.upperRightCorner = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 12:
            viewPort.center = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 13:
            viewPort.snapBasePoint = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 14:
            viewPort.snapSpacing = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 15:
            viewPort.gridSpacing = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 16:
            viewPort.viewDirectionFromTarget = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 17:
            viewPort.viewTarget = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 42:
            viewPort.lensLength = curr.value;
            curr = scanner.next();
            break;
          case 43:
            viewPort.frontClippingPlane = curr.value;
            curr = scanner.next();
            break;
          case 44:
            viewPort.backClippingPlane = curr.value;
            curr = scanner.next();
            break;
          case 45:
            viewPort.viewHeight = curr.value;
            curr = scanner.next();
            break;
          case 50:
            viewPort.snapRotationAngle = curr.value;
            curr = scanner.next();
            break;
          case 51:
            viewPort.viewTwistAngle = curr.value;
            curr = scanner.next();
            break;
          case 79:
            viewPort.orthographicType = curr.value;
            curr = scanner.next();
            break;
          case 110:
            viewPort.ucsOrigin = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 111:
            viewPort.ucsXAxis = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 112:
            viewPort.ucsYAxis = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 110:
            viewPort.ucsOrigin = parsePoint2(curr);
            curr = scanner.next();
            break;
          case 281:
            viewPort.renderMode = curr.value;
            curr = scanner.next();
            break;
          case 281:
            viewPort.defaultLightingType = curr.value;
            curr = scanner.next();
            break;
          case 292:
            viewPort.defaultLightingOn = curr.value;
            curr = scanner.next();
            break;
          case 330:
            viewPort.ownerHandle = curr.value;
            curr = scanner.next();
            break;
          case 63:
          // These are all ambient color. Perhaps should be a gradient when multiple are set.
          case 421:
          case 431:
            viewPort.ambientColor = curr.value;
            curr = scanner.next();
            break;
          case 0:
            if (curr.value === "VPORT") {
              import_loglevel.default.debug("}");
              viewPorts.push(viewPort);
              import_loglevel.default.debug("ViewPort {");
              viewPort = {};
              curr = scanner.next();
            }
            break;
          default:
            logUnhandledGroup(curr);
            curr = scanner.next();
            break;
        }
      }
      import_loglevel.default.debug("}");
      viewPorts.push(viewPort);
      return viewPorts;
    }
    function parseLineTypes() {
      const ltypes = {};
      let ltype = {};
      let length = 0;
      let ltypeName;
      import_loglevel.default.debug("LType {");
      curr = scanner.next();
      while (!groupIs(curr, 0, "ENDTAB")) {
        switch (curr.code) {
          case 2:
            ltype.name = curr.value;
            ltypeName = curr.value;
            curr = scanner.next();
            break;
          case 3:
            ltype.description = curr.value;
            curr = scanner.next();
            break;
          case 73:
            length = curr.value;
            if (length > 0)
              ltype.pattern = [];
            curr = scanner.next();
            break;
          case 40:
            ltype.patternLength = curr.value;
            curr = scanner.next();
            break;
          case 49:
            ltype.pattern.push(curr.value);
            curr = scanner.next();
            break;
          case 0:
            import_loglevel.default.debug("}");
            if (length > 0 && length !== ltype.pattern.length)
              import_loglevel.default.warn("lengths do not match on LTYPE pattern");
            ltypes[ltypeName] = ltype;
            ltype = {};
            import_loglevel.default.debug("LType {");
            curr = scanner.next();
            break;
          default:
            curr = scanner.next();
        }
      }
      import_loglevel.default.debug("}");
      ltypes[ltypeName] = ltype;
      return ltypes;
    }
    function parseLayers() {
      const layers = {};
      let layer = {};
      let layerName;
      import_loglevel.default.debug("Layer {");
      curr = scanner.next();
      while (!groupIs(curr, 0, "ENDTAB")) {
        switch (curr.code) {
          case 2:
            layer.name = curr.value;
            layerName = curr.value;
            curr = scanner.next();
            break;
          case 62:
            layer.visible = curr.value >= 0;
            layer.colorIndex = Math.abs(curr.value);
            layer.color = getAcadColor2(layer.colorIndex);
            curr = scanner.next();
            break;
          case 70:
            layer.frozen = (curr.value & 1) != 0 || (curr.value & 2) != 0;
            curr = scanner.next();
            break;
          case 0:
            if (curr.value === "LAYER") {
              import_loglevel.default.debug("}");
              layers[layerName] = layer;
              import_loglevel.default.debug("Layer {");
              layer = {};
              layerName = void 0;
              curr = scanner.next();
            }
            break;
          default:
            logUnhandledGroup(curr);
            curr = scanner.next();
            break;
        }
      }
      import_loglevel.default.debug("}");
      layers[layerName] = layer;
      return layers;
    }
    const tableDefinitions = {
      VPORT: {
        tableRecordsProperty: "viewPorts",
        tableName: "viewPort",
        dxfSymbolName: "VPORT",
        parseTableRecords: parseViewPortRecords
      },
      LTYPE: {
        tableRecordsProperty: "lineTypes",
        tableName: "lineType",
        dxfSymbolName: "LTYPE",
        parseTableRecords: parseLineTypes
      },
      LAYER: {
        tableRecordsProperty: "layers",
        tableName: "layer",
        dxfSymbolName: "LAYER",
        parseTableRecords: parseLayers
      }
    };
    function parseEntities(forBlock) {
      const entities = [];
      const endingOnValue = forBlock ? "ENDBLK" : "ENDSEC";
      if (!forBlock) {
        curr = scanner.next();
      }
      while (true) {
        if (curr.code === 0) {
          if (curr.value === endingOnValue) {
            break;
          }
          const handler = self._entityHandlers[curr.value];
          if (handler != null) {
            import_loglevel.default.debug(curr.value + " {");
            const entity = handler.parseEntity(scanner, curr);
            curr = scanner.lastReadGroup;
            import_loglevel.default.debug("}");
            ensureHandle(entity);
            entities.push(entity);
          } else {
            import_loglevel.default.warn("Unhandled entity " + curr.value);
            curr = scanner.next();
            continue;
          }
        } else {
          curr = scanner.next();
        }
      }
      if (endingOnValue == "ENDSEC")
        curr = scanner.next();
      return entities;
    }
    function parsePoint2(curr2) {
      const point = {};
      let code = curr2.code;
      point.x = curr2.value;
      code += 10;
      curr2 = scanner.next();
      if (curr2.code != code)
        throw new Error("Expected code for point value to be " + code + " but got " + curr2.code + ".");
      point.y = curr2.value;
      code += 10;
      curr2 = scanner.next();
      if (curr2.code != code) {
        scanner.rewind();
        return point;
      }
      point.z = curr2.value;
      return point;
    }
    function ensureHandle(entity) {
      if (!entity)
        throw new TypeError("entity cannot be undefined or null");
      if (!entity.handle)
        entity.handle = lastHandle++;
    }
    parseAll();
    return dxf;
  }
};
function groupIs(group, code, value) {
  return group.code === code && group.value === value;
}
function logUnhandledGroup(curr) {
  import_loglevel.default.debug("unhandled group " + debugCode(curr));
}
function debugCode(curr) {
  return curr.code + ":" + curr.value;
}
function getAcadColor2(index) {
  return AutoCadColorIndex_default[index];
}

// node_modules/dxf-parser/dist/index.js
var dist_default = DxfParser;

// parser/dwg/dxf-loader.js
function parseDxfText(dxfText) {
  if (typeof dxfText !== "string" || dxfText.length === 0) {
    return {
      posts: [],
      cableEdges: [],
      extmin: { x: 0, y: 0 },
      extmax: { x: 0, y: 0 }
    };
  }
  const dxf = new dist_default().parseSync(dxfText);
  const extmin = {
    x: dxf?.header?.$EXTMIN?.x ?? 0,
    y: dxf?.header?.$EXTMIN?.y ?? 0
  };
  const extmax = {
    x: dxf?.header?.$EXTMAX?.x ?? 0,
    y: dxf?.header?.$EXTMAX?.y ?? 0
  };
  const entities = Array.isArray(dxf?.entities) ? dxf.entities : [];
  const posts = [];
  const cableEdges = [];
  for (const entity of entities) {
    if (entity?.type === "INSERT" && entity?.layer === "Poste") {
      const x = entity?.position?.x;
      const y = entity?.position?.y;
      if (typeof x === "number" && typeof y === "number") {
        posts.push({ x, y, block: entity?.name ?? "unknown" });
      }
      continue;
    }
    if (entity?.type === "LWPOLYLINE" && entity?.layer === "TrechoSecundarioAereo") {
      const vertices = entity?.vertices;
      if (Array.isArray(vertices) && vertices.length >= 2) {
        const a2 = vertices[0];
        const b = vertices[vertices.length - 1];
        if (a2 && b && typeof a2.x === "number" && typeof a2.y === "number" && typeof b.x === "number" && typeof b.y === "number") {
          cableEdges.push({ a: { x: a2.x, y: a2.y }, b: { x: b.x, y: b.y } });
        }
      }
    }
  }
  return { posts, cableEdges, extmin, extmax };
}

// node_modules/quickselect/index.js
function quickselect(arr, k, left = 0, right = arr.length - 1, compare = defaultCompare) {
  while (right > left) {
    if (right - left > 600) {
      const n = right - left + 1;
      const m = k - left + 1;
      const z = Math.log(n);
      const s = 0.5 * Math.exp(2 * z / 3);
      const sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
      const newLeft = Math.max(left, Math.floor(k - m * s / n + sd));
      const newRight = Math.min(right, Math.floor(k + (n - m) * s / n + sd));
      quickselect(arr, k, newLeft, newRight, compare);
    }
    const t = arr[k];
    let i = left;
    let j = right;
    swap(arr, left, k);
    if (compare(arr[right], t) > 0) swap(arr, left, right);
    while (i < j) {
      swap(arr, i, j);
      i++;
      j--;
      while (compare(arr[i], t) < 0) i++;
      while (compare(arr[j], t) > 0) j--;
    }
    if (compare(arr[left], t) === 0) swap(arr, left, j);
    else {
      j++;
      swap(arr, j, right);
    }
    if (j <= k) left = j + 1;
    if (k <= j) right = j - 1;
  }
}
function swap(arr, i, j) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}
function defaultCompare(a2, b) {
  return a2 < b ? -1 : a2 > b ? 1 : 0;
}

// node_modules/rbush/index.js
var RBush = class {
  constructor(maxEntries = 9) {
    this._maxEntries = Math.max(4, maxEntries);
    this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));
    this.clear();
  }
  all() {
    return this._all(this.data, []);
  }
  search(bbox) {
    let node = this.data;
    const result = [];
    if (!intersects(bbox, node)) return result;
    const toBBox = this.toBBox;
    const nodesToSearch = [];
    while (node) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const childBBox = node.leaf ? toBBox(child) : child;
        if (intersects(bbox, childBBox)) {
          if (node.leaf) result.push(child);
          else if (contains(bbox, childBBox)) this._all(child, result);
          else nodesToSearch.push(child);
        }
      }
      node = nodesToSearch.pop();
    }
    return result;
  }
  collides(bbox) {
    let node = this.data;
    if (!intersects(bbox, node)) return false;
    const nodesToSearch = [];
    while (node) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const childBBox = node.leaf ? this.toBBox(child) : child;
        if (intersects(bbox, childBBox)) {
          if (node.leaf || contains(bbox, childBBox)) return true;
          nodesToSearch.push(child);
        }
      }
      node = nodesToSearch.pop();
    }
    return false;
  }
  load(data) {
    if (!(data && data.length)) return this;
    if (data.length < this._minEntries) {
      for (let i = 0; i < data.length; i++) {
        this.insert(data[i]);
      }
      return this;
    }
    let node = this._build(data.slice(), 0, data.length - 1, 0);
    if (!this.data.children.length) {
      this.data = node;
    } else if (this.data.height === node.height) {
      this._splitRoot(this.data, node);
    } else {
      if (this.data.height < node.height) {
        const tmpNode = this.data;
        this.data = node;
        node = tmpNode;
      }
      this._insert(node, this.data.height - node.height - 1, true);
    }
    return this;
  }
  insert(item) {
    if (item) this._insert(item, this.data.height - 1);
    return this;
  }
  clear() {
    this.data = createNode([]);
    return this;
  }
  remove(item, equalsFn) {
    if (!item) return this;
    let node = this.data;
    const bbox = this.toBBox(item);
    const path = [];
    const indexes = [];
    let i, parent, goingUp;
    while (node || path.length) {
      if (!node) {
        node = path.pop();
        parent = path[path.length - 1];
        i = indexes.pop();
        goingUp = true;
      }
      if (node.leaf) {
        const index = findItem(item, node.children, equalsFn);
        if (index !== -1) {
          node.children.splice(index, 1);
          path.push(node);
          this._condense(path);
          return this;
        }
      }
      if (!goingUp && !node.leaf && contains(node, bbox)) {
        path.push(node);
        indexes.push(i);
        i = 0;
        parent = node;
        node = node.children[0];
      } else if (parent) {
        i++;
        node = parent.children[i];
        goingUp = false;
      } else node = null;
    }
    return this;
  }
  toBBox(item) {
    return item;
  }
  compareMinX(a2, b) {
    return a2.minX - b.minX;
  }
  compareMinY(a2, b) {
    return a2.minY - b.minY;
  }
  toJSON() {
    return this.data;
  }
  fromJSON(data) {
    this.data = data;
    return this;
  }
  _all(node, result) {
    const nodesToSearch = [];
    while (node) {
      if (node.leaf) result.push(...node.children);
      else nodesToSearch.push(...node.children);
      node = nodesToSearch.pop();
    }
    return result;
  }
  _build(items, left, right, height) {
    const N = right - left + 1;
    let M = this._maxEntries;
    let node;
    if (N <= M) {
      node = createNode(items.slice(left, right + 1));
      calcBBox(node, this.toBBox);
      return node;
    }
    if (!height) {
      height = Math.ceil(Math.log(N) / Math.log(M));
      M = Math.ceil(N / Math.pow(M, height - 1));
    }
    node = createNode([]);
    node.leaf = false;
    node.height = height;
    const N2 = Math.ceil(N / M);
    const N1 = N2 * Math.ceil(Math.sqrt(M));
    multiSelect(items, left, right, N1, this.compareMinX);
    for (let i = left; i <= right; i += N1) {
      const right2 = Math.min(i + N1 - 1, right);
      multiSelect(items, i, right2, N2, this.compareMinY);
      for (let j = i; j <= right2; j += N2) {
        const right3 = Math.min(j + N2 - 1, right2);
        node.children.push(this._build(items, j, right3, height - 1));
      }
    }
    calcBBox(node, this.toBBox);
    return node;
  }
  _chooseSubtree(bbox, node, level, path) {
    while (true) {
      path.push(node);
      if (node.leaf || path.length - 1 === level) break;
      let minArea = Infinity;
      let minEnlargement = Infinity;
      let targetNode;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const area = bboxArea(child);
        const enlargement = enlargedArea(bbox, child) - area;
        if (enlargement < minEnlargement) {
          minEnlargement = enlargement;
          minArea = area < minArea ? area : minArea;
          targetNode = child;
        } else if (enlargement === minEnlargement) {
          if (area < minArea) {
            minArea = area;
            targetNode = child;
          }
        }
      }
      node = targetNode || node.children[0];
    }
    return node;
  }
  _insert(item, level, isNode) {
    const bbox = isNode ? item : this.toBBox(item);
    const insertPath = [];
    const node = this._chooseSubtree(bbox, this.data, level, insertPath);
    node.children.push(item);
    extend(node, bbox);
    while (level >= 0) {
      if (insertPath[level].children.length > this._maxEntries) {
        this._split(insertPath, level);
        level--;
      } else break;
    }
    this._adjustParentBBoxes(bbox, insertPath, level);
  }
  // split overflowed node into two
  _split(insertPath, level) {
    const node = insertPath[level];
    const M = node.children.length;
    const m = this._minEntries;
    this._chooseSplitAxis(node, m, M);
    const splitIndex = this._chooseSplitIndex(node, m, M);
    const newNode = createNode(node.children.splice(splitIndex, node.children.length - splitIndex));
    newNode.height = node.height;
    newNode.leaf = node.leaf;
    calcBBox(node, this.toBBox);
    calcBBox(newNode, this.toBBox);
    if (level) insertPath[level - 1].children.push(newNode);
    else this._splitRoot(node, newNode);
  }
  _splitRoot(node, newNode) {
    this.data = createNode([node, newNode]);
    this.data.height = node.height + 1;
    this.data.leaf = false;
    calcBBox(this.data, this.toBBox);
  }
  _chooseSplitIndex(node, m, M) {
    let index;
    let minOverlap = Infinity;
    let minArea = Infinity;
    for (let i = m; i <= M - m; i++) {
      const bbox1 = distBBox(node, 0, i, this.toBBox);
      const bbox2 = distBBox(node, i, M, this.toBBox);
      const overlap = intersectionArea(bbox1, bbox2);
      const area = bboxArea(bbox1) + bboxArea(bbox2);
      if (overlap < minOverlap) {
        minOverlap = overlap;
        index = i;
        minArea = area < minArea ? area : minArea;
      } else if (overlap === minOverlap) {
        if (area < minArea) {
          minArea = area;
          index = i;
        }
      }
    }
    return index || M - m;
  }
  // sorts node children by the best axis for split
  _chooseSplitAxis(node, m, M) {
    const compareMinX = node.leaf ? this.compareMinX : compareNodeMinX;
    const compareMinY = node.leaf ? this.compareMinY : compareNodeMinY;
    const xMargin = this._allDistMargin(node, m, M, compareMinX);
    const yMargin = this._allDistMargin(node, m, M, compareMinY);
    if (xMargin < yMargin) node.children.sort(compareMinX);
  }
  // total margin of all possible split distributions where each node is at least m full
  _allDistMargin(node, m, M, compare) {
    node.children.sort(compare);
    const toBBox = this.toBBox;
    const leftBBox = distBBox(node, 0, m, toBBox);
    const rightBBox = distBBox(node, M - m, M, toBBox);
    let margin = bboxMargin(leftBBox) + bboxMargin(rightBBox);
    for (let i = m; i < M - m; i++) {
      const child = node.children[i];
      extend(leftBBox, node.leaf ? toBBox(child) : child);
      margin += bboxMargin(leftBBox);
    }
    for (let i = M - m - 1; i >= m; i--) {
      const child = node.children[i];
      extend(rightBBox, node.leaf ? toBBox(child) : child);
      margin += bboxMargin(rightBBox);
    }
    return margin;
  }
  _adjustParentBBoxes(bbox, path, level) {
    for (let i = level; i >= 0; i--) {
      extend(path[i], bbox);
    }
  }
  _condense(path) {
    for (let i = path.length - 1, siblings; i >= 0; i--) {
      if (path[i].children.length === 0) {
        if (i > 0) {
          siblings = path[i - 1].children;
          siblings.splice(siblings.indexOf(path[i]), 1);
        } else this.clear();
      } else calcBBox(path[i], this.toBBox);
    }
  }
};
function findItem(item, items, equalsFn) {
  if (!equalsFn) return items.indexOf(item);
  for (let i = 0; i < items.length; i++) {
    if (equalsFn(item, items[i])) return i;
  }
  return -1;
}
function calcBBox(node, toBBox) {
  distBBox(node, 0, node.children.length, toBBox, node);
}
function distBBox(node, k, p, toBBox, destNode) {
  if (!destNode) destNode = createNode(null);
  destNode.minX = Infinity;
  destNode.minY = Infinity;
  destNode.maxX = -Infinity;
  destNode.maxY = -Infinity;
  for (let i = k; i < p; i++) {
    const child = node.children[i];
    extend(destNode, node.leaf ? toBBox(child) : child);
  }
  return destNode;
}
function extend(a2, b) {
  a2.minX = Math.min(a2.minX, b.minX);
  a2.minY = Math.min(a2.minY, b.minY);
  a2.maxX = Math.max(a2.maxX, b.maxX);
  a2.maxY = Math.max(a2.maxY, b.maxY);
  return a2;
}
function compareNodeMinX(a2, b) {
  return a2.minX - b.minX;
}
function compareNodeMinY(a2, b) {
  return a2.minY - b.minY;
}
function bboxArea(a2) {
  return (a2.maxX - a2.minX) * (a2.maxY - a2.minY);
}
function bboxMargin(a2) {
  return a2.maxX - a2.minX + (a2.maxY - a2.minY);
}
function enlargedArea(a2, b) {
  return (Math.max(b.maxX, a2.maxX) - Math.min(b.minX, a2.minX)) * (Math.max(b.maxY, a2.maxY) - Math.min(b.minY, a2.minY));
}
function intersectionArea(a2, b) {
  const minX = Math.max(a2.minX, b.minX);
  const minY = Math.max(a2.minY, b.minY);
  const maxX = Math.min(a2.maxX, b.maxX);
  const maxY = Math.min(a2.maxY, b.maxY);
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}
function contains(a2, b) {
  return a2.minX <= b.minX && a2.minY <= b.minY && b.maxX <= a2.maxX && b.maxY <= a2.maxY;
}
function intersects(a2, b) {
  return b.minX <= a2.maxX && b.minY <= a2.maxY && b.maxX >= a2.minX && b.maxY >= a2.minY;
}
function createNode(children) {
  return {
    children,
    height: 1,
    leaf: true,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
}
function multiSelect(arr, left, right, n, compare) {
  const stack = [left, right];
  while (stack.length) {
    right = stack.pop();
    left = stack.pop();
    if (right - left <= n) continue;
    const mid = left + Math.ceil((right - left) / n / 2) * n;
    quickselect(arr, mid, left, right, compare);
    stack.push(left, mid, mid, right);
  }
}

// parser/geo/utm-calibrator.js
var a = 6378137;
var f = 1 / 298.257223563;
var k0 = 0.9996;
var E0 = 5e5;
var N0_south = 1e7;
function latLonToUtm(lat_deg, lon_deg) {
  const zone = Math.floor((lon_deg + 180) / 6) + 1;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat_deg * Math.PI / 180;
  const lambda = lon_deg * Math.PI / 180;
  const b = a * (1 - f);
  const e2 = 1 - b * b / (a * a);
  const e_p2 = e2 / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = e_p2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lambda - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - 35 * e2 ** 3 / 3072 * Math.sin(6 * phi));
  const easting = E0 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * e_p2) * A ** 5 / 120);
  const northing = N0_south + k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * e_p2) * A ** 6 / 720));
  return { easting, northing, zone };
}
function utmToLatLon(easting, northing, zone) {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const b = a * (1 - f);
  const e2 = 1 - b * b / (a * a);
  const e_p2 = e2 / (1 - e2);
  const x = easting - E0;
  const y = northing - N0_south;
  const M1 = y / k0;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = M1 / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + 151 * e1 ** 3 / 96 * Math.sin(6 * mu) + 1097 * e1 ** 4 / 512 * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = e_p2 * Math.cos(phi1) ** 2;
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - N1 * Math.tan(phi1) / R1 * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * e_p2) * D ** 4 / 24);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6) / Math.cos(phi1);
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// parser/dwg/region-pairing.js
var DEFAULT_TOLERANCE_M = 15;
var GAP_TOLERANCE_M = 25;
var ADJACENCY_SNAP_M = 3;
var PostIndex = class extends RBush {
  toBBox(post) {
    return { minX: post.x, minY: post.y, maxX: post.x, maxY: post.y };
  }
  compareMinX(a2, b) {
    return a2.x - b.x;
  }
  compareMinY(a2, b) {
    return a2.y - b.y;
  }
};
function buildPostIndex(posts) {
  const tree = new PostIndex();
  if (!Array.isArray(posts) || posts.length === 0) return tree;
  return tree.load(posts);
}
function restorePostIndexFromDump(rbushDump) {
  const tree = new PostIndex();
  if (!rbushDump) return tree;
  return tree.fromJSON(rbushDump);
}
function nearestPostIndexWithin(posts, x, y, tol) {
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= tol && d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
function buildAdjacencyGraph(posts, cableEdges) {
  const adjacency = /* @__PURE__ */ new Map();
  if (!Array.isArray(posts) || posts.length === 0) return adjacency;
  const ensure = (idx) => {
    let s = adjacency.get(idx);
    if (!s) {
      s = /* @__PURE__ */ new Set();
      adjacency.set(idx, s);
    }
    return s;
  };
  for (const e of cableEdges ?? []) {
    const a2 = e?.a;
    const b = e?.b;
    if (!a2 || !b) continue;
    if (typeof a2.x !== "number" || typeof a2.y !== "number") continue;
    if (typeof b.x !== "number" || typeof b.y !== "number") continue;
    const iA = nearestPostIndexWithin(posts, a2.x, a2.y, ADJACENCY_SNAP_M);
    const iB = nearestPostIndexWithin(posts, b.x, b.y, ADJACENCY_SNAP_M);
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB);
    ensure(iB).add(iA);
  }
  return adjacency;
}
function pdfBearingDeg(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}
function buildDistanceMap(distances) {
  const m = /* @__PURE__ */ new Map();
  for (const d of distances ?? []) {
    if (!d) continue;
    if (typeof d.from !== "number" || typeof d.to !== "number") continue;
    if (typeof d.meters !== "number") continue;
    m.set(`${d.from}->${d.to}`, d.meters);
  }
  return m;
}
function buildOutgoingConnections(connections) {
  const out = /* @__PURE__ */ new Map();
  for (const c of connections ?? []) {
    if (!c) continue;
    const from = c.from;
    const to = c.to;
    if (typeof from !== "number" || typeof to !== "number") continue;
    if (!out.has(from)) out.set(from, []);
    out.get(from).push({
      from,
      to,
      gap: Boolean(c.gap),
      cross_page: Boolean(c.cross_page)
    });
  }
  for (const [k, arr] of out.entries()) {
    arr.sort((a2, b) => a2.to - b.to);
    out.set(k, arr);
  }
  return out;
}
function buildPostByNumber(posts) {
  const m = /* @__PURE__ */ new Map();
  for (const p of posts ?? []) {
    if (p && typeof p.number === "number") m.set(p.number, p);
  }
  return m;
}
function closestCandidate(candidates, predE, predN, fromIdx, adjacencyGraph, postToIndex) {
  let best = null;
  let bestScore = Infinity;
  let bestRawDist = Infinity;
  const neighbours = fromIdx != null ? adjacencyGraph?.get(fromIdx) : null;
  for (const c of candidates) {
    const rawDist = Math.hypot(c.x - predE, c.y - predN);
    const cIdx = postToIndex.get(c);
    const isNeighbour = neighbours && cIdx != null ? neighbours.has(cIdx) : false;
    const score = isNeighbour ? rawDist * 0.5 : rawDist;
    if (score < bestScore) {
      best = c;
      bestScore = score;
      bestRawDist = rawDist;
    }
  }
  return { best, bestRawDist };
}
function pairPostsAgainstRegion({
  posts,
  distances,
  connections,
  startLat,
  startLon,
  region,
  postIndex,
  adjacencyGraph,
  warnings
}) {
  const warn = (w) => {
    if (Array.isArray(warnings)) warnings.push(w);
  };
  if (!Array.isArray(posts) || posts.length === 0) {
    return { ok: true, coords: [] };
  }
  const zoneExpected = region?.crs?.zone ?? 22;
  const anchorUtm = latLonToUtm(startLat, startLon);
  if (anchorUtm.zone !== zoneExpected) {
    warn({ kind: "dwg-zone-mismatch", expected: zoneExpected, got: anchorUtm.zone });
    return { ok: false, failedAt: posts[0].number, nearestDistance: null };
  }
  const regionPosts = region?.posts ?? [];
  const tree = postIndex ?? buildPostIndex(regionPosts);
  const anchorCandidates = tree.search({
    minX: anchorUtm.easting - DEFAULT_TOLERANCE_M,
    minY: anchorUtm.northing - DEFAULT_TOLERANCE_M,
    maxX: anchorUtm.easting + DEFAULT_TOLERANCE_M,
    maxY: anchorUtm.northing + DEFAULT_TOLERANCE_M
  });
  if (!anchorCandidates.length) {
    warn({
      kind: "dwg-pair-fail",
      at_post: posts[0].number,
      predicted: { lat: startLat, lon: startLon },
      nearest_dwg_distance_m: null,
      tolerance_m: DEFAULT_TOLERANCE_M
    });
    return { ok: false, failedAt: posts[0].number, nearestDistance: null };
  }
  let anchorBest = null;
  let anchorDist = Infinity;
  for (const c of anchorCandidates) {
    const d = Math.hypot(c.x - anchorUtm.easting, c.y - anchorUtm.northing);
    if (d < anchorDist) {
      anchorDist = d;
      anchorBest = c;
    }
  }
  if (!anchorBest || anchorDist > DEFAULT_TOLERANCE_M) {
    warn({
      kind: "dwg-pair-fail",
      at_post: posts[0].number,
      predicted: { lat: startLat, lon: startLon },
      nearest_dwg_distance_m: Number.isFinite(anchorDist) ? anchorDist : null,
      tolerance_m: DEFAULT_TOLERANCE_M
    });
    return { ok: false, failedAt: posts[0].number, nearestDistance: Number.isFinite(anchorDist) ? anchorDist : null };
  }
  const postToIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < regionPosts.length; i++) postToIndex.set(regionPosts[i], i);
  const claimed = /* @__PURE__ */ new Set();
  const dwgByPostNumber = /* @__PURE__ */ new Map();
  dwgByPostNumber.set(posts[0].number, anchorBest);
  const anchorIdx = postToIndex.get(anchorBest);
  if (anchorIdx != null) claimed.add(anchorIdx);
  const postByNumber = buildPostByNumber(posts);
  const distMap = buildDistanceMap(distances);
  const outgoing = buildOutgoingConnections(connections);
  const visitEdge = (edge) => {
    const fromNum = edge.from;
    const toNum = edge.to;
    const fromPdf = postByNumber.get(fromNum);
    const toPdf = postByNumber.get(toNum);
    if (!fromPdf || !toPdf) return true;
    const meters = distMap.get(`${fromNum}->${toNum}`) ?? distMap.get(`${toNum}->${fromNum}`);
    if (meters == null || !(meters > 0)) {
      warn({ kind: "dwg-missing-distance", from: fromNum, to: toNum });
      return true;
    }
    const fromDwg = dwgByPostNumber.get(fromNum);
    if (!fromDwg) return true;
    const bearingDeg = pdfBearingDeg(fromPdf, toPdf);
    const bearingRad = bearingDeg * Math.PI / 180;
    const dE = meters * Math.sin(bearingRad);
    const dN = meters * Math.cos(bearingRad);
    const predE = fromDwg.x + dE;
    const predN = fromDwg.y + dN;
    const tol = edge.gap ? GAP_TOLERANCE_M : DEFAULT_TOLERANCE_M;
    const candidates = tree.search({
      minX: predE - tol,
      minY: predN - tol,
      maxX: predE + tol,
      maxY: predN + tol
    });
    if (!candidates.length) {
      warn({
        kind: "dwg-pair-fail",
        at_post: toNum,
        predicted: { easting: predE, northing: predN },
        nearest_dwg_distance_m: null,
        tolerance_m: tol
      });
      return { ok: false, failedAt: toNum, nearestDistance: null };
    }
    const fromIdx = postToIndex.get(fromDwg);
    const { best, bestRawDist } = closestCandidate(
      candidates,
      predE,
      predN,
      fromIdx,
      adjacencyGraph,
      postToIndex
    );
    if (!best || bestRawDist > tol) {
      warn({
        kind: "dwg-pair-fail",
        at_post: toNum,
        predicted: { easting: predE, northing: predN },
        nearest_dwg_distance_m: Number.isFinite(bestRawDist) ? bestRawDist : null,
        tolerance_m: tol
      });
      return { ok: false, failedAt: toNum, nearestDistance: Number.isFinite(bestRawDist) ? bestRawDist : null };
    }
    const bestIdx = postToIndex.get(best);
    if (bestIdx != null && claimed.has(bestIdx)) {
      warn({ kind: "dwg-pair-collision", at_post: toNum });
      return { ok: false, failedAt: toNum, nearestDistance: 0 };
    }
    dwgByPostNumber.set(toNum, best);
    if (bestIdx != null) claimed.add(bestIdx);
    return true;
  };
  const visitedEdges = /* @__PURE__ */ new Set();
  const walkFrom = (fromNum) => {
    const edges = outgoing.get(fromNum) ?? [];
    for (const e of edges) {
      const key = `${e.from}->${e.to}`;
      if (visitedEdges.has(key)) continue;
      visitedEdges.add(key);
      const res = visitEdge(e);
      if (res && typeof res === "object" && res.ok === false) return res;
      if (res === false) return { ok: false, failedAt: e.to, nearestDistance: null };
      const sub = walkFrom(e.to);
      if (sub && sub.ok === false) return sub;
    }
    return null;
  };
  const startNum = posts[0].number;
  const walkRes = walkFrom(startNum);
  if (walkRes && walkRes.ok === false) return walkRes;
  for (const p of posts) {
    if (!dwgByPostNumber.has(p.number)) {
      warn({ kind: "dwg-pair-fail", at_post: p.number, predicted: null, nearest_dwg_distance_m: null, tolerance_m: DEFAULT_TOLERANCE_M });
      return { ok: false, failedAt: p.number, nearestDistance: null };
    }
  }
  const coords = posts.map((p) => {
    const dwg = dwgByPostNumber.get(p.number);
    const { lat, lon } = utmToLatLon(dwg.x, dwg.y, zoneExpected);
    return { postNumber: p.number, lat, lon, source: "dwg", dwg_block: dwg.block };
  });
  return { ok: true, coords };
}

// parser/dwg/region-library.js
var DB_NAME = "pdf-to-kmz-dwg-library";
var DB_VERSION = 1;
var PARSER_VERSION = "dxf-parser@1.1.2";
var DEFAULT_CRS = { datum: "SIRGAS-2000", zone: 22, hemisphere: "S" };
async function openRegionsDb(idbFactory) {
  const prev = globalThis.indexedDB;
  if (idbFactory) globalThis.indexedDB = idbFactory;
  try {
    return await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("regions")) {
          db.createObjectStore("regions", { keyPath: "id" });
        }
      }
    });
  } finally {
    if (idbFactory) globalThis.indexedDB = prev;
  }
}
function bboxArea2(b) {
  if (!b) return Infinity;
  const dLat = Math.max(0, (b.maxLat ?? 0) - (b.minLat ?? 0));
  const dLon = Math.max(0, (b.maxLon ?? 0) - (b.minLon ?? 0));
  return dLat * dLon;
}
function normalizeBboxLatLon(a2, b) {
  return {
    minLat: Math.min(a2.lat, b.lat),
    maxLat: Math.max(a2.lat, b.lat),
    minLon: Math.min(a2.lon, b.lon),
    maxLon: Math.max(a2.lon, b.lon)
  };
}
function createRegionLibrary(idbFactory = null) {
  return {
    async addRegion(name, dxfBlob) {
      if (!name || typeof name !== "string") throw new Error("Region name is required.");
      if (!dxfBlob || typeof dxfBlob.text !== "function") {
        throw new Error("DXF file is required.");
      }
      const dxfText = await dxfBlob.text();
      const { posts, cableEdges, extmin, extmax } = parseDxfText(dxfText);
      const crs = { ...DEFAULT_CRS };
      const bboxUtm = { minE: extmin.x, maxE: extmax.x, minN: extmin.y, maxN: extmax.y };
      const ll0 = utmToLatLon(extmin.x, extmin.y, crs.zone);
      const ll1 = utmToLatLon(extmax.x, extmax.y, crs.zone);
      const bboxLatLon = normalizeBboxLatLon(ll0, ll1);
      const postIndex = buildPostIndex(posts);
      const rbushDump = postIndex.toJSON();
      const record = {
        id: name,
        name,
        uploadedAt: Date.now(),
        crs,
        bboxUtm,
        bboxLatLon,
        posts,
        cableEdges,
        rbushDump,
        sourceDxf: dxfBlob,
        parserVersion: PARSER_VERSION
      };
      const db = await openRegionsDb(idbFactory);
      await db.put("regions", record);
      db.close?.();
      return record;
    },
    async listRegions() {
      const db = await openRegionsDb(idbFactory);
      const all = await db.getAll("regions");
      db.close?.();
      return (all ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        uploadedAt: r.uploadedAt,
        bboxLatLon: r.bboxLatLon,
        crs: r.crs
      }));
    },
    async lookupByGps(lat, lon) {
      const db = await openRegionsDb(idbFactory);
      const all = await db.getAll("regions");
      db.close?.();
      const hits = (all ?? []).filter((r) => {
        const b = r?.bboxLatLon;
        if (!b) return false;
        return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
      });
      if (!hits.length) return null;
      hits.sort((r1, r2) => bboxArea2(r1.bboxLatLon) - bboxArea2(r2.bboxLatLon));
      return hits[0];
    },
    async getRegionWithIndex(id) {
      const db = await openRegionsDb(idbFactory);
      const region = await db.get("regions", id);
      db.close?.();
      if (!region) return null;
      const postIndex = restorePostIndexFromDump(region.rbushDump);
      const adjacencyGraph = buildAdjacencyGraph(region.posts, region.cableEdges);
      return { ...region, postIndex, adjacencyGraph };
    },
    async deleteRegion(name) {
      const db = await openRegionsDb(idbFactory);
      await db.delete("regions", name);
      db.close?.();
    }
  };
}

// parser/dwg/coordinate-calculator-dwg.js
async function resolveCalculateCoordinates() {
  const injected = globalThis.__pdfToKmzCalculateCoordinates;
  if (typeof injected === "function") return injected;
  const { calculateCoordinates } = await import("../coordinate-calculator.js");
  return calculateCoordinates;
}
async function calculateCoordinatesWithDwg(posts, distances, lat1, lon1, cableSegments, opts, regionLibrary) {
  const calculateCoordinates = await resolveCalculateCoordinates();
  if (!regionLibrary) {
    return calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
  }
  const warnings = [];
  let region = null;
  try {
    region = await regionLibrary.lookupByGps(lat1, lon1);
  } catch (e) {
    warnings.push({ kind: "dwg-region-miss", lat: lat1, lon: lon1, error: String(e?.message ?? e) });
    const fallback = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
    return { ...fallback, warnings: [...fallback.warnings ?? [], ...warnings] };
  }
  if (!region) {
    warnings.push({ kind: "dwg-region-miss", lat: lat1, lon: lon1 });
    const fallback = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
    return { ...fallback, warnings: [...fallback.warnings ?? [], ...warnings] };
  }
  let regionWithIndex = null;
  if (typeof regionLibrary.getRegionWithIndex === "function") {
    regionWithIndex = await regionLibrary.getRegionWithIndex(region.id);
  }
  const regionData = regionWithIndex ?? region;
  const regionPosts = regionData.posts ?? region.posts ?? [];
  const regionEdges = regionData.cableEdges ?? region.cableEdges ?? [];
  const postIndex = regionData.postIndex ?? buildPostIndex(regionPosts);
  const adjacencyGraph = regionData.adjacencyGraph ?? buildAdjacencyGraph(regionPosts, regionEdges);
  const connections = opts?.connections ?? [];
  const pairing = pairPostsAgainstRegion({
    posts,
    distances,
    connections,
    startLat: lat1,
    startLon: lon1,
    region: { ...regionData, posts: regionPosts, cableEdges: regionEdges },
    postIndex,
    adjacencyGraph,
    warnings
  });
  if (!pairing.ok) {
    const fallback = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
    return { ...fallback, warnings: [...fallback.warnings ?? [], ...warnings] };
  }
  const pdfResult = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
  const coordByPost = new Map(pairing.coords.map((c) => [c.postNumber, c]));
  const dwgPosts = (pdfResult.posts ?? posts).map((p) => {
    const c = coordByPost.get(p.number);
    if (!c) return p;
    return { ...p, lat: c.lat, lon: c.lon, source: "dwg", dwg_block: c.dwg_block };
  });
  return {
    ...pdfResult,
    posts: dwgPosts,
    warnings: [...pdfResult.warnings ?? [], ...warnings]
  };
}
export {
  calculateCoordinatesWithDwg,
  createRegionLibrary
};
