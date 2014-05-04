// vim:ts=4:sts=4:sw=4:
/*!
 *
 * Copyright 2009-2012 Kris Kowal under the terms of the MIT
 * license found at http://github.com/kriskowal/q/raw/master/LICENSE
 *
 * With parts by Tyler Close
 * Copyright 2007-2009 Tyler Close under the terms of the MIT X license found
 * at http://www.opensource.org/licenses/mit-license.html
 * Forked at ref_send.js version: 2009-05-11
 *
 * With parts by Mark Miller
 * Copyright (C) 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
(function (definition) {
    // Turn off strict mode for this function so we can assign to global.Q
    /* jshint strict: false */
    // This file will function properly as a <script> tag, or a module
    // using CommonJS and NodeJS or RequireJS module formats.  In
    // Common/Node/RequireJS, the module exports the Q API and when
    // executed as a simple <script>, it creates a Q global instead.
    // Montage Require
    if (typeof bootstrap === 'function') {
        bootstrap('promise', definition);    // CommonJS
    } else if (typeof exports === 'object') {
        module.exports = definition();    // RequireJS
    } else if (true) {
        var q = function () {
                return definition();
            }();
    } else if (typeof ses !== 'undefined') {
        if (!ses.ok()) {
            return;
        } else {
            ses.makeQ = definition;
        }    // <script>
    } else {
        Q = definition();
    }
}(function () {
    
    var hasStacks = false;
    try {
        throw new Error();
    } catch (e) {
        hasStacks = !!e.stack;
    }
    // All code after this point will be filtered from stack traces reported
    // by Q.
    var qStartingLine = captureLine();
    var qFileName;
    // shims
    // used for fallback in "allResolved"
    var noop = function () {
    };
    // Use the fastest possible means to execute a task in a future turn
    // of the event loop.
    var nextTick = function () {
            // linked list of tasks (single, with head node)
            var head = {
                    task: void 0,
                    next: null
                };
            var tail = head;
            var flushing = false;
            var requestTick = void 0;
            var isNodeJS = false;
            function flush() {
                /* jshint loopfunc: true */
                while (head.next) {
                    head = head.next;
                    var task = head.task;
                    head.task = void 0;
                    var domain = head.domain;
                    if (domain) {
                        head.domain = void 0;
                        domain.enter();
                    }
                    try {
                        task();
                    } catch (e) {
                        if (isNodeJS) {
                            // In node, uncaught exceptions are considered fatal errors.
                            // Re-throw them synchronously to interrupt flushing!
                            // Ensure continuation if the uncaught exception is suppressed
                            // listening "uncaughtException" events (as domains does).
                            // Continue in next event to avoid tick recursion.
                            if (domain) {
                                domain.exit();
                            }
                            setTimeout(flush, 0);
                            if (domain) {
                                domain.enter();
                            }
                            throw e;
                        } else {
                            // In browsers, uncaught exceptions are not fatal.
                            // Re-throw them asynchronously to avoid slow-downs.
                            setTimeout(function () {
                                throw e;
                            }, 0);
                        }
                    }
                    if (domain) {
                        domain.exit();
                    }
                }
                flushing = false;
            }
            nextTick = function (task) {
                tail = tail.next = {
                    task: task,
                    domain: isNodeJS && process.domain,
                    next: null
                };
                if (!flushing) {
                    flushing = true;
                    requestTick();
                }
            };
            if (typeof process !== 'undefined' && process.nextTick) {
                // Node.js before 0.9. Note that some fake-Node environments, like the
                // Mocha test runner, introduce a `process` global without a `nextTick`.
                isNodeJS = true;
                requestTick = function () {
                    process.nextTick(flush);
                };
            } else if (typeof setImmediate === 'function') {
                // In IE10, Node.js 0.9+, or https://github.com/NobleJS/setImmediate
                if (typeof window !== 'undefined') {
                    requestTick = setImmediate.bind(window, flush);
                } else {
                    requestTick = function () {
                        setImmediate(flush);
                    };
                }
            } else if (typeof MessageChannel !== 'undefined') {
                // modern browsers
                // http://www.nonblocking.io/2011/06/windownexttick.html
                var channel = new MessageChannel();
                // At least Safari Version 6.0.5 (8536.30.1) intermittently cannot create
                // working message ports the first time a page loads.
                channel.port1.onmessage = function () {
                    requestTick = requestPortTick;
                    channel.port1.onmessage = flush;
                    flush();
                };
                var requestPortTick = function () {
                    // Opera requires us to provide a message payload, regardless of
                    // whether we use it.
                    channel.port2.postMessage(0);
                };
                requestTick = function () {
                    setTimeout(flush, 0);
                    requestPortTick();
                };
            } else {
                // old browsers
                requestTick = function () {
                    setTimeout(flush, 0);
                };
            }
            return nextTick;
        }();
    // Attempt to make generics safe in the face of downstream
    // modifications.
    // There is no situation where this is necessary.
    // If you need a security guarantee, these primordials need to be
    // deeply frozen anyway, and if you don’t need a security guarantee,
    // this is just plain paranoid.
    // However, this **might** have the nice side-effect of reducing the size of
    // the minified code by reducing x.call() to merely x()
    // See Mark Miller’s explanation of what this does.
    // http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
    var call = Function.call;
    function uncurryThis(f) {
        return function () {
            return call.apply(f, arguments);
        };
    }
    // This is equivalent, but slower:
    // uncurryThis = Function_bind.bind(Function_bind.call);
    // http://jsperf.com/uncurrythis
    var array_slice = uncurryThis(Array.prototype.slice);
    var array_reduce = uncurryThis(Array.prototype.reduce || function (callback, basis) {
            var index = 0, length = this.length;
            // concerning the initial value, if one is not provided
            if (arguments.length === 1) {
                // seek to the first value in the array, accounting
                // for the possibility that is is a sparse array
                do {
                    if (index in this) {
                        basis = this[index++];
                        break;
                    }
                    if (++index >= length) {
                        throw new TypeError();
                    }
                } while (1);
            }
            // reduce
            for (; index < length; index++) {
                // account for the possibility that the array is sparse
                if (index in this) {
                    basis = callback(basis, this[index], index);
                }
            }
            return basis;
        });
    var array_indexOf = uncurryThis(Array.prototype.indexOf || function (value) {
            // not a very good shim, but good enough for our one use of it
            for (var i = 0; i < this.length; i++) {
                if (this[i] === value) {
                    return i;
                }
            }
            return -1;
        });
    var array_map = uncurryThis(Array.prototype.map || function (callback, thisp) {
            var self = this;
            var collect = [];
            array_reduce(self, function (undefined, value, index) {
                collect.push(callback.call(thisp, value, index, self));
            }, void 0);
            return collect;
        });
    var object_create = Object.create || function (prototype) {
            function Type() {
            }
            Type.prototype = prototype;
            return new Type();
        };
    var object_hasOwnProperty = uncurryThis(Object.prototype.hasOwnProperty);
    var object_keys = Object.keys || function (object) {
            var keys = [];
            for (var key in object) {
                if (object_hasOwnProperty(object, key)) {
                    keys.push(key);
                }
            }
            return keys;
        };
    var object_toString = uncurryThis(Object.prototype.toString);
    function isObject(value) {
        return value === Object(value);
    }
    // generator related shims
    // FIXME: Remove this function once ES6 generators are in SpiderMonkey.
    function isStopIteration(exception) {
        return object_toString(exception) === '[object StopIteration]' || exception instanceof QReturnValue;
    }
    // FIXME: Remove this helper and Q.return once ES6 generators are in
    // SpiderMonkey.
    var QReturnValue;
    if (typeof ReturnValue !== 'undefined') {
        QReturnValue = ReturnValue;
    } else {
        QReturnValue = function (value) {
            this.value = value;
        };
    }
    // Until V8 3.19 / Chromium 29 is released, SpiderMonkey is the only
    // engine that has a deployed base of browsers that support generators.
    // However, SM's generators use the Python-inspired semantics of
    // outdated ES6 drafts.  We would like to support ES6, but we'd also
    // like to make it possible to use generators in deployed browsers, so
    // we also support Python-style generators.  At some point we can remove
    // this block.
    var hasES6Generators;
    try {
        /* jshint evil: true, nonew: false */
        new Function('(function* (){ yield 1; })');
        hasES6Generators = true;
    } catch (e) {
        hasES6Generators = false;
    }
    // long stack traces
    var STACK_JUMP_SEPARATOR = 'From previous event:';
    function makeStackTraceLong(error, promise) {
        // If possible, transform the error stack trace by removing Node and Q
        // cruft, then concatenating with the stack trace of `promise`. See #57.
        if (hasStacks && promise.stack && typeof error === 'object' && error !== null && error.stack && error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1) {
            var stacks = [];
            for (var p = promise; !!p; p = p.source) {
                if (p.stack) {
                    stacks.unshift(p.stack);
                }
            }
            stacks.unshift(error.stack);
            var concatedStacks = stacks.join('\n' + STACK_JUMP_SEPARATOR + '\n');
            error.stack = filterStackString(concatedStacks);
        }
    }
    function filterStackString(stackString) {
        var lines = stackString.split('\n');
        var desiredLines = [];
        for (var i = 0; i < lines.length; ++i) {
            var line = lines[i];
            if (!isInternalFrame(line) && !isNodeFrame(line) && line) {
                desiredLines.push(line);
            }
        }
        return desiredLines.join('\n');
    }
    function isNodeFrame(stackLine) {
        return stackLine.indexOf('(module.js:') !== -1 || stackLine.indexOf('(node.js:') !== -1;
    }
    function getFileNameAndLineNumber(stackLine) {
        // Named functions: "at functionName (filename:lineNumber:columnNumber)"
        // In IE10 function name can have spaces ("Anonymous function") O_o
        var attempt1 = /at .+ \((.+):(\d+):(?:\d+)\)$/.exec(stackLine);
        if (attempt1) {
            return [
                attempt1[1],
                Number(attempt1[2])
            ];
        }
        // Anonymous functions: "at filename:lineNumber:columnNumber"
        var attempt2 = /at ([^ ]+):(\d+):(?:\d+)$/.exec(stackLine);
        if (attempt2) {
            return [
                attempt2[1],
                Number(attempt2[2])
            ];
        }
        // Firefox style: "function@filename:lineNumber or @filename:lineNumber"
        var attempt3 = /.*@(.+):(\d+)$/.exec(stackLine);
        if (attempt3) {
            return [
                attempt3[1],
                Number(attempt3[2])
            ];
        }
    }
    function isInternalFrame(stackLine) {
        var fileNameAndLineNumber = getFileNameAndLineNumber(stackLine);
        if (!fileNameAndLineNumber) {
            return false;
        }
        var fileName = fileNameAndLineNumber[0];
        var lineNumber = fileNameAndLineNumber[1];
        return fileName === qFileName && lineNumber >= qStartingLine && lineNumber <= qEndingLine;
    }
    // discover own file name and line number range for filtering stack
    // traces
    function captureLine() {
        if (!hasStacks) {
            return;
        }
        try {
            throw new Error();
        } catch (e) {
            var lines = e.stack.split('\n');
            var firstLine = lines[0].indexOf('@') > 0 ? lines[1] : lines[2];
            var fileNameAndLineNumber = getFileNameAndLineNumber(firstLine);
            if (!fileNameAndLineNumber) {
                return;
            }
            qFileName = fileNameAndLineNumber[0];
            return fileNameAndLineNumber[1];
        }
    }
    function deprecate(callback, name, alternative) {
        return function () {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn(name + ' is deprecated, use ' + alternative + ' instead.', new Error('').stack);
            }
            return callback.apply(callback, arguments);
        };
    }
    // end of shims
    // beginning of real work
    /**
     * Constructs a promise for an immediate reference, passes promises through, or
     * coerces promises from different systems.
     * @param value immediate reference or promise
     */
    function Q(value) {
        // If the object is already a Promise, return it directly.  This enables
        // the resolve function to both be used to created references from objects,
        // but to tolerably coerce non-promises to promises.
        if (isPromise(value)) {
            return value;
        }
        // assimilate thenables
        if (isPromiseAlike(value)) {
            return coerce(value);
        } else {
            return fulfill(value);
        }
    }
    Q.resolve = Q;
    /**
     * Performs a task in a future turn of the event loop.
     * @param {Function} task
     */
    Q.nextTick = nextTick;
    /**
     * Controls whether or not long stack traces will be on
     */
    Q.longStackSupport = false;
    /**
     * Constructs a {promise, resolve, reject} object.
     *
     * `resolve` is a callback to invoke with a more resolved value for the
     * promise. To fulfill the promise, invoke `resolve` with any value that is
     * not a thenable. To reject the promise, invoke `resolve` with a rejected
     * thenable, or invoke `reject` with the reason directly. To resolve the
     * promise to another thenable, thus putting it in the same state, invoke
     * `resolve` with that other thenable.
     */
    Q.defer = defer;
    function defer() {
        // if "messages" is an "Array", that indicates that the promise has not yet
        // been resolved.  If it is "undefined", it has been resolved.  Each
        // element of the messages array is itself an array of complete arguments to
        // forward to the resolved promise.  We coerce the resolution value to a
        // promise using the `resolve` function because it handles both fully
        // non-thenable values and other thenables gracefully.
        var messages = [], progressListeners = [], resolvedPromise;
        var deferred = object_create(defer.prototype);
        var promise = object_create(Promise.prototype);
        promise.promiseDispatch = function (resolve, op, operands) {
            var args = array_slice(arguments);
            if (messages) {
                messages.push(args);
                if (op === 'when' && operands[1]) {
                    // progress operand
                    progressListeners.push(operands[1]);
                }
            } else {
                nextTick(function () {
                    resolvedPromise.promiseDispatch.apply(resolvedPromise, args);
                });
            }
        };
        // XXX deprecated
        promise.valueOf = function () {
            if (messages) {
                return promise;
            }
            var nearerValue = nearer(resolvedPromise);
            if (isPromise(nearerValue)) {
                resolvedPromise = nearerValue;    // shorten chain
            }
            return nearerValue;
        };
        promise.inspect = function () {
            if (!resolvedPromise) {
                return { state: 'pending' };
            }
            return resolvedPromise.inspect();
        };
        if (Q.longStackSupport && hasStacks) {
            try {
                throw new Error();
            } catch (e) {
                // NOTE: don't try to use `Error.captureStackTrace` or transfer the
                // accessor around; that causes memory leaks as per GH-111. Just
                // reify the stack trace as a string ASAP.
                //
                // At the same time, cut off the first line; it's always just
                // "[object Promise]\n", as per the `toString`.
                promise.stack = e.stack.substring(e.stack.indexOf('\n') + 1);
            }
        }
        // NOTE: we do the checks for `resolvedPromise` in each method, instead of
        // consolidating them into `become`, since otherwise we'd create new
        // promises with the lines `become(whatever(value))`. See e.g. GH-252.
        function become(newPromise) {
            resolvedPromise = newPromise;
            promise.source = newPromise;
            array_reduce(messages, function (undefined, message) {
                nextTick(function () {
                    newPromise.promiseDispatch.apply(newPromise, message);
                });
            }, void 0);
            messages = void 0;
            progressListeners = void 0;
        }
        deferred.promise = promise;
        deferred.resolve = function (value) {
            if (resolvedPromise) {
                return;
            }
            become(Q(value));
        };
        deferred.fulfill = function (value) {
            if (resolvedPromise) {
                return;
            }
            become(fulfill(value));
        };
        deferred.reject = function (reason) {
            if (resolvedPromise) {
                return;
            }
            become(reject(reason));
        };
        deferred.notify = function (progress) {
            if (resolvedPromise) {
                return;
            }
            array_reduce(progressListeners, function (undefined, progressListener) {
                nextTick(function () {
                    progressListener(progress);
                });
            }, void 0);
        };
        return deferred;
    }
    /**
     * Creates a Node-style callback that will resolve or reject the deferred
     * promise.
     * @returns a nodeback
     */
    defer.prototype.makeNodeResolver = function () {
        var self = this;
        return function (error, value) {
            if (error) {
                self.reject(error);
            } else if (arguments.length > 2) {
                self.resolve(array_slice(arguments, 1));
            } else {
                self.resolve(value);
            }
        };
    };
    /**
     * @param resolver {Function} a function that returns nothing and accepts
     * the resolve, reject, and notify functions for a deferred.
     * @returns a promise that may be resolved with the given resolve and reject
     * functions, or rejected by a thrown exception in resolver
     */
    Q.promise = promise;
    function promise(resolver) {
        if (typeof resolver !== 'function') {
            throw new TypeError('resolver must be a function.');
        }
        var deferred = defer();
        try {
            resolver(deferred.resolve, deferred.reject, deferred.notify);
        } catch (reason) {
            deferred.reject(reason);
        }
        return deferred.promise;
    }
    // XXX experimental.  This method is a way to denote that a local value is
    // serializable and should be immediately dispatched to a remote upon request,
    // instead of passing a reference.
    Q.passByCopy = function (object) {
        //freeze(object);
        //passByCopies.set(object, true);
        return object;
    };
    Promise.prototype.passByCopy = function () {
        //freeze(object);
        //passByCopies.set(object, true);
        return this;
    };
    /**
     * If two promises eventually fulfill to the same value, promises that value,
     * but otherwise rejects.
     * @param x {Any*}
     * @param y {Any*}
     * @returns {Any*} a promise for x and y if they are the same, but a rejection
     * otherwise.
     *
     */
    Q.join = function (x, y) {
        return Q(x).join(y);
    };
    Promise.prototype.join = function (that) {
        return Q([
            this,
            that
        ]).spread(function (x, y) {
            if (x === y) {
                // TODO: "===" should be Object.is or equiv
                return x;
            } else {
                throw new Error('Can\'t join: not the same: ' + x + ' ' + y);
            }
        });
    };
    /**
     * Returns a promise for the first of an array of promises to become fulfilled.
     * @param answers {Array[Any*]} promises to race
     * @returns {Any*} the first promise to be fulfilled
     */
    Q.race = race;
    function race(answerPs) {
        return promise(function (resolve, reject) {
            // Switch to this once we can assume at least ES5
            // answerPs.forEach(function(answerP) {
            //     Q(answerP).then(resolve, reject);
            // });
            // Use this in the meantime
            for (var i = 0, len = answerPs.length; i < len; i++) {
                Q(answerPs[i]).then(resolve, reject);
            }
        });
    }
    Promise.prototype.race = function () {
        return this.then(Q.race);
    };
    /**
     * Constructs a Promise with a promise descriptor object and optional fallback
     * function.  The descriptor contains methods like when(rejected), get(name),
     * set(name, value), post(name, args), and delete(name), which all
     * return either a value, a promise for a value, or a rejection.  The fallback
     * accepts the operation name, a resolver, and any further arguments that would
     * have been forwarded to the appropriate method above had a method been
     * provided with the proper name.  The API makes no guarantees about the nature
     * of the returned object, apart from that it is usable whereever promises are
     * bought and sold.
     */
    Q.makePromise = Promise;
    function Promise(descriptor, fallback, inspect) {
        if (fallback === void 0) {
            fallback = function (op) {
                return reject(new Error('Promise does not support operation: ' + op));
            };
        }
        if (inspect === void 0) {
            inspect = function () {
                return { state: 'unknown' };
            };
        }
        var promise = object_create(Promise.prototype);
        promise.promiseDispatch = function (resolve, op, args) {
            var result;
            try {
                if (descriptor[op]) {
                    result = descriptor[op].apply(promise, args);
                } else {
                    result = fallback.call(promise, op, args);
                }
            } catch (exception) {
                result = reject(exception);
            }
            if (resolve) {
                resolve(result);
            }
        };
        promise.inspect = inspect;
        // XXX deprecated `valueOf` and `exception` support
        if (inspect) {
            var inspected = inspect();
            if (inspected.state === 'rejected') {
                promise.exception = inspected.reason;
            }
            promise.valueOf = function () {
                var inspected = inspect();
                if (inspected.state === 'pending' || inspected.state === 'rejected') {
                    return promise;
                }
                return inspected.value;
            };
        }
        return promise;
    }
    Promise.prototype.toString = function () {
        return '[object Promise]';
    };
    Promise.prototype.then = function (fulfilled, rejected, progressed) {
        var self = this;
        var deferred = defer();
        var done = false;
        // ensure the untrusted promise makes at most a
        // single call to one of the callbacks
        function _fulfilled(value) {
            try {
                return typeof fulfilled === 'function' ? fulfilled(value) : value;
            } catch (exception) {
                return reject(exception);
            }
        }
        function _rejected(exception) {
            if (typeof rejected === 'function') {
                makeStackTraceLong(exception, self);
                try {
                    return rejected(exception);
                } catch (newException) {
                    return reject(newException);
                }
            }
            return reject(exception);
        }
        function _progressed(value) {
            return typeof progressed === 'function' ? progressed(value) : value;
        }
        nextTick(function () {
            self.promiseDispatch(function (value) {
                if (done) {
                    return;
                }
                done = true;
                deferred.resolve(_fulfilled(value));
            }, 'when', [function (exception) {
                    if (done) {
                        return;
                    }
                    done = true;
                    deferred.resolve(_rejected(exception));
                }]);
        });
        // Progress propagator need to be attached in the current tick.
        self.promiseDispatch(void 0, 'when', [
            void 0,
            function (value) {
                var newValue;
                var threw = false;
                try {
                    newValue = _progressed(value);
                } catch (e) {
                    threw = true;
                    if (Q.onerror) {
                        Q.onerror(e);
                    } else {
                        throw e;
                    }
                }
                if (!threw) {
                    deferred.notify(newValue);
                }
            }
        ]);
        return deferred.promise;
    };
    /**
     * Registers an observer on a promise.
     *
     * Guarantees:
     *
     * 1. that fulfilled and rejected will be called only once.
     * 2. that either the fulfilled callback or the rejected callback will be
     *    called, but not both.
     * 3. that fulfilled and rejected will not be called in this turn.
     *
     * @param value      promise or immediate reference to observe
     * @param fulfilled  function to be called with the fulfilled value
     * @param rejected   function to be called with the rejection exception
     * @param progressed function to be called on any progress notifications
     * @return promise for the return value from the invoked callback
     */
    Q.when = when;
    function when(value, fulfilled, rejected, progressed) {
        return Q(value).then(fulfilled, rejected, progressed);
    }
    Promise.prototype.thenResolve = function (value) {
        return this.then(function () {
            return value;
        });
    };
    Q.thenResolve = function (promise, value) {
        return Q(promise).thenResolve(value);
    };
    Promise.prototype.thenReject = function (reason) {
        return this.then(function () {
            throw reason;
        });
    };
    Q.thenReject = function (promise, reason) {
        return Q(promise).thenReject(reason);
    };
    /**
     * If an object is not a promise, it is as "near" as possible.
     * If a promise is rejected, it is as "near" as possible too.
     * If it’s a fulfilled promise, the fulfillment value is nearer.
     * If it’s a deferred promise and the deferred has been resolved, the
     * resolution is "nearer".
     * @param object
     * @returns most resolved (nearest) form of the object
     */
    // XXX should we re-do this?
    Q.nearer = nearer;
    function nearer(value) {
        if (isPromise(value)) {
            var inspected = value.inspect();
            if (inspected.state === 'fulfilled') {
                return inspected.value;
            }
        }
        return value;
    }
    /**
     * @returns whether the given object is a promise.
     * Otherwise it is a fulfilled value.
     */
    Q.isPromise = isPromise;
    function isPromise(object) {
        return isObject(object) && typeof object.promiseDispatch === 'function' && typeof object.inspect === 'function';
    }
    Q.isPromiseAlike = isPromiseAlike;
    function isPromiseAlike(object) {
        return isObject(object) && typeof object.then === 'function';
    }
    /**
     * @returns whether the given object is a pending promise, meaning not
     * fulfilled or rejected.
     */
    Q.isPending = isPending;
    function isPending(object) {
        return isPromise(object) && object.inspect().state === 'pending';
    }
    Promise.prototype.isPending = function () {
        return this.inspect().state === 'pending';
    };
    /**
     * @returns whether the given object is a value or fulfilled
     * promise.
     */
    Q.isFulfilled = isFulfilled;
    function isFulfilled(object) {
        return !isPromise(object) || object.inspect().state === 'fulfilled';
    }
    Promise.prototype.isFulfilled = function () {
        return this.inspect().state === 'fulfilled';
    };
    /**
     * @returns whether the given object is a rejected promise.
     */
    Q.isRejected = isRejected;
    function isRejected(object) {
        return isPromise(object) && object.inspect().state === 'rejected';
    }
    Promise.prototype.isRejected = function () {
        return this.inspect().state === 'rejected';
    };
    //// BEGIN UNHANDLED REJECTION TRACKING
    // This promise library consumes exceptions thrown in handlers so they can be
    // handled by a subsequent promise.  The exceptions get added to this array when
    // they are created, and removed when they are handled.  Note that in ES6 or
    // shimmed environments, this would naturally be a `Set`.
    var unhandledReasons = [];
    var unhandledRejections = [];
    var unhandledReasonsDisplayed = false;
    var trackUnhandledRejections = true;
    function displayUnhandledReasons() {
        if (!unhandledReasonsDisplayed && typeof window !== 'undefined' && window.console) {
            console.warn('[Q] Unhandled rejection reasons (should be empty):', unhandledReasons);
        }
        unhandledReasonsDisplayed = true;
    }
    function logUnhandledReasons() {
        for (var i = 0; i < unhandledReasons.length; i++) {
            var reason = unhandledReasons[i];
            console.warn('Unhandled rejection reason:', reason);
        }
    }
    function resetUnhandledRejections() {
        unhandledReasons.length = 0;
        unhandledRejections.length = 0;
        unhandledReasonsDisplayed = false;
        if (!trackUnhandledRejections) {
            trackUnhandledRejections = true;
            // Show unhandled rejection reasons if Node exits without handling an
            // outstanding rejection.  (Note that Browserify presently produces a
            // `process` global without the `EventEmitter` `on` method.)
            if (typeof process !== 'undefined' && process.on) {
                process.on('exit', logUnhandledReasons);
            }
        }
    }
    function trackRejection(promise, reason) {
        if (!trackUnhandledRejections) {
            return;
        }
        unhandledRejections.push(promise);
        if (reason && typeof reason.stack !== 'undefined') {
            unhandledReasons.push(reason.stack);
        } else {
            unhandledReasons.push('(no stack) ' + reason);
        }
        displayUnhandledReasons();
    }
    function untrackRejection(promise) {
        if (!trackUnhandledRejections) {
            return;
        }
        var at = array_indexOf(unhandledRejections, promise);
        if (at !== -1) {
            unhandledRejections.splice(at, 1);
            unhandledReasons.splice(at, 1);
        }
    }
    Q.resetUnhandledRejections = resetUnhandledRejections;
    Q.getUnhandledReasons = function () {
        // Make a copy so that consumers can't interfere with our internal state.
        return unhandledReasons.slice();
    };
    Q.stopUnhandledRejectionTracking = function () {
        resetUnhandledRejections();
        if (typeof process !== 'undefined' && process.on) {
            process.removeListener('exit', logUnhandledReasons);
        }
        trackUnhandledRejections = false;
    };
    resetUnhandledRejections();
    //// END UNHANDLED REJECTION TRACKING
    /**
     * Constructs a rejected promise.
     * @param reason value describing the failure
     */
    Q.reject = reject;
    function reject(reason) {
        var rejection = Promise({
                'when': function (rejected) {
                    // note that the error has been handled
                    if (rejected) {
                        untrackRejection(this);
                    }
                    return rejected ? rejected(reason) : this;
                }
            }, function fallback() {
                return this;
            }, function inspect() {
                return {
                    state: 'rejected',
                    reason: reason
                };
            });
        // Note that the reason has not been handled.
        trackRejection(rejection, reason);
        return rejection;
    }
    /**
     * Constructs a fulfilled promise for an immediate reference.
     * @param value immediate reference
     */
    Q.fulfill = fulfill;
    function fulfill(value) {
        return Promise({
            'when': function () {
                return value;
            },
            'get': function (name) {
                return value[name];
            },
            'set': function (name, rhs) {
                value[name] = rhs;
            },
            'delete': function (name) {
                delete value[name];
            },
            'post': function (name, args) {
                // Mark Miller proposes that post with no name should apply a
                // promised function.
                if (name === null || name === void 0) {
                    return value.apply(void 0, args);
                } else {
                    return value[name].apply(value, args);
                }
            },
            'apply': function (thisp, args) {
                return value.apply(thisp, args);
            },
            'keys': function () {
                return object_keys(value);
            }
        }, void 0, function inspect() {
            return {
                state: 'fulfilled',
                value: value
            };
        });
    }
    /**
     * Converts thenables to Q promises.
     * @param promise thenable promise
     * @returns a Q promise
     */
    function coerce(promise) {
        var deferred = defer();
        nextTick(function () {
            try {
                promise.then(deferred.resolve, deferred.reject, deferred.notify);
            } catch (exception) {
                deferred.reject(exception);
            }
        });
        return deferred.promise;
    }
    /**
     * Annotates an object such that it will never be
     * transferred away from this process over any promise
     * communication channel.
     * @param object
     * @returns promise a wrapping of that object that
     * additionally responds to the "isDef" message
     * without a rejection.
     */
    Q.master = master;
    function master(object) {
        return Promise({
            'isDef': function () {
            }
        }, function fallback(op, args) {
            return dispatch(object, op, args);
        }, function () {
            return Q(object).inspect();
        });
    }
    /**
     * Spreads the values of a promised array of arguments into the
     * fulfillment callback.
     * @param fulfilled callback that receives variadic arguments from the
     * promised array
     * @param rejected callback that receives the exception if the promise
     * is rejected.
     * @returns a promise for the return value or thrown exception of
     * either callback.
     */
    Q.spread = spread;
    function spread(value, fulfilled, rejected) {
        return Q(value).spread(fulfilled, rejected);
    }
    Promise.prototype.spread = function (fulfilled, rejected) {
        return this.all().then(function (array) {
            return fulfilled.apply(void 0, array);
        }, rejected);
    };
    /**
     * The async function is a decorator for generator functions, turning
     * them into asynchronous generators.  Although generators are only part
     * of the newest ECMAScript 6 drafts, this code does not cause syntax
     * errors in older engines.  This code should continue to work and will
     * in fact improve over time as the language improves.
     *
     * ES6 generators are currently part of V8 version 3.19 with the
     * --harmony-generators runtime flag enabled.  SpiderMonkey has had them
     * for longer, but under an older Python-inspired form.  This function
     * works on both kinds of generators.
     *
     * Decorates a generator function such that:
     *  - it may yield promises
     *  - execution will continue when that promise is fulfilled
     *  - the value of the yield expression will be the fulfilled value
     *  - it returns a promise for the return value (when the generator
     *    stops iterating)
     *  - the decorated function returns a promise for the return value
     *    of the generator or the first rejected promise among those
     *    yielded.
     *  - if an error is thrown in the generator, it propagates through
     *    every following yield until it is caught, or until it escapes
     *    the generator function altogether, and is translated into a
     *    rejection for the promise returned by the decorated generator.
     */
    Q.async = async;
    function async(makeGenerator) {
        return function () {
            // when verb is "send", arg is a value
            // when verb is "throw", arg is an exception
            function continuer(verb, arg) {
                var result;
                if (hasES6Generators) {
                    try {
                        result = generator[verb](arg);
                    } catch (exception) {
                        return reject(exception);
                    }
                    if (result.done) {
                        return result.value;
                    } else {
                        return when(result.value, callback, errback);
                    }
                } else {
                    // FIXME: Remove this case when SM does ES6 generators.
                    try {
                        result = generator[verb](arg);
                    } catch (exception) {
                        if (isStopIteration(exception)) {
                            return exception.value;
                        } else {
                            return reject(exception);
                        }
                    }
                    return when(result, callback, errback);
                }
            }
            var generator = makeGenerator.apply(this, arguments);
            var callback = continuer.bind(continuer, 'next');
            var errback = continuer.bind(continuer, 'throw');
            return callback();
        };
    }
    /**
     * The spawn function is a small wrapper around async that immediately
     * calls the generator and also ends the promise chain, so that any
     * unhandled errors are thrown instead of forwarded to the error
     * handler. This is useful because it's extremely common to run
     * generators at the top-level to work with libraries.
     */
    Q.spawn = spawn;
    function spawn(makeGenerator) {
        Q.done(Q.async(makeGenerator)());
    }
    // FIXME: Remove this interface once ES6 generators are in SpiderMonkey.
    /**
     * Throws a ReturnValue exception to stop an asynchronous generator.
     *
     * This interface is a stop-gap measure to support generator return
     * values in older Firefox/SpiderMonkey.  In browsers that support ES6
     * generators like Chromium 29, just use "return" in your generator
     * functions.
     *
     * @param value the return value for the surrounding generator
     * @throws ReturnValue exception with the value.
     * @example
     * // ES6 style
     * Q.async(function* () {
     *      var foo = yield getFooPromise();
     *      var bar = yield getBarPromise();
     *      return foo + bar;
     * })
     * // Older SpiderMonkey style
     * Q.async(function () {
     *      var foo = yield getFooPromise();
     *      var bar = yield getBarPromise();
     *      Q.return(foo + bar);
     * })
     */
    Q['return'] = _return;
    function _return(value) {
        throw new QReturnValue(value);
    }
    /**
     * The promised function decorator ensures that any promise arguments
     * are settled and passed as values (`this` is also settled and passed
     * as a value).  It will also ensure that the result of a function is
     * always a promise.
     *
     * @example
     * var add = Q.promised(function (a, b) {
     *     return a + b;
     * });
     * add(Q(a), Q(B));
     *
     * @param {function} callback The function to decorate
     * @returns {function} a function that has been decorated.
     */
    Q.promised = promised;
    function promised(callback) {
        return function () {
            return spread([
                this,
                all(arguments)
            ], function (self, args) {
                return callback.apply(self, args);
            });
        };
    }
    /**
     * sends a message to a value in a future turn
     * @param object* the recipient
     * @param op the name of the message operation, e.g., "when",
     * @param args further arguments to be forwarded to the operation
     * @returns result {Promise} a promise for the result of the operation
     */
    Q.dispatch = dispatch;
    function dispatch(object, op, args) {
        return Q(object).dispatch(op, args);
    }
    Promise.prototype.dispatch = function (op, args) {
        var self = this;
        var deferred = defer();
        nextTick(function () {
            self.promiseDispatch(deferred.resolve, op, args);
        });
        return deferred.promise;
    };
    /**
     * Gets the value of a property in a future turn.
     * @param object    promise or immediate reference for target object
     * @param name      name of property to get
     * @return promise for the property value
     */
    Q.get = function (object, key) {
        return Q(object).dispatch('get', [key]);
    };
    Promise.prototype.get = function (key) {
        return this.dispatch('get', [key]);
    };
    /**
     * Sets the value of a property in a future turn.
     * @param object    promise or immediate reference for object object
     * @param name      name of property to set
     * @param value     new value of property
     * @return promise for the return value
     */
    Q.set = function (object, key, value) {
        return Q(object).dispatch('set', [
            key,
            value
        ]);
    };
    Promise.prototype.set = function (key, value) {
        return this.dispatch('set', [
            key,
            value
        ]);
    };
    /**
     * Deletes a property in a future turn.
     * @param object    promise or immediate reference for target object
     * @param name      name of property to delete
     * @return promise for the return value
     */
    Q.del = // XXX legacy
    Q['delete'] = function (object, key) {
        return Q(object).dispatch('delete', [key]);
    };
    Promise.prototype.del = // XXX legacy
    Promise.prototype['delete'] = function (key) {
        return this.dispatch('delete', [key]);
    };
    /**
     * Invokes a method in a future turn.
     * @param object    promise or immediate reference for target object
     * @param name      name of method to invoke
     * @param value     a value to post, typically an array of
     *                  invocation arguments for promises that
     *                  are ultimately backed with `resolve` values,
     *                  as opposed to those backed with URLs
     *                  wherein the posted value can be any
     *                  JSON serializable object.
     * @return promise for the return value
     */
    // bound locally because it is used by other methods
    Q.mapply = // XXX As proposed by "Redsandro"
    Q.post = function (object, name, args) {
        return Q(object).dispatch('post', [
            name,
            args
        ]);
    };
    Promise.prototype.mapply = // XXX As proposed by "Redsandro"
    Promise.prototype.post = function (name, args) {
        return this.dispatch('post', [
            name,
            args
        ]);
    };
    /**
     * Invokes a method in a future turn.
     * @param object    promise or immediate reference for target object
     * @param name      name of method to invoke
     * @param ...args   array of invocation arguments
     * @return promise for the return value
     */
    Q.send = // XXX Mark Miller's proposed parlance
    Q.mcall = // XXX As proposed by "Redsandro"
    Q.invoke = function (object, name) {
        return Q(object).dispatch('post', [
            name,
            array_slice(arguments, 2)
        ]);
    };
    Promise.prototype.send = // XXX Mark Miller's proposed parlance
    Promise.prototype.mcall = // XXX As proposed by "Redsandro"
    Promise.prototype.invoke = function (name) {
        return this.dispatch('post', [
            name,
            array_slice(arguments, 1)
        ]);
    };
    /**
     * Applies the promised function in a future turn.
     * @param object    promise or immediate reference for target function
     * @param args      array of application arguments
     */
    Q.fapply = function (object, args) {
        return Q(object).dispatch('apply', [
            void 0,
            args
        ]);
    };
    Promise.prototype.fapply = function (args) {
        return this.dispatch('apply', [
            void 0,
            args
        ]);
    };
    /**
     * Calls the promised function in a future turn.
     * @param object    promise or immediate reference for target function
     * @param ...args   array of application arguments
     */
    Q['try'] = Q.fcall = function (object) {
        return Q(object).dispatch('apply', [
            void 0,
            array_slice(arguments, 1)
        ]);
    };
    Promise.prototype.fcall = function () {
        return this.dispatch('apply', [
            void 0,
            array_slice(arguments)
        ]);
    };
    /**
     * Binds the promised function, transforming return values into a fulfilled
     * promise and thrown errors into a rejected one.
     * @param object    promise or immediate reference for target function
     * @param ...args   array of application arguments
     */
    Q.fbind = function (object) {
        var promise = Q(object);
        var args = array_slice(arguments, 1);
        return function fbound() {
            return promise.dispatch('apply', [
                this,
                args.concat(array_slice(arguments))
            ]);
        };
    };
    Promise.prototype.fbind = function () {
        var promise = this;
        var args = array_slice(arguments);
        return function fbound() {
            return promise.dispatch('apply', [
                this,
                args.concat(array_slice(arguments))
            ]);
        };
    };
    /**
     * Requests the names of the owned properties of a promised
     * object in a future turn.
     * @param object    promise or immediate reference for target object
     * @return promise for the keys of the eventually settled object
     */
    Q.keys = function (object) {
        return Q(object).dispatch('keys', []);
    };
    Promise.prototype.keys = function () {
        return this.dispatch('keys', []);
    };
    /**
     * Turns an array of promises into a promise for an array.  If any of
     * the promises gets rejected, the whole array is rejected immediately.
     * @param {Array*} an array (or promise for an array) of values (or
     * promises for values)
     * @returns a promise for an array of the corresponding values
     */
    // By Mark Miller
    // http://wiki.ecmascript.org/doku.php?id=strawman:concurrency&rev=1308776521#allfulfilled
    Q.all = all;
    function all(promises) {
        return when(promises, function (promises) {
            var countDown = 0;
            var deferred = defer();
            array_reduce(promises, function (undefined, promise, index) {
                var snapshot;
                if (isPromise(promise) && (snapshot = promise.inspect()).state === 'fulfilled') {
                    promises[index] = snapshot.value;
                } else {
                    ++countDown;
                    when(promise, function (value) {
                        promises[index] = value;
                        if (--countDown === 0) {
                            deferred.resolve(promises);
                        }
                    }, deferred.reject, function (progress) {
                        deferred.notify({
                            index: index,
                            value: progress
                        });
                    });
                }
            }, void 0);
            if (countDown === 0) {
                deferred.resolve(promises);
            }
            return deferred.promise;
        });
    }
    Promise.prototype.all = function () {
        return all(this);
    };
    /**
     * Waits for all promises to be settled, either fulfilled or
     * rejected.  This is distinct from `all` since that would stop
     * waiting at the first rejection.  The promise returned by
     * `allResolved` will never be rejected.
     * @param promises a promise for an array (or an array) of promises
     * (or values)
     * @return a promise for an array of promises
     */
    Q.allResolved = deprecate(allResolved, 'allResolved', 'allSettled');
    function allResolved(promises) {
        return when(promises, function (promises) {
            promises = array_map(promises, Q);
            return when(all(array_map(promises, function (promise) {
                return when(promise, noop, noop);
            })), function () {
                return promises;
            });
        });
    }
    Promise.prototype.allResolved = function () {
        return allResolved(this);
    };
    /**
     * @see Promise#allSettled
     */
    Q.allSettled = allSettled;
    function allSettled(promises) {
        return Q(promises).allSettled();
    }
    /**
     * Turns an array of promises into a promise for an array of their states (as
     * returned by `inspect`) when they have all settled.
     * @param {Array[Any*]} values an array (or promise for an array) of values (or
     * promises for values)
     * @returns {Array[State]} an array of states for the respective values.
     */
    Promise.prototype.allSettled = function () {
        return this.then(function (promises) {
            return all(array_map(promises, function (promise) {
                promise = Q(promise);
                function regardless() {
                    return promise.inspect();
                }
                return promise.then(regardless, regardless);
            }));
        });
    };
    /**
     * Captures the failure of a promise, giving an oportunity to recover
     * with a callback.  If the given promise is fulfilled, the returned
     * promise is fulfilled.
     * @param {Any*} promise for something
     * @param {Function} callback to fulfill the returned promise if the
     * given promise is rejected
     * @returns a promise for the return value of the callback
     */
    Q.fail = // XXX legacy
    Q['catch'] = function (object, rejected) {
        return Q(object).then(void 0, rejected);
    };
    Promise.prototype.fail = // XXX legacy
    Promise.prototype['catch'] = function (rejected) {
        return this.then(void 0, rejected);
    };
    /**
     * Attaches a listener that can respond to progress notifications from a
     * promise's originating deferred. This listener receives the exact arguments
     * passed to ``deferred.notify``.
     * @param {Any*} promise for something
     * @param {Function} callback to receive any progress notifications
     * @returns the given promise, unchanged
     */
    Q.progress = progress;
    function progress(object, progressed) {
        return Q(object).then(void 0, void 0, progressed);
    }
    Promise.prototype.progress = function (progressed) {
        return this.then(void 0, void 0, progressed);
    };
    /**
     * Provides an opportunity to observe the settling of a promise,
     * regardless of whether the promise is fulfilled or rejected.  Forwards
     * the resolution to the returned promise when the callback is done.
     * The callback can return a promise to defer completion.
     * @param {Any*} promise
     * @param {Function} callback to observe the resolution of the given
     * promise, takes no arguments.
     * @returns a promise for the resolution of the given promise when
     * ``fin`` is done.
     */
    Q.fin = // XXX legacy
    Q['finally'] = function (object, callback) {
        return Q(object)['finally'](callback);
    };
    Promise.prototype.fin = // XXX legacy
    Promise.prototype['finally'] = function (callback) {
        callback = Q(callback);
        return this.then(function (value) {
            return callback.fcall().then(function () {
                return value;
            });
        }, function (reason) {
            // TODO attempt to recycle the rejection with "this".
            return callback.fcall().then(function () {
                throw reason;
            });
        });
    };
    /**
     * Terminates a chain of promises, forcing rejections to be
     * thrown as exceptions.
     * @param {Any*} promise at the end of a chain of promises
     * @returns nothing
     */
    Q.done = function (object, fulfilled, rejected, progress) {
        return Q(object).done(fulfilled, rejected, progress);
    };
    Promise.prototype.done = function (fulfilled, rejected, progress) {
        var onUnhandledError = function (error) {
            // forward to a future turn so that ``when``
            // does not catch it and turn it into a rejection.
            nextTick(function () {
                makeStackTraceLong(error, promise);
                if (Q.onerror) {
                    Q.onerror(error);
                } else {
                    throw error;
                }
            });
        };
        // Avoid unnecessary `nextTick`ing via an unnecessary `when`.
        var promise = fulfilled || rejected || progress ? this.then(fulfilled, rejected, progress) : this;
        if (typeof process === 'object' && process && process.domain) {
            onUnhandledError = process.domain.bind(onUnhandledError);
        }
        promise.then(void 0, onUnhandledError);
    };
    /**
     * Causes a promise to be rejected if it does not get fulfilled before
     * some milliseconds time out.
     * @param {Any*} promise
     * @param {Number} milliseconds timeout
     * @param {String} custom error message (optional)
     * @returns a promise for the resolution of the given promise if it is
     * fulfilled before the timeout, otherwise rejected.
     */
    Q.timeout = function (object, ms, message) {
        return Q(object).timeout(ms, message);
    };
    Promise.prototype.timeout = function (ms, message) {
        var deferred = defer();
        var timeoutId = setTimeout(function () {
                deferred.reject(new Error(message || 'Timed out after ' + ms + ' ms'));
            }, ms);
        this.then(function (value) {
            clearTimeout(timeoutId);
            deferred.resolve(value);
        }, function (exception) {
            clearTimeout(timeoutId);
            deferred.reject(exception);
        }, deferred.notify);
        return deferred.promise;
    };
    /**
     * Returns a promise for the given value (or promised value), some
     * milliseconds after it resolved. Passes rejections immediately.
     * @param {Any*} promise
     * @param {Number} milliseconds
     * @returns a promise for the resolution of the given promise after milliseconds
     * time has elapsed since the resolution of the given promise.
     * If the given promise rejects, that is passed immediately.
     */
    Q.delay = function (object, timeout) {
        if (timeout === void 0) {
            timeout = object;
            object = void 0;
        }
        return Q(object).delay(timeout);
    };
    Promise.prototype.delay = function (timeout) {
        return this.then(function (value) {
            var deferred = defer();
            setTimeout(function () {
                deferred.resolve(value);
            }, timeout);
            return deferred.promise;
        });
    };
    /**
     * Passes a continuation to a Node function, which is called with the given
     * arguments provided as an array, and returns a promise.
     *
     *      Q.nfapply(FS.readFile, [__filename])
     *      .then(function (content) {
     *      })
     *
     */
    Q.nfapply = function (callback, args) {
        return Q(callback).nfapply(args);
    };
    Promise.prototype.nfapply = function (args) {
        var deferred = defer();
        var nodeArgs = array_slice(args);
        nodeArgs.push(deferred.makeNodeResolver());
        this.fapply(nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
    /**
     * Passes a continuation to a Node function, which is called with the given
     * arguments provided individually, and returns a promise.
     * @example
     * Q.nfcall(FS.readFile, __filename)
     * .then(function (content) {
     * })
     *
     */
    Q.nfcall = function (callback) {
        var args = array_slice(arguments, 1);
        return Q(callback).nfapply(args);
    };
    Promise.prototype.nfcall = function () {
        var nodeArgs = array_slice(arguments);
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        this.fapply(nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
    /**
     * Wraps a NodeJS continuation passing function and returns an equivalent
     * version that returns a promise.
     * @example
     * Q.nfbind(FS.readFile, __filename)("utf-8")
     * .then(console.log)
     * .done()
     */
    Q.nfbind = Q.denodeify = function (callback) {
        var baseArgs = array_slice(arguments, 1);
        return function () {
            var nodeArgs = baseArgs.concat(array_slice(arguments));
            var deferred = defer();
            nodeArgs.push(deferred.makeNodeResolver());
            Q(callback).fapply(nodeArgs).fail(deferred.reject);
            return deferred.promise;
        };
    };
    Promise.prototype.nfbind = Promise.prototype.denodeify = function () {
        var args = array_slice(arguments);
        args.unshift(this);
        return Q.denodeify.apply(void 0, args);
    };
    Q.nbind = function (callback, thisp) {
        var baseArgs = array_slice(arguments, 2);
        return function () {
            var nodeArgs = baseArgs.concat(array_slice(arguments));
            var deferred = defer();
            nodeArgs.push(deferred.makeNodeResolver());
            function bound() {
                return callback.apply(thisp, arguments);
            }
            Q(bound).fapply(nodeArgs).fail(deferred.reject);
            return deferred.promise;
        };
    };
    Promise.prototype.nbind = function () {
        var args = array_slice(arguments, 0);
        args.unshift(this);
        return Q.nbind.apply(void 0, args);
    };
    /**
     * Calls a method of a Node-style object that accepts a Node-style
     * callback with a given array of arguments, plus a provided callback.
     * @param object an object that has the named method
     * @param {String} name name of the method of object
     * @param {Array} args arguments to pass to the method; the callback
     * will be provided by Q and appended to these arguments.
     * @returns a promise for the value or error
     */
    Q.nmapply = // XXX As proposed by "Redsandro"
    Q.npost = function (object, name, args) {
        return Q(object).npost(name, args);
    };
    Promise.prototype.nmapply = // XXX As proposed by "Redsandro"
    Promise.prototype.npost = function (name, args) {
        var nodeArgs = array_slice(args || []);
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        this.dispatch('post', [
            name,
            nodeArgs
        ]).fail(deferred.reject);
        return deferred.promise;
    };
    /**
     * Calls a method of a Node-style object that accepts a Node-style
     * callback, forwarding the given variadic arguments, plus a provided
     * callback argument.
     * @param object an object that has the named method
     * @param {String} name name of the method of object
     * @param ...args arguments to pass to the method; the callback will
     * be provided by Q and appended to these arguments.
     * @returns a promise for the value or error
     */
    Q.nsend = // XXX Based on Mark Miller's proposed "send"
    Q.nmcall = // XXX Based on "Redsandro's" proposal
    Q.ninvoke = function (object, name) {
        var nodeArgs = array_slice(arguments, 2);
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        Q(object).dispatch('post', [
            name,
            nodeArgs
        ]).fail(deferred.reject);
        return deferred.promise;
    };
    Promise.prototype.nsend = // XXX Based on Mark Miller's proposed "send"
    Promise.prototype.nmcall = // XXX Based on "Redsandro's" proposal
    Promise.prototype.ninvoke = function (name) {
        var nodeArgs = array_slice(arguments, 1);
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        this.dispatch('post', [
            name,
            nodeArgs
        ]).fail(deferred.reject);
        return deferred.promise;
    };
    /**
     * If a function would like to support both Node continuation-passing-style and
     * promise-returning-style, it can end its internal promise chain with
     * `nodeify(nodeback)`, forwarding the optional nodeback argument.  If the user
     * elects to use a nodeback, the result will be sent there.  If they do not
     * pass a nodeback, they will receive the result promise.
     * @param object a result (or a promise for a result)
     * @param {Function} nodeback a Node.js-style callback
     * @returns either the promise or nothing
     */
    Q.nodeify = nodeify;
    function nodeify(object, nodeback) {
        return Q(object).nodeify(nodeback);
    }
    Promise.prototype.nodeify = function (nodeback) {
        if (nodeback) {
            this.then(function (value) {
                nextTick(function () {
                    nodeback(null, value);
                });
            }, function (error) {
                nextTick(function () {
                    nodeback(error);
                });
            });
        } else {
            return this;
        }
    };
    // All code before this point will be filtered from stack traces.
    var qEndingLine = captureLine();
    return Q;
}));
var chuck_helpers = function () {
        var module;
        module = {};
        module.count = function (string, substr) {
            var num, pos;
            num = pos = 0;
            if (!substr.length) {
                return 1 / 0;
            }
            while (pos = 1 + string.indexOf(substr, pos)) {
                num++;
            }
            return num;
        };
        module.last = function (array, back) {
            return array[array.length - (back || 0) - 1];
        };
        module.throwSyntaxError = function (message, location) {
            var error;
            error = new SyntaxError(message);
            error.location = location;
            error.toString = syntaxErrorToString;
            error.stack = error.toString();
            throw error;
        };
        return module;
    }();
var chuck_logging = function () {
        var logger, methods, module, name, _i, _len;
        logger = void 0;
        module = {};
        methods = [
            'error',
            'warn',
            'info',
            'debug',
            'trace'
        ];
        for (_i = 0, _len = methods.length; _i < _len; _i++) {
            name = methods[_i];
            module[name] = function () {
                return void 0;
            };
        }
        module.setLogger = function (logger) {
            var _j, _len1, _results;
            _results = [];
            for (_j = 0, _len1 = methods.length; _j < _len1; _j++) {
                name = methods[_j];
                if (!_.isFunction(logger[name])) {
                    throw new Error('Logger lacks method ' + name);
                }
                _results.push(module[name] = _.bind(logger[name], logger));
            }
            return _results;
        };
        return module;
    }();
var __bind = function (fn, me) {
        return function () {
            return fn.apply(me, arguments);
        };
    }, __hasProp = {}.hasOwnProperty, __indexOf = [].indexOf || function (item) {
        for (var i = 0, l = this.length; i < l; i++) {
            if (i in this && this[i] === item)
                return i;
        }
        return -1;
    };
var chuck_lexer = function (helpers, logging) {
        var ALIAS_MAP, BOM, COMMENT, FLOAT, IDENTIFIER, KEYWORDS, Lexer, MATCHERS, NUMBER, TRAILING_SPACES, WHITESPACE, count, last, throwSyntaxError;
        count = helpers.count, last = helpers.last, throwSyntaxError = helpers.throwSyntaxError;
        Lexer = function () {
            function Lexer() {
                this._matchToken = __bind(this._matchToken, this);
            }
            Lexer.prototype.tokenize = function (code) {
                var consumed, i, k, tag, v, _ref;
                this.ends = [];
                this.tokens = [];
                this.chunkLine = 0;
                this.chunkColumn = 0;
                code = this.clean(code);
                this._matchers = [];
                for (k in MATCHERS) {
                    if (!__hasProp.call(MATCHERS, k))
                        continue;
                    v = MATCHERS[k];
                    this._matchers.push([
                        new RegExp('^' + k),
                        v
                    ]);
                }
                i = 0;
                while (this.chunk = code.slice(i)) {
                    consumed = this.identifierToken() || this.floatToken() || this.intToken() || this.commentToken() || this._matchToken() || this.whitespaceToken() || this.stringToken() || this.literalToken();
                    _ref = this.getLineAndColumnFromChunk(consumed), this.chunkLine = _ref[0], this.chunkColumn = _ref[1];
                    i += consumed;
                }
                if (tag = this.ends.pop()) {
                    this.error('missing ' + tag);
                }
                return this.tokens;
            };
            Lexer.prototype.clean = function (code) {
                if (code.charCodeAt(0) === BOM) {
                    code = code.slice(1);
                }
                code = code.replace(/\r/g, '').replace(TRAILING_SPACES, '');
                if (WHITESPACE.test(code)) {
                    code = '\n' + code;
                    --this.chunkLine;
                }
                return code;
            };
            Lexer.prototype.identifierToken = function () {
                var id, idLength, match, poppedToken, tag, tagToken, _ref;
                if (!(match = IDENTIFIER.exec(this.chunk))) {
                    return 0;
                }
                id = match[0];
                idLength = id.length;
                tag = 'ID';
                if (id in ALIAS_MAP) {
                    id = ALIAS_MAP[id];
                }
                if (__indexOf.call(KEYWORDS, id) >= 0) {
                    tag = id.toUpperCase();
                    logging.debug('Token is a keyword: \'' + id + '\'');
                } else {
                    logging.debug('Token is an identifier: \'' + id + '\'');
                }
                poppedToken = void 0;
                tagToken = this.token(tag, id, 0, idLength);
                if (poppedToken) {
                    _ref = [
                        poppedToken[2].first_line,
                        poppedToken[2].first_column
                    ], tagToken[2].first_line = _ref[0], tagToken[2].first_column = _ref[1];
                }
                logging.debug('Consumed ID of length ' + idLength);
                return idLength;
            };
            Lexer.prototype.intToken = function () {
                var binaryLiteral, lexedLength, match, number, octalLiteral;
                if (!(match = NUMBER.exec(this.chunk))) {
                    return 0;
                }
                number = match[0];
                logging.debug('Token is an integer: ' + number);
                if (/^0[BOX]/.test(number)) {
                    this.error('radix prefix \'' + number + '\' must be lowercase');
                } else if (/^0\d*[89]/.test(number)) {
                    this.error('decimal literal \'' + number + '\' must not be prefixed with \'0\'');
                } else if (/^0\d+/.test(number)) {
                    this.error('octal literal \'' + number + '\' must be prefixed with \'0o\'');
                }
                lexedLength = number.length;
                if (octalLiteral = /^0o([0-7]+)/.exec(number)) {
                    number = '0x' + parseInt(octalLiteral[1], 8).toString(16);
                }
                if (binaryLiteral = /^0b([01]+)/.exec(number)) {
                    number = '0x' + parseInt(binaryLiteral[1], 2).toString(16);
                }
                this.token('NUMBER', number, 0, lexedLength);
                return lexedLength;
            };
            Lexer.prototype.floatToken = function () {
                var lexedLength, match, number;
                if (!(match = FLOAT.exec(this.chunk))) {
                    return 0;
                }
                number = match[0];
                logging.debug('Token is a float: ' + number);
                if (/E/.test(number) && !/^0x/.test(number)) {
                    this.error('exponential notation \'' + number + '\' must be indicated with a lowercase \'e\'');
                }
                lexedLength = number.length;
                this.token('FLOAT', number, 0, lexedLength);
                return lexedLength;
            };
            Lexer.prototype.stringToken = function () {
                var match, string;
                if (!(match = /^"(.+)"/.exec(this.chunk))) {
                    return 0;
                }
                string = match[1];
                logging.debug('Token is a string: \'' + string + '\', ' + string.length);
                this.token('STRING_LIT', string);
                return match[0].length;
            };
            Lexer.prototype.commentToken = function () {
                var comment, match;
                if (!(match = this.chunk.match(COMMENT))) {
                    return 0;
                }
                comment = match[0];
                logging.debug('Token is a comment', comment);
                return comment.length;
            };
            Lexer.prototype.whitespaceToken = function () {
                var match, nline, prev;
                if (!((match = WHITESPACE.exec(this.chunk)) || (nline = this.chunk.charAt(0) === '\n'))) {
                    return 0;
                }
                if (match != null) {
                    logging.debug('Consuming whitespace of length ' + match[0].length);
                }
                prev = last(this.tokens);
                if (prev) {
                    prev[match ? 'spaced' : 'newLine'] = true;
                }
                if (match) {
                    return match[0].length;
                } else {
                    return 0;
                }
            };
            Lexer.prototype.literalToken = function () {
                var match, tag, value;
                if (match = /^;/.exec(this.chunk)) {
                    value = match[0];
                    tag = 'SEMICOLON';
                    logging.debug('Token is a semicolon');
                } else {
                    value = this.chunk;
                    logging.debug('Unmatched token: \'' + value + '\'');
                }
                this.token(tag, value);
                return value.length;
            };
            Lexer.prototype._matchToken = function () {
                var match, matcher, re, token, value, _i, _len, _ref;
                _ref = this._matchers;
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    matcher = _ref[_i];
                    re = matcher[0], token = matcher[1];
                    match = re.exec(this.chunk);
                    if (match == null) {
                        continue;
                    }
                    value = match[0];
                    logging.debug('Matched text \'' + value + '\' against token ' + token);
                    this.token(token, value);
                    return value.length;
                }
                return 0;
            };
            Lexer.prototype.getLineAndColumnFromChunk = function (offset) {
                var column, lineCount, lines, string;
                if (offset === 0) {
                    return [
                        this.chunkLine,
                        this.chunkColumn
                    ];
                }
                if (offset >= this.chunk.length) {
                    string = this.chunk;
                } else {
                    string = this.chunk.slice(0, offset);
                }
                lineCount = count(string, '\n');
                column = this.chunkColumn;
                if (lineCount > 0) {
                    lines = string.split('\n');
                    column = last(lines).length;
                } else {
                    column += string.length;
                }
                return [
                    this.chunkLine + lineCount,
                    column
                ];
            };
            Lexer.prototype.makeToken = function (tag, value, offsetInChunk, length) {
                var lastCharacter, locationData, token, _ref, _ref1;
                if (offsetInChunk == null) {
                    offsetInChunk = 0;
                }
                if (length == null) {
                    length = value.length;
                }
                locationData = {};
                _ref = this.getLineAndColumnFromChunk(offsetInChunk), locationData.first_line = _ref[0], locationData.first_column = _ref[1];
                lastCharacter = Math.max(0, length - 1);
                _ref1 = this.getLineAndColumnFromChunk(offsetInChunk + lastCharacter), locationData.last_line = _ref1[0], locationData.last_column = _ref1[1];
                token = [
                    tag,
                    value,
                    locationData
                ];
                return token;
            };
            Lexer.prototype.token = function (tag, value, offsetInChunk, length) {
                var token;
                token = this.makeToken(tag, value, offsetInChunk, length);
                this.tokens.push(token);
                logging.debug('Pushed token \'' + token[0] + '\'');
                return token;
            };
            Lexer.prototype.error = function (message, offset) {
                var first_column, first_line, _ref;
                if (offset == null) {
                    offset = 0;
                }
                _ref = this.getLineAndColumnFromChunk(offset), first_line = _ref[0], first_column = _ref[1];
                return throwSyntaxError(message, {
                    first_line: first_line,
                    first_column: first_column
                });
            };
            return Lexer;
        }();
        BOM = 65279;
        IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;
        NUMBER = /^0[xX][0-9a-fA-F]+|^0[cC][0-7]+|^[0-9]+/i;
        FLOAT = /^(?:\d+\.\d*)|^(?:\d*\.\d+)/i;
        WHITESPACE = /^\s+/;
        COMMENT = /^(?:\s*\/\/.*)+/;
        TRAILING_SPACES = /\s+$/;
        MATCHERS = {
            '\\+\\+': 'PLUSPLUS',
            '\\-\\-': 'MINUSMINUS',
            ',': 'COMMA',
            '=>': 'CHUCK',
            '=<': 'UNCHUCK',
            '@=>': 'AT_CHUCK',
            '\\+=>': 'PLUS_CHUCK',
            '-=>': 'MINUS_CHUCK',
            '::': 'COLONCOLON',
            '<<<': 'L_HACK',
            '>>>': 'R_HACK',
            '\\(': 'LPAREN',
            '\\)': 'RPAREN',
            '\\{': 'LBRACE',
            '\\}': 'RBRACE',
            '\\.': 'DOT',
            '\\+': 'PLUS',
            '-': 'MINUS',
            '\\*': 'TIMES',
            '\\/': 'DIVIDE',
            '<': 'LT',
            '>': 'GT',
            '\\[': 'LBRACK',
            '\\]': 'RBRACK'
        };
        KEYWORDS = [
            'function',
            'while',
            'for',
            'break'
        ];
        ALIAS_MAP = { 'fun': 'function' };
        return {
            tokenize: function (sourceCode) {
                return new Lexer().tokenize(sourceCode);
            }
        };
    }(chuck_helpers, chuck_logging);
var __bind = function (fn, me) {
    return function () {
        return fn.apply(me, arguments);
    };
};
var chuck_audioContextService = function (logging) {
        var AudioContextService, service;
        AudioContextService = function () {
            function AudioContextService() {
                this.stopOperation = __bind(this.stopOperation, this);
                this.createScriptProcessor = __bind(this.createScriptProcessor, this);
                this.prepareForExecution = __bind(this.prepareForExecution, this);
                this.getCurrentTime = __bind(this.getCurrentTime, this);
                this.getSampleRate = __bind(this.getSampleRate, this);
                this.createGainNode = __bind(this.createGainNode, this);
                this.createOscillator = __bind(this.createOscillator, this);
            }
            AudioContextService.prototype.createOscillator = function () {
                return this._audioContext.createOscillator();
            };
            AudioContextService.prototype.createGainNode = function () {
                return this._audioContext.createGainNode();
            };
            AudioContextService.prototype.getSampleRate = function () {
                return this._audioContext.sampleRate;
            };
            AudioContextService.prototype.getCurrentTime = function () {
                return this._audioContext.currentTime * this._audioContext.sampleRate;
            };
            AudioContextService.prototype.prepareForExecution = function (ac, dn) {
                var AudioContext;
                if (ac != null) {
                    this._audioContext = ac;
                    if (dn != null) {
                        this._audioDestination = dn;
                    } else {
                        this._audioDestination = this._audioContext.destination;
                    }
                }
                if (this._audioContext != null) {
                    logging.debug('Re-using AudioContext');
                    return;
                }
                logging.debug('Initializing audio context');
                AudioContext = window.AudioContext || window.webkitAudioContext;
                this._audioContext = new AudioContext();
                if (this._audioDestination == null) {
                    this._audioDestination = this._audioContext.destination;
                }
            };
            AudioContextService.prototype.createScriptProcessor = function () {
                this._scriptProcessor = this._audioContext.createScriptProcessor(16384, 0, 2);
                this._scriptProcessor.connect(this._audioDestination);
                return this._scriptProcessor;
            };
            AudioContextService.prototype.stopOperation = function () {
                var deferred;
                if (this._scriptProcessor != null) {
                    this._scriptProcessor.disconnect(0);
                }
                deferred = Q.defer();
                deferred.resolve();
                return deferred.promise;
            };
            return AudioContextService;
        }();
        service = new AudioContextService();
        return service;
    }(chuck_logging);
var __bind = function (fn, me) {
        return function () {
            return fn.apply(me, arguments);
        };
    }, __hasProp = {}.hasOwnProperty;
var chuck_namespace = function (logging) {
        var ChuckValue, Namespace, Scope, module;
        module = {};
        module.Namespace = Namespace = function () {
            function Namespace(name, parent) {
                this.exitScope = __bind(this.exitScope, this);
                this.enterScope = __bind(this.enterScope, this);
                this.commit = __bind(this.commit, this);
                this.addValue = __bind(this.addValue, this);
                this.addConstant = __bind(this.addConstant, this);
                this.addVariable = __bind(this.addVariable, this);
                this.findValue = __bind(this.findValue, this);
                this.findType = __bind(this.findType, this);
                this.addType = __bind(this.addType, this);
                this.name = name;
                this._scope = new Scope();
                this._types = new Scope();
                this._parent = parent;
            }
            Namespace.prototype.addType = function (type) {
                this._types.addType(type);
            };
            Namespace.prototype.findType = function (name) {
                var type;
                type = this._types.findType(name);
                if (type != null) {
                    return type;
                }
                if (this._parent) {
                    return this._parent.findType(name);
                } else {
                    return void 0;
                }
            };
            Namespace.prototype.findValue = function (name, climb) {
                var val;
                if (climb == null) {
                    climb = false;
                }
                val = this._scope.findValue(name, climb);
                if (val != null) {
                    return val;
                }
                if (climb && this._parent != null) {
                    return this._parent.findValue(name, climb);
                }
            };
            Namespace.prototype.addVariable = function (name, type, value, isGlobal) {
                return this._scope.addVariable(name, type, this, value, isGlobal);
            };
            Namespace.prototype.addConstant = function (name, type, value, isGlobal) {
                return this._scope.addConstant(name, type, this, value, isGlobal);
            };
            Namespace.prototype.addValue = function (value, name, isGlobal) {
                if (isGlobal == null) {
                    isGlobal = true;
                }
                return this._scope.addValue(value, name, isGlobal);
            };
            Namespace.prototype.commit = function () {
                var scope, _i, _len, _ref;
                _ref = [
                    this._scope,
                    this._types
                ];
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    scope = _ref[_i];
                    scope.commit();
                }
            };
            Namespace.prototype.enterScope = function () {
                logging.debug('Namespace entering nested scope');
                return this._scope.push();
            };
            Namespace.prototype.exitScope = function () {
                logging.debug('Namespace exiting nested scope');
                return this._scope.pop();
            };
            return Namespace;
        }();
        module.ChuckValue = ChuckValue = function () {
            function ChuckValue(type, name, owner, isContextGlobal, value, isConstant) {
                this.type = type;
                this.name = name;
                this.owner = owner;
                this.isContextGlobal = isContextGlobal;
                this.value = value;
                this.isConstant = isConstant != null ? isConstant : false;
            }
            return ChuckValue;
        }();
        Scope = function () {
            function Scope() {
                this.addValue = __bind(this.addValue, this);
                this.commit = __bind(this.commit, this);
                this.addType = __bind(this.addType, this);
                this.findValue = __bind(this.findValue, this);
                this.addConstant = __bind(this.addConstant, this);
                this.addVariable = __bind(this.addVariable, this);
                this.findType = __bind(this.findType, this);
                this.pop = __bind(this.pop, this);
                this.push = __bind(this.push, this);
                this._scopes = [];
                this._commitMap = {};
                this.push();
            }
            Scope.prototype.push = function () {
                return this._scopes.push({});
            };
            Scope.prototype.pop = function () {
                return this._scopes.pop();
            };
            Scope.prototype.findType = function (name) {
                var i, type;
                i = this._scopes.length - 1;
                while (i >= 0) {
                    type = this._scopes[i][name];
                    if (type != null) {
                        return type;
                    }
                    --i;
                }
                return this._commitMap[name];
            };
            Scope.prototype.addVariable = function (name, type, namespace, value, isGlobal) {
                var chuckValue;
                if (isGlobal == null) {
                    isGlobal = true;
                }
                chuckValue = new ChuckValue(type, name, namespace, isGlobal, value);
                logging.debug('Scope: Adding variable ' + name + ' to scope ' + (this._scopes.length - 1));
                this.addValue(chuckValue);
                return chuckValue;
            };
            Scope.prototype.addConstant = function (name, type, namespace, value, isGlobal) {
                var chuckValue;
                if (isGlobal == null) {
                    isGlobal = true;
                }
                chuckValue = new ChuckValue(type, name, namespace, isGlobal, value, true);
                logging.debug('Scope: Adding constant ' + name + ' to scope ' + (this._scopes.length - 1));
                this.addValue(chuckValue);
                return chuckValue;
            };
            Scope.prototype.findValue = function (name, climb) {
                var lastScope, scope, value, _i, _len, _ref;
                if (!climb) {
                    lastScope = this._scopes[this._scopes.length - 1];
                    value = lastScope[name];
                    if (value != null) {
                        return value;
                    }
                    if (lastScope === this._scopes[0]) {
                        return this._commitMap[name];
                    } else {
                        return null;
                    }
                } else {
                    _ref = this._scopes.reverse();
                    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                        scope = _ref[_i];
                        value = scope[name];
                        if (value != null) {
                            return value;
                        }
                    }
                    return this._commitMap[name];
                }
            };
            Scope.prototype.addType = function (type) {
                return this.addValue(type);
            };
            Scope.prototype.commit = function () {
                var k, scope, v, _ref;
                scope = this._scopes[0];
                _ref = this._commitMap;
                for (k in _ref) {
                    if (!__hasProp.call(_ref, k))
                        continue;
                    v = _ref[k];
                    scope[k] = v;
                }
                return this._commitMap = [];
            };
            Scope.prototype.addValue = function (value, name) {
                var lastScope;
                if (name == null) {
                    name = null;
                }
                name = name != null ? name : value.name;
                lastScope = this._scopes[this._scopes.length - 1];
                if (this._scopes[0] !== lastScope) {
                    return lastScope[name] = value;
                } else {
                    return this._commitMap[name] = value;
                }
            };
            return Scope;
        }();
        return module;
    }(chuck_logging);
var __bind = function (fn, me) {
        return function () {
            return fn.apply(me, arguments);
        };
    }, __hasProp = {}.hasOwnProperty, __extends = function (child, parent) {
        for (var key in parent) {
            if (__hasProp.call(parent, key))
                child[key] = parent[key];
        }
        function ctor() {
            this.constructor = child;
        }
        ctor.prototype = parent.prototype;
        child.prototype = new ctor();
        child.__super__ = parent.prototype;
        return child;
    };
var chuck_types = function (audioContextService, namespace, logging) {
        var ChuckFunction, ChuckFunctionBase, ChuckMethod, ChuckStaticMethod, ChuckType, FuncArg, FunctionOverload, OscData, TwoPi, adsrNamespace, arrayNamespace, constructAdsr, constructDac, constructEnvelope, constructObject, constructOsc, constructStep, module, oscNamespace, shredNamespace, stepNamespace, tickAdsr, tickSinOsc, tickStep, types, ugenNamespace;
        module = {};
        TwoPi = Math.PI * 2;
        module.ChuckType = ChuckType = function () {
            function ChuckType(name, parent, opts, constructorCb) {
                this._constructParent = __bind(this._constructParent, this);
                this.findValue = __bind(this.findValue, this);
                this.isOfType = __bind(this.isOfType, this);
                var k, memberType, v, _ref;
                opts = opts || {};
                this.name = name;
                this.parent = parent;
                this.size = opts.size;
                this._constructor = constructorCb;
                this._opts = opts;
                this._namespace = new namespace.Namespace();
                this.isRef = opts.isRef || false;
                this._constructParent(parent, this._opts);
                if (constructorCb != null) {
                    constructorCb.call(this, this._opts);
                }
                opts.namespace = opts.namespace || {};
                _ref = opts.namespace;
                for (k in _ref) {
                    if (!__hasProp.call(_ref, k))
                        continue;
                    v = _ref[k];
                    memberType = v instanceof ChuckFunctionBase ? types.Function : void 0;
                    this._namespace.addVariable(k, memberType, v);
                }
            }
            ChuckType.prototype.isOfType = function (otherType) {
                var parent;
                if (this.name === otherType.name) {
                    return true;
                }
                parent = this.parent;
                while (parent != null) {
                    if (parent.isOfType(otherType)) {
                        return true;
                    }
                    parent = parent.parent;
                }
                return false;
            };
            ChuckType.prototype.findValue = function (name) {
                var val;
                val = this._namespace.findValue(name);
                if (val != null) {
                    return val;
                }
                if (this.parent != null) {
                    return this.parent.findValue(name);
                }
            };
            ChuckType.prototype._constructParent = function (parent, opts) {
                if (parent == null) {
                    return;
                }
                opts = _({}).extend(parent._opts).extend(opts).value();
                this._constructParent(parent.parent, opts);
                if (parent._constructor != null) {
                    return parent._constructor.call(this, opts);
                }
            };
            return ChuckType;
        }();
        types = module.types = {};
        types.int = new ChuckType('int', void 0, {
            size: 8,
            preConstructor: void 0
        });
        types.float = new ChuckType('float', void 0, {
            size: 8,
            preConstructor: void 0
        });
        types.Time = new ChuckType('time', void 0, {
            size: 8,
            preConstructor: void 0
        });
        types.dur = new ChuckType('dur', void 0, {
            size: 8,
            preConstructor: void 0
        });
        types.String = new ChuckType('String', void 0, {
            size: 8,
            preConstructor: void 0,
            isRef: true
        });
        module.FuncArg = FuncArg = function () {
            function FuncArg(name, type) {
                this.name = name;
                this.type = type;
            }
            return FuncArg;
        }();
        module.FunctionOverload = FunctionOverload = function () {
            function FunctionOverload(args, func, isBuiltIn, name) {
                this.isBuiltIn = isBuiltIn != null ? isBuiltIn : true;
                this.name = name != null ? name : null;
                this.apply = __bind(this.apply, this);
                args = args != null ? args : [];
                this['arguments'] = args;
                this.func = func;
                this.stackDepth = args.length;
            }
            FunctionOverload.prototype.apply = function (obj) {
                return this.func.apply(arguments[0], arguments[1]);
            };
            return FunctionOverload;
        }();
        ChuckFunctionBase = function () {
            function ChuckFunctionBase(name, overloads, isMember, typeName, retType) {
                var overload, _i, _len;
                if (retType == null) {
                    throw new Error('retType unspecified');
                }
                this.name = name;
                this.isMember = isMember;
                this._overloads = [];
                this.retType = retType;
                this._typeName = typeName;
                for (_i = 0, _len = overloads.length; _i < _len; _i++) {
                    overload = overloads[_i];
                    this.addOverload(overload);
                }
            }
            ChuckFunctionBase.prototype.addOverload = function (overload) {
                if (this._typeName) {
                    overload.name = '' + overload.name + '@' + this._typename;
                }
                overload.isMember = this.isMember;
                overload.retType = this.retType;
                if (this.isMember) {
                    ++overload.stackDepth;
                }
                return this._overloads.push(overload);
            };
            ChuckFunctionBase.prototype.findOverload = function (args) {
                var mthd, _i, _len, _ref;
                args = args != null ? args : [];
                _ref = this._overloads;
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    mthd = _ref[_i];
                    if (mthd['arguments'].length !== args.length) {
                        continue;
                    }
                    if (!_.every(mthd['arguments'], function (a, index) {
                            return a.type === args[index].type || a.type === types.float && args[index].type === types.int;
                        })) {
                        continue;
                    }
                    return mthd;
                }
                return null;
            };
            ChuckFunctionBase.prototype.getNumberOfOverloads = function () {
                return this._overloads.length;
            };
            return ChuckFunctionBase;
        }();
        module.ChuckMethod = ChuckMethod = function (_super) {
            __extends(ChuckMethod, _super);
            function ChuckMethod(name, overloads, typeName, retType) {
                ChuckMethod.__super__.constructor.call(this, name, overloads, true, typeName, retType);
            }
            return ChuckMethod;
        }(ChuckFunctionBase);
        module.ChuckStaticMethod = ChuckStaticMethod = function (_super) {
            __extends(ChuckStaticMethod, _super);
            function ChuckStaticMethod(name, overloads, typeName, retType) {
                ChuckStaticMethod.__super__.constructor.call(this, name, overloads, false, typeName, retType);
                this.isStatic = true;
            }
            return ChuckStaticMethod;
        }(ChuckFunctionBase);
        module.ChuckFunction = ChuckFunction = function (_super) {
            __extends(ChuckFunction, _super);
            function ChuckFunction(name, overloads, retType) {
                ChuckFunction.__super__.constructor.call(this, name, overloads, false, null, retType);
            }
            return ChuckFunction;
        }(ChuckFunctionBase);
        types.Function = new ChuckType('Function', null, null);
        constructObject = function () {
        };
        types.Object = new ChuckType('Object', void 0, { preConstructor: constructObject }, function (opts) {
            this.hasConstructor = opts.preConstructor != null;
            this.preConstructor = opts.preConstructor;
            return this.size = opts.size;
        });
        module.Class = new ChuckType('Class', types.Object);
        ugenNamespace = {
            gain: new ChuckMethod('gain', [new FunctionOverload([new FuncArg('value', types.float)], function (value) {
                    return this.setGain(value);
                })], 'UGen', types.float)
        };
        types.UGen = new ChuckType('UGen', types.Object, {
            size: 8,
            numIns: 1,
            numOuts: 1,
            preConstructor: void 0,
            namespace: ugenNamespace,
            ugenTick: void 0
        }, function (opts) {
            this.ugenNumIns = opts.numIns;
            this.ugenNumOuts = opts.numOuts;
            return this.ugenTick = opts.ugenTick;
        });
        OscData = function () {
            function OscData() {
                this.num = 0;
                this.sync = 0;
                this.width = 0.5;
                this.phase = 0;
            }
            return OscData;
        }();
        oscNamespace = {
            freq: new ChuckMethod('freq', [new FunctionOverload([new FuncArg('value', types.float)], function (value) {
                    return this.setFrequency(value);
                })], 'Osc', types.float)
        };
        constructOsc = function () {
            this.data = new OscData();
            this.setFrequency = function (value) {
                this.data.num = 1 / audioContextService.getSampleRate() * value;
                return value;
            };
            return this.setFrequency(220);
        };
        types.Osc = new ChuckType('Osc', types.UGen, {
            numIns: 1,
            numOuts: 1,
            preConstructor: constructOsc,
            namespace: oscNamespace
        });
        tickSinOsc = function () {
            var out;
            out = Math.sin(this.data.phase * TwoPi);
            this.data.phase += this.data.num;
            if (this.data.phase > 1) {
                this.data.phase -= 1;
            } else if (this.data.phase < 0) {
                this.data.phase += 1;
            }
            return out;
        };
        types.SinOsc = new ChuckType('SinOsc', types.Osc, {
            preConstructor: void 0,
            ugenTick: tickSinOsc
        });
        types.UGenStereo = new ChuckType('Ugen_Stereo', types.UGen, {
            numIns: 2,
            numOuts: 2,
            preConstructor: void 0
        });
        constructDac = function () {
            return this._node = audioContextService.outputNode;
        };
        types.Dac = new ChuckType('Dac', types.UGenStereo, { preConstructor: constructDac });
        types['void'] = new ChuckType('void');
        module.isObj = function (type) {
            return !module.isPrimitive(type);
        };
        module.isPrimitive = function (type) {
            return type === types.dur || type === types.Time || type === types.int || type === types.float;
        };
        types.Gain = new ChuckType('Gain', types.UGenStereo);
        stepNamespace = {
            next: new ChuckMethod('next', [new FunctionOverload([new FuncArg('value', types.float)], function (value) {
                    return this.data.next = value;
                })], 'Step', types.float)
        };
        constructStep = function () {
            return this.data.next = 1;
        };
        tickStep = function () {
            return this.data.next;
        };
        types.Step = new ChuckType('Step', types.Osc, {
            namespace: stepNamespace,
            preConstructor: constructStep,
            ugenTick: tickStep
        });
        constructEnvelope = function () {
            return this.data = {
                target: 0,
                value: 0
            };
        };
        types.Envelope = new ChuckType('Envelope', types.UGen, { preConstructor: constructEnvelope });
        adsrNamespace = {
            set: new ChuckMethod('set', [new FunctionOverload([
                    new FuncArg('attack', types.dur),
                    new FuncArg('decay', types.dur),
                    new FuncArg('sustain', types.float),
                    new FuncArg('release', types.dur)
                ], function (attack, decay, sustainLevel, release) {
                    var computeRate, d;
                    computeRate = function (target, time) {
                        return target / time;
                    };
                    d = this.data;
                    d.attackRate = computeRate(1, attack);
                    d.decayRate = computeRate(1 - sustainLevel, decay);
                    d.releaseRate = computeRate(sustainLevel, release);
                    return d.sustainLevel = sustainLevel;
                })], 'ADSR', types['void']),
            keyOn: new ChuckMethod('keyOn', [new FunctionOverload([], function () {
                    logging.debug('keyOn state');
                    this.data.target = 1;
                    this.data.rate = this.data.attackRate;
                    return this.data.state = 'attack';
                })], 'ADSR', types['void']),
            keyOff: new ChuckMethod('keyOff', [new FunctionOverload([], function () {
                    logging.debug('keyOff state');
                    this.data.rate = this.data.releaseRate;
                    this.data.target = 0;
                    return this.data.state = 'release';
                })], 'ADSR', types['void'])
        };
        constructAdsr = function () {
            this.data.attackRate = 0.001;
            this.data.decayRate = 0.001;
            this.data.sustainLevel = 0.5;
            this.data.releaseRate = 0.01;
            this.data.state = 'attack';
            this.data.rate = 1;
            return this.data.value = 0;
        };
        tickAdsr = function (input) {
            var d;
            d = this.data;
            switch (d.state) {
            case 'attack':
                d.value += d.rate;
                if (d.value >= d.target) {
                    d.value = d.target;
                    d.rate = d.decayRate;
                    d.target = d.sustainLevel;
                    d.state = 'decay';
                    logging.debug('Transitioned to decay state, value: ' + d.value);
                }
                break;
            case 'decay':
                d.value -= d.decayRate;
                if (d.value <= d.sustainLevel) {
                    d.value = d.sustainLevel;
                    d.rate = 0;
                    d.state = 'sustain';
                }
                break;
            case 'release':
                d.value -= d.rate;
                if (d.value <= 0) {
                    d.value = 0;
                    d.state = 'done';
                }
            }
            return input * d.value;
        };
        types.Adsr = new ChuckType('ADSR', types.Envelope, {
            preConstructor: constructAdsr,
            namespace: adsrNamespace,
            ugenTick: tickAdsr
        });
        shredNamespace = {
            args: new ChuckMethod('args', [new FunctionOverload([], function () {
                    return this.args.length;
                })], 'Shred', types.int),
            arg: new ChuckMethod('arg', [new FunctionOverload([new FuncArg('i', types.int)], function (i) {
                    return this.args[i];
                })], 'Shred', types.String)
        };
        types.shred = new ChuckType('Shred', types.Object, { namespace: shredNamespace });
        arrayNamespace = {
            cap: new ChuckMethod('cap', [new FunctionOverload([], function () {
                    return this.length;
                })], '@array', types.int),
            size: new ChuckMethod('size', [new FunctionOverload([], function () {
                    return this.length;
                })], '@array', types.int)
        };
        types['@array'] = new ChuckType('@array', types.Object, {
            size: 1,
            namespace: arrayNamespace
        });
        module.createArrayType = function (elemType, depth) {
            var type;
            type = new ChuckType(elemType.name, types['@array']);
            type.depth = depth;
            type.arrayType = elemType;
            type.isArray = true;
            return type;
        };
        return module;
    }(chuck_audioContextService, chuck_namespace, chuck_logging);
var __bind = function (fn, me) {
        return function () {
            return fn.apply(me, arguments);
        };
    }, __hasProp = {}.hasOwnProperty, __extends = function (child, parent) {
        for (var key in parent) {
            if (__hasProp.call(parent, key))
                child[key] = parent[key];
        }
        function ctor() {
            this.constructor = child;
        }
        ctor.prototype = parent.prototype;
        child.prototype = new ctor();
        child.__super__ = parent.prototype;
        return child;
    };
var chuck_nodes = function (typesModule, logging, audioContextService) {
        var AdditiveSubtractiveOperatorBase, Arg, ArrayExpression, AtChuckOperator, DivideOperator, ExpressionBase, ExpressionList, FunctionDefinition, GtLtOperatorBase, MinusChuckOperator, NodeBase, ParentNodeBase, PlusChuckOperator, PlusPlusOperatorBase, PrimaryArrayExpression, TimesDivideOperatorBase, TimesOperator, module, types;
        module = {};
        types = typesModule.types;
        NodeBase = function () {
            function NodeBase(nodeType) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                this.scanPass1 = __bind(this.scanPass1, this);
                this.nodeType = nodeType;
            }
            NodeBase.prototype.scanPass1 = function () {
            };
            NodeBase.prototype.scanPass2 = function () {
            };
            NodeBase.prototype.scanPass3 = function () {
            };
            NodeBase.prototype.scanPass4 = function () {
            };
            NodeBase.prototype.scanPass5 = function () {
            };
            return NodeBase;
        }();
        ParentNodeBase = function () {
            function ParentNodeBase(child, nodeType) {
                this._scanArray = __bind(this._scanArray, this);
                this._scanPass = __bind(this._scanPass, this);
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                this.scanPass1 = __bind(this.scanPass1, this);
                this._child = child;
                this.nodeType = nodeType;
            }
            ParentNodeBase.prototype.scanPass1 = function (context) {
                return this._scanPass(1, context);
            };
            ParentNodeBase.prototype.scanPass2 = function (context) {
                return this._scanPass(2, context);
            };
            ParentNodeBase.prototype.scanPass3 = function (context) {
                return this._scanPass(3, context);
            };
            ParentNodeBase.prototype.scanPass4 = function (context) {
                return this._scanPass(4, context);
            };
            ParentNodeBase.prototype.scanPass5 = function (context) {
                return this._scanPass(5, context);
            };
            ParentNodeBase.prototype._scanPass = function (pass, context) {
                if (!this._child) {
                    return;
                }
                if (_.isArray(this._child)) {
                    return this._scanArray(this._child, pass, context);
                } else {
                    return this._child['scanPass' + pass](context);
                }
            };
            ParentNodeBase.prototype._scanArray = function (array, pass, context) {
                var c, _i, _len;
                for (_i = 0, _len = array.length; _i < _len; _i++) {
                    c = array[_i];
                    if (_.isArray(c)) {
                        this._scanArray(c, pass, context);
                    } else {
                        c['scanPass' + pass](context);
                    }
                }
            };
            return ParentNodeBase;
        }();
        module.Program = function (_super) {
            __extends(_Class, _super);
            function _Class(child) {
                _Class.__super__.constructor.call(this, child, 'Program');
            }
            return _Class;
        }(ParentNodeBase);
        module.ExpressionStatement = function (_super) {
            __extends(_Class, _super);
            function _Class(exp) {
                this.scanPass5 = __bind(this.scanPass5, this);
                _Class.__super__.constructor.call(this, exp, 'ExpressionStatement');
            }
            _Class.prototype.scanPass5 = function (context, opts) {
                var shouldPop;
                opts = opts || {};
                shouldPop = opts.pop != null ? opts.pop : true;
                this._child.scanPass5(context);
                if (this._child.type != null && this._child.type.size > 0) {
                    if (shouldPop) {
                        logging.debug('ExpressionStatement: Emitting PopWord to remove superfluous return value');
                        return context.emitPopWord();
                    }
                } else {
                    return logging.debug('ExpressionStatement: Child expression has no return value');
                }
            };
            return _Class;
        }(ParentNodeBase);
        module.BinaryExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(exp1, operator, exp2) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                _Class.__super__.constructor.call(this, 'BinaryExpression');
                this.exp1 = exp1;
                this.operator = operator;
                this.exp2 = exp2;
            }
            _Class.prototype.scanPass2 = function (context) {
                this.exp1.scanPass2(context);
                this.exp2.scanPass2(context);
            };
            _Class.prototype.scanPass3 = function (context) {
                this.exp1.scanPass3(context);
                this.exp2.scanPass3(context);
            };
            _Class.prototype.scanPass4 = function (context) {
                this.exp1.scanPass4(context);
                logging.debug('BinaryExpression ' + this.operator.name + ': Type checked LHS, type ' + this.exp1.type.name);
                this.exp2.scanPass4(context);
                logging.debug('BinaryExpression ' + this.operator.name + ': Type checked RHS, type ' + this.exp2.type.name);
                this.type = this.operator.check(this.exp1, this.exp2, context);
                logging.debug('BinaryExpression ' + this.operator.name + ': Type checked operator, type ' + this.type.name);
            };
            _Class.prototype.scanPass5 = function (context) {
                logging.debug('Binary expression ' + this.operator.name + ': Emitting LHS');
                this.exp1.scanPass5(context);
                logging.debug('Binary expression ' + this.operator.name + ': Emitting RHS');
                this.exp2.scanPass5(context);
                logging.debug('Binary expression ' + this.operator.name + ': Emitting operator');
                this.operator.emit(context, this.exp1, this.exp2);
            };
            return _Class;
        }(NodeBase);
        ExpressionBase = function (_super) {
            __extends(ExpressionBase, _super);
            function ExpressionBase(nodeType, meta) {
                if (meta == null) {
                    meta = 'value';
                }
                ExpressionBase.__super__.constructor.call(this, nodeType);
                this._meta = meta;
            }
            return ExpressionBase;
        }(NodeBase);
        module.ExpressionList = ExpressionList = function (_super) {
            __extends(ExpressionList, _super);
            function ExpressionList(expression) {
                this.scanPass4 = __bind(this.scanPass4, this);
                this._scanPass = __bind(this._scanPass, this);
                this.prepend = __bind(this.prepend, this);
                ExpressionList.__super__.constructor.call(this, 'ExpressionList');
                this._expressions = [expression];
            }
            ExpressionList.prototype.prepend = function (expression) {
                this._expressions.splice(0, 0, expression);
                return this;
            };
            ExpressionList.prototype._scanPass = function (pass) {
                var exp, _i, _len, _ref;
                _ref = this._expressions;
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    exp = _ref[_i];
                    exp['scanPass' + pass].apply(exp, Array.prototype.slice.call(arguments, 1));
                }
            };
            ExpressionList.prototype.scanPass1 = _.partial(ExpressionList.prototype._scanPass, 1);
            ExpressionList.prototype.scanPass2 = _.partial(ExpressionList.prototype._scanPass, 2);
            ExpressionList.prototype.scanPass3 = _.partial(ExpressionList.prototype._scanPass, 3);
            ExpressionList.prototype.scanPass4 = function (context) {
                var exp;
                this._scanPass(4, context);
                this.types = function () {
                    var _i, _len, _ref, _results;
                    _ref = this._expressions;
                    _results = [];
                    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                        exp = _ref[_i];
                        _results.push(exp.type);
                    }
                    return _results;
                }.call(this);
                return this.type = this.types[0];
            };
            ExpressionList.prototype.scanPass5 = _.partial(ExpressionList.prototype._scanPass, 5);
            ExpressionList.prototype.getCount = function () {
                return this._expressions.length;
            };
            return ExpressionList;
        }(ExpressionBase);
        module.DeclarationExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(typeDecl, varDecls) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                _Class.__super__.constructor.call(this, 'DeclarationExpression');
                this.typeDecl = typeDecl;
                this.varDecls = varDecls;
            }
            _Class.prototype.scanPass2 = function (context) {
                this.type = context.findType(this.typeDecl.type);
                logging.debug('Variable declaration of type ' + this.type.name);
            };
            _Class.prototype.scanPass3 = function (context) {
                var varDecl, _i, _len, _ref;
                _ref = this.varDecls;
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    varDecl = _ref[_i];
                    logging.debug('Adding variable \'' + varDecl.name + '\' of type ' + this.type.name + ' to current namespace');
                    if (varDecl.array != null) {
                        this.type = typesModule.createArrayType(this.type, varDecl.array.getCount());
                        logging.debug('Variable is an array, giving it array type', this.type);
                    }
                    varDecl.value = context.addVariable(varDecl.name, this.type);
                }
            };
            _Class.prototype.scanPass4 = function (context) {
                var varDecl, _i, _len, _ref;
                _Class.__super__.scanPass4.call(this);
                _ref = this.varDecls;
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    varDecl = _ref[_i];
                    logging.debug('' + this.nodeType + ' Checking variable ' + varDecl.name);
                    varDecl.value.isDeclChecked = true;
                    context.addValue(varDecl.value);
                }
            };
            _Class.prototype.scanPass5 = function (context) {
                var varDecl, _i, _len, _ref;
                _Class.__super__.scanPass5.call(this);
                _ref = this.varDecls;
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    varDecl = _ref[_i];
                    if (varDecl.array != null) {
                        if (varDecl.array.exp == null) {
                            logging.debug('' + this.nodeType + ': Empty array, only allocating object', varDecl);
                            context.allocateLocal(this.type, varDecl.value);
                            return;
                        }
                        logging.debug('' + this.nodeType + ': Instantiating array', varDecl);
                    } else {
                        logging.debug('' + this.nodeType + ': Emitting Assignment for value ' + varDecl.value);
                    }
                }
                context.emitAssignment(this.type, varDecl);
            };
            return _Class;
        }(ExpressionBase);
        module.TypeDeclaration = function (_super) {
            __extends(_Class, _super);
            function _Class(type) {
                _Class.__super__.constructor.call(this, 'TypeDeclaration');
                this.type = type;
            }
            return _Class;
        }(NodeBase);
        module.VariableDeclaration = function (_super) {
            __extends(_Class, _super);
            function _Class(name, array) {
                _Class.__super__.constructor.call(this, 'VariableDeclaration');
                this.name = name;
                this.array = array;
            }
            return _Class;
        }(NodeBase);
        module.PrimaryVariableExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(name) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                _Class.__super__.constructor.call(this, 'PrimaryVariableExpression', 'variable');
                this.name = name;
                this._emitVar = false;
            }
            _Class.prototype.scanPass4 = function (context) {
                _Class.__super__.scanPass4.call(this);
                switch (this.name) {
                case 'dac':
                    this._meta = 'value';
                    this.type = types.Dac;
                    break;
                case 'second':
                    this.type = types.dur;
                    break;
                case 'ms':
                    this.type = types.dur;
                    break;
                case 'samp':
                    this.type = types.dur;
                    break;
                case 'hour':
                    this.type = types.dur;
                    break;
                case 'now':
                    this.type = types.Time;
                    break;
                case 'true':
                    this._meta = 'value';
                    return this.type = types.int;
                case 'me':
                    this._meta = 'value';
                    return this.type = types.shred;
                default:
                    this.value = context.findValue(this.name);
                    if (this.value == null) {
                        this.value = context.findValue(this.name, true);
                    }
                    this.type = this.value.type;
                    logging.debug('Primary variable of type ' + this.type.name);
                    return this.type;
                }
            };
            _Class.prototype.scanPass5 = function (context) {
                var scopeStr;
                _Class.__super__.scanPass5.call(this);
                switch (this.name) {
                case 'dac':
                    context.emitDac();
                    break;
                case 'second':
                    context.emitRegPushImm(audioContextService.getSampleRate());
                    break;
                case 'ms':
                    context.emitRegPushImm(audioContextService.getSampleRate() / 1000);
                    break;
                case 'samp':
                    context.emitRegPushImm(1);
                    break;
                case 'hour':
                    context.emitRegPushImm(audioContextService.getSampleRate() * 60 * 60);
                    break;
                case 'now':
                    context.emitRegPushNow();
                    break;
                case 'me':
                    context.emitRegPushMe();
                    break;
                case 'true':
                    context.emitRegPushImm(1);
                    break;
                default:
                    scopeStr = this.value.isContextGlobal ? 'global' : 'function';
                    if (this._emitVar) {
                        logging.debug('' + this.nodeType + ': Emitting RegPushMemAddr (' + this.value.offset + ') since this is a variable (scope: ' + scopeStr + ')');
                        context.emitRegPushMemAddr(this.value.offset, this.value.isContextGlobal);
                    } else {
                        logging.debug('' + this.nodeType + ': Emitting RegPushMem (' + this.value.offset + ') since this is a constant (scope: ' + scopeStr + ')');
                        context.emitRegPushMem(this.value.offset, this.value.isContextGlobal);
                    }
                }
            };
            return _Class;
        }(ExpressionBase);
        module.PrimaryIntExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(value) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                _Class.__super__.constructor.call(this, 'PrimaryIntExpression', 'value');
                this.value = parseInt(value);
            }
            _Class.prototype.scanPass4 = function () {
                _Class.__super__.scanPass4.call(this);
                return this.type = types.int;
            };
            _Class.prototype.scanPass5 = function (context) {
                _Class.__super__.scanPass5.call(this);
                logging.debug('' + this.nodeType + ': Emitting RegPushImm(' + this.value + ')');
                return context.emitRegPushImm(this.value);
            };
            return _Class;
        }(ExpressionBase);
        module.PrimaryFloatExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(value) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                _Class.__super__.constructor.call(this, 'PrimaryFloatExpression', 'value');
                this.value = parseFloat(value);
            }
            _Class.prototype.scanPass4 = function () {
                _Class.__super__.scanPass4.call(this);
                return this.type = types.float;
            };
            _Class.prototype.scanPass5 = function (context) {
                _Class.__super__.scanPass5.call(this);
                logging.debug('' + this.nodeType + ': Emitting RegPushImm for ' + this.value);
                return context.emitRegPushImm(this.value);
            };
            return _Class;
        }(ExpressionBase);
        module.PrimaryHackExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(expression) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                _Class.__super__.constructor.call(this, 'PrimaryHackExpression', 'value');
                this.expression = expression;
            }
            _Class.prototype.scanPass4 = function (context) {
                _Class.__super__.scanPass4.call(this, context);
                logging.debug('' + this.nodeType + ' scanPass4: Checking child expression');
                this.expression.scanPass4(context);
            };
            _Class.prototype.scanPass5 = function (context) {
                var t;
                _Class.__super__.scanPass5.call(this);
                logging.debug('' + this.nodeType + ': Emitting child expression');
                this.expression.scanPass5(context);
                logging.debug('' + this.nodeType + ': Emitting Gack, types:', function () {
                    var _i, _len, _ref, _results;
                    _ref = this.expression.types;
                    _results = [];
                    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                        t = _ref[_i];
                        _results.push(t.name);
                    }
                    return _results;
                }.call(this));
                context.emitGack(this.expression.types);
            };
            return _Class;
        }(ExpressionBase);
        module.PrimaryStringExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(value) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                _Class.__super__.constructor.call(this, 'PrimaryStringExpression', 'value');
                this.value = value;
            }
            _Class.prototype.scanPass4 = function () {
                _Class.__super__.scanPass4.call(this);
                return this.type = types.String;
            };
            _Class.prototype.scanPass5 = function (context) {
                _Class.__super__.scanPass5.call(this);
                return context.emitRegPushImm(this.value);
            };
            return _Class;
        }(ExpressionBase);
        module.ArrayExpression = ArrayExpression = function (_super) {
            __extends(ArrayExpression, _super);
            function ArrayExpression(base, indices) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                this.scanPass1 = __bind(this.scanPass1, this);
                ArrayExpression.__super__.constructor.call(this, 'ArrayExpression', 'variable');
                this.base = base;
                this.indices = indices;
            }
            ArrayExpression.prototype.scanPass1 = function () {
                ArrayExpression.__super__.scanPass1.call(this);
                this.base.scanPass1();
                return this.indices.scanPass1();
            };
            ArrayExpression.prototype.scanPass2 = function () {
                ArrayExpression.__super__.scanPass2.call(this);
                this.base.scanPass2();
                return this.indices.scanPass2();
            };
            ArrayExpression.prototype.scanPass3 = function () {
                ArrayExpression.__super__.scanPass3.call(this);
                this.base.scanPass3();
                return this.indices.scanPass3();
            };
            ArrayExpression.prototype.scanPass4 = function (context) {
                var baseType;
                ArrayExpression.__super__.scanPass4.call(this, context);
                logging.debug('' + this.nodeType + ' scanPass4: Base');
                baseType = this.base.scanPass4(context);
                logging.debug('' + this.nodeType + ' scanPass4: Indices');
                this.indices.scanPass4(context);
                this.type = baseType.arrayType;
                logging.debug('' + this.nodeType + ' scanPass4: Type determined to be ' + this.type.name);
                return this.type;
            };
            ArrayExpression.prototype.scanPass5 = function (context) {
                logging.debug('' + this.nodeType + ' emitting');
                ArrayExpression.__super__.scanPass5.call(this, context);
                this.base.scanPass5(context);
                this.indices.scanPass5(context);
                logging.debug('' + this.nodeType + ': Emitting ArrayAccess (as variable: ' + this._emitVar + ')');
                context.emitArrayAccess(this.type, this._emitVar);
            };
            return ArrayExpression;
        }(ExpressionBase);
        module.FuncCallExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(base, args) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                this.scanPass1 = __bind(this.scanPass1, this);
                _Class.__super__.constructor.call(this, 'FuncCallExpression');
                this.func = base;
                this.args = args;
            }
            _Class.prototype.scanPass1 = function () {
                logging.debug('' + this.nodeType + ': scanPass1');
                _Class.__super__.scanPass1.call(this);
                this.func.scanPass1();
                if (this.args != null) {
                    return this.args.scanPass1();
                }
            };
            _Class.prototype.scanPass2 = function () {
                logging.debug('' + this.nodeType + ': scanPass2');
                _Class.__super__.scanPass2.call(this);
                this.func.scanPass2();
                if (this.args != null) {
                    return this.args.scanPass2();
                }
            };
            _Class.prototype.scanPass3 = function () {
                logging.debug('' + this.nodeType + ': scanPass3');
                _Class.__super__.scanPass3.call(this);
                this.func.scanPass3();
                if (this.args != null) {
                    return this.args.scanPass3();
                }
            };
            _Class.prototype.scanPass4 = function (context) {
                var funcGroup;
                _Class.__super__.scanPass4.call(this, context);
                logging.debug('' + this.nodeType + ' scanPass4: Checking type of @func');
                this.func.scanPass4(context);
                if (this.args != null) {
                    this.args.scanPass4(context);
                }
                funcGroup = this.func.value.value;
                logging.debug('' + this.nodeType + ' scanPass4: Finding function overload');
                this._ckFunc = funcGroup.findOverload(this.args != null ? this.args._expressions : null);
                this.type = funcGroup.retType;
                logging.debug('' + this.nodeType + ' scanPass4: Got function overload ' + this._ckFunc.name + ' with return type ' + this.type.name);
                return this.type;
            };
            _Class.prototype.scanPass5 = function (context) {
                logging.debug('' + this.nodeType + ' scanPass5');
                _Class.__super__.scanPass5.call(this, context);
                if (this.args != null) {
                    logging.debug('' + this.nodeType + ': Emitting arguments');
                    this.args.scanPass5(context);
                }
                if (this._ckFunc.isMember) {
                    logging.debug('' + this.nodeType + ': Emitting method instance');
                    this.func.scanPass5(context);
                    logging.debug('' + this.nodeType + ': Emitting duplication of \'this\' reference on stack');
                    context.emitRegDupLast();
                }
                logging.debug('' + this.nodeType + ': Emitting function ' + this._ckFunc.name);
                if (this._ckFunc.isMember) {
                    context.emitDotMemberFunc(this._ckFunc);
                } else {
                    context.emitDotStaticFunc(this._ckFunc);
                }
                context.emitRegPushImm(context.getCurrentOffset());
                if (this._ckFunc.isBuiltIn) {
                    if (this._ckFunc.isMember) {
                        logging.debug('' + this.nodeType + ': Emitting instance method call');
                        return context.emitFuncCallMember();
                    } else {
                        logging.debug('' + this.nodeType + ': Emitting static method call');
                        return context.emitFuncCallStatic();
                    }
                } else {
                    logging.debug('' + this.nodeType + ': Emitting function call');
                    return context.emitFuncCall();
                }
            };
            return _Class;
        }(ExpressionBase);
        module.DurExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(base, unit) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                _Class.__super__.constructor.call(this, 'DurExpression');
                this.base = base;
                this.unit = unit;
            }
            _Class.prototype.scanPass2 = function () {
                _Class.__super__.scanPass2.call(this);
                logging.debug('DurExpression');
                this.base.scanPass2();
                return this.unit.scanPass2();
            };
            _Class.prototype.scanPass3 = function () {
                _Class.__super__.scanPass3.call(this);
                this.base.scanPass3();
                return this.unit.scanPass3();
            };
            _Class.prototype.scanPass4 = function () {
                _Class.__super__.scanPass4.call(this);
                this.type = types.dur;
                this.base.scanPass4();
                return this.unit.scanPass4();
            };
            _Class.prototype.scanPass5 = function (context) {
                _Class.__super__.scanPass5.call(this);
                this.base.scanPass5(context);
                this.unit.scanPass5(context);
                return context.emitTimesNumber();
            };
            return _Class;
        }(ExpressionBase);
        module.UnaryExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(operator, exp) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.op = operator;
                this.exp = exp;
            }
            _Class.prototype.scanPass4 = function (context) {
                if (this.exp != null) {
                    this.exp.scanPass4(context);
                }
                return this.type = this.op.check(this.exp);
            };
            _Class.prototype.scanPass5 = function (context) {
                logging.debug('UnaryExpression: Emitting expression');
                this.exp.scanPass5(context);
                logging.debug('UnaryExpression: Emitting operator');
                this.op.emit(context, this.exp.value.isContextGlobal);
            };
            return _Class;
        }(ExpressionBase);
        module.ChuckOperator = function () {
            function _Class() {
                this.emit = __bind(this.emit, this);
                this.check = __bind(this.check, this);
                this.name = 'ChuckOperator';
            }
            _Class.prototype.check = function (lhs, rhs, context) {
                var funcGroup;
                if (lhs.type === rhs.type) {
                    if (typesModule.isPrimitive(lhs.type) || lhs.type === types.String) {
                        if (rhs._meta === 'variable') {
                            rhs._emitVar = true;
                        }
                        return rhs.type;
                    }
                }
                if (lhs.type === types.dur && rhs.type === types.Time && rhs.name === 'now') {
                    return rhs.type;
                }
                if (lhs.type.isOfType(types.UGen) && rhs.type.isOfType(types.UGen)) {
                    return rhs.type;
                }
                if (rhs.type.isOfType(types.Function)) {
                    rhs.scanPass4(context);
                    funcGroup = rhs.value.value;
                    rhs._ckFunc = funcGroup.findOverload([lhs]);
                    this.type = funcGroup.retType;
                    logging.debug('' + this.name + ' check: Got function overload ' + rhs._ckFunc.name + ' with return type ' + this.type.name);
                    return this.type;
                }
                if (lhs.type === types.int && rhs.type === types.float) {
                    lhs.castTo = rhs.type;
                    return types.float;
                }
            };
            _Class.prototype.emit = function (context, lhs, rhs) {
                var isArray, lType, rType;
                logging.debug('' + this.name + ' scanPass5');
                lType = lhs.castTo != null ? lhs.castTo : lhs.type;
                rType = rhs.castTo != null ? rhs.castTo : rhs.type;
                if (lType.isOfType(types.UGen) && rType.isOfType(types.UGen)) {
                    context.emitUGenLink();
                } else if (lType.isOfType(types.dur) && rType.isOfType(types.Time)) {
                    context.emitAddNumber();
                    if (rhs.name === 'now') {
                        context.emitTimeAdvance();
                    }
                } else if (rType.isOfType(types.Function)) {
                    if (rhs._ckFunc.isMember) {
                        logging.debug('' + this.name + ': Emitting duplication of \'this\' reference on stack');
                        context.emitRegDupLast();
                        logging.debug('' + this.nodeType + ': Emitting instance method ' + rhs._ckFunc.name);
                        context.emitDotMemberFunc(rhs._ckFunc);
                        logging.debug('' + this.nodeType + ' emitting instance method call');
                    } else {
                        logging.debug('' + this.nodeType + ': Emitting static method ' + rhs._ckFunc.name);
                        context.emitDotStaticFunc(rhs._ckFunc);
                        logging.debug('' + this.nodeType + ' emitting static method call');
                    }
                    context.emitRegPushImm(8);
                    if (rhs._ckFunc.isMember) {
                        context.emitFuncCallMember();
                    } else {
                        context.emitFuncCallStatic();
                    }
                } else if (lType.isOfType(rType)) {
                    isArray = rhs.indices != null;
                    if (!isArray) {
                        logging.debug('ChuckOperator emitting OpAtChuck to assign one object to another');
                    } else {
                        logging.debug('ChuckOperator emitting OpAtChuck to assign an object to an array element');
                    }
                    return context.emitOpAtChuck(isArray);
                }
            };
            return _Class;
        }();
        module.UnchuckOperator = function () {
            function _Class() {
                this.emit = __bind(this.emit, this);
                this.check = __bind(this.check, this);
                this.name = 'UnchuckOperator';
            }
            _Class.prototype.check = function (lhs, rhs, context) {
                if (lhs.type.isOfType(types.UGen) && rhs.type.isOfType(types.UGen)) {
                    return rhs.type;
                }
            };
            _Class.prototype.emit = function (context, lhs, rhs) {
                if (lhs.type.isOfType(types.UGen) && rhs.type.isOfType(types.UGen)) {
                    context.emitUGenUnlink();
                }
            };
            return _Class;
        }();
        module.AtChuckOperator = AtChuckOperator = function () {
            function AtChuckOperator() {
                this.name = 'AtChuckOperator';
            }
            AtChuckOperator.prototype.check = function (lhs, rhs, context) {
                rhs._emitVar = true;
                return rhs.type;
            };
            AtChuckOperator.prototype.emit = function (context, lhs, rhs) {
                context.emitOpAtChuck();
            };
            return AtChuckOperator;
        }();
        module.PlusChuckOperator = PlusChuckOperator = function () {
            function PlusChuckOperator() {
                this.emit = __bind(this.emit, this);
                this.check = __bind(this.check, this);
                this.name = 'PlusChuckOperator';
            }
            PlusChuckOperator.prototype.check = function (lhs, rhs) {
                if (lhs.type === rhs.type || lhs.type === types.int && rhs.type === types.float) {
                    if (typesModule.isPrimitive(lhs.type) || lhs.type === types.String) {
                        if (rhs._meta === 'variable') {
                            rhs._emitVar = true;
                        }
                        return rhs.type;
                    }
                }
            };
            PlusChuckOperator.prototype.emit = function (context, lhs, rhs) {
                return context.emitPlusAssign(rhs.value.isContextGlobal);
            };
            return PlusChuckOperator;
        }();
        module.MinusChuckOperator = MinusChuckOperator = function () {
            function MinusChuckOperator() {
                this.emit = __bind(this.emit, this);
                this.check = __bind(this.check, this);
                this.name = 'MinusChuckOperator';
            }
            MinusChuckOperator.prototype.check = function (lhs, rhs, context) {
                if (lhs.type === rhs.type) {
                    if (typesModule.isPrimitive(lhs.type) || lhs.type === types.String) {
                        if (rhs._meta === 'variable') {
                            rhs._emitVar = true;
                        }
                        return rhs.type;
                    }
                }
            };
            MinusChuckOperator.prototype.emit = function (context, lhs, rhs) {
                return context.emitMinusAssign(rhs.value.isContextGlobal);
            };
            return MinusChuckOperator;
        }();
        AdditiveSubtractiveOperatorBase = function () {
            function AdditiveSubtractiveOperatorBase() {
                this.check = __bind(this.check, this);
            }
            AdditiveSubtractiveOperatorBase.prototype.check = function (lhs, rhs) {
                if (lhs.type === rhs.type) {
                    return lhs.type;
                }
                if (lhs.type === types.dur && rhs.type === types.Time || lhs.type === types.Time && rhs.type === types.dur) {
                    return types.Time;
                }
                if (lhs.type === types.int && rhs.type === types.int) {
                    return types.int;
                }
                if (lhs.type === types.float && rhs.type === types.float || lhs.type === types.int && rhs.type === types.float || lhs.type === types.float && rhs.type === types.int) {
                    return types.float;
                }
            };
            return AdditiveSubtractiveOperatorBase;
        }();
        module.PlusOperator = function (_super) {
            __extends(_Class, _super);
            function _Class() {
                this.emit = __bind(this.emit, this);
                this.name = 'PlusOperator';
            }
            _Class.prototype.emit = function (context, lhs, rhs) {
                logging.debug('PlusOperator emitting AddNumber');
                return context.emitAddNumber();
            };
            return _Class;
        }(AdditiveSubtractiveOperatorBase);
        PlusPlusOperatorBase = function () {
            function _Class(name) {
                this.check = __bind(this.check, this);
                this.name = name;
            }
            _Class.prototype.check = function (exp) {
                var type;
                exp._emitVar = true;
                type = exp.type;
                if (type === types.int || type === types.float) {
                    return type;
                } else {
                    return null;
                }
            };
            return _Class;
        }();
        module.PrefixPlusPlusOperator = function (_super) {
            __extends(_Class, _super);
            function _Class() {
                this.emit = __bind(this.emit, this);
                _Class.__super__.constructor.call(this, 'PrefixPlusPlusOperator');
            }
            _Class.prototype.emit = function (context, isGlobal) {
                logging.debug('' + this.name + ' emitting PreIncNumber');
                return context.emitPreIncNumber(isGlobal);
            };
            return _Class;
        }(PlusPlusOperatorBase);
        module.PostfixPlusPlusOperator = function (_super) {
            __extends(_Class, _super);
            function _Class() {
                this.emit = __bind(this.emit, this);
                _Class.__super__.constructor.call(this, 'PostfixPlusPlusOperator');
            }
            _Class.prototype.emit = function (context, isGlobal) {
                logging.debug('' + this.name + ' emitting PostIncNumber');
                return context.emitPostIncNumber(isGlobal);
            };
            return _Class;
        }(PlusPlusOperatorBase);
        module.MinusOperator = function (_super) {
            __extends(_Class, _super);
            function _Class() {
                this.emit = __bind(this.emit, this);
                this.name = 'MinusOperator';
            }
            _Class.prototype.emit = function (context, lhs, rhs) {
                logging.debug('' + this.name + ' emitting SubtractNumber');
                return context.emitSubtractNumber();
            };
            return _Class;
        }(AdditiveSubtractiveOperatorBase);
        module.MinusMinusOperator = function () {
            function _Class() {
                this.name = 'MinusMinusOperator';
            }
            return _Class;
        }();
        TimesDivideOperatorBase = function () {
            function TimesDivideOperatorBase() {
                this.check = __bind(this.check, this);
            }
            TimesDivideOperatorBase.prototype.check = function (lhs, rhs, context) {
                var lhsType, rhsType;
                lhsType = lhs.type;
                rhsType = rhs.type;
                if (lhs.type === types.int && rhs.type === types.float) {
                    lhsType = lhs.castTo = types.float;
                } else if (lhs.type === types.float && rhs.type === types.int) {
                    rhsType = rhs.castTo = types.float;
                }
                if (lhsType === types.float && rhsType === types.float) {
                    return types.float;
                }
                if (lhsType === types.int && rhsType === types.int) {
                    return types.int;
                }
            };
            return TimesDivideOperatorBase;
        }();
        module.TimesOperator = TimesOperator = function (_super) {
            __extends(TimesOperator, _super);
            function TimesOperator() {
                this.emit = __bind(this.emit, this);
                this.name = 'TimesOperator';
            }
            TimesOperator.prototype.emit = function (context) {
                return context.emitTimesNumber();
            };
            return TimesOperator;
        }(TimesDivideOperatorBase);
        module.DivideOperator = DivideOperator = function (_super) {
            __extends(DivideOperator, _super);
            function DivideOperator() {
                this.emit = __bind(this.emit, this);
                this.check = __bind(this.check, this);
                this.name = 'DivideOperator';
            }
            DivideOperator.prototype.check = function (lhs, rhs, context) {
                var type;
                logging.debug('' + this.name + ' scanPass4');
                type = DivideOperator.__super__.check.call(this, lhs, rhs, context);
                if (type != null) {
                    return type;
                }
                if (lhs.type === types.dur && rhs.type === types.dur || lhs.type === types.Time && rhs.type === types.dur) {
                    logging.debug('' + this.name + ' scanPass4: Deduced the type to be float');
                    return types.float;
                }
            };
            DivideOperator.prototype.emit = function (context) {
                return context.emitDivideNumber();
            };
            return DivideOperator;
        }(TimesDivideOperatorBase);
        GtLtOperatorBase = function () {
            function GtLtOperatorBase() {
                this.check = __bind(this.check, this);
            }
            GtLtOperatorBase.prototype.check = function (lhs, rhs) {
                if (lhs.type === rhs.type) {
                    return lhs.type;
                }
                if (lhs.type === types.Time && rhs.type === types.Time) {
                    return types.int;
                }
            };
            return GtLtOperatorBase;
        }();
        module.LtOperator = function (_super) {
            __extends(_Class, _super);
            function _Class() {
                this.emit = __bind(this.emit, this);
                this.name = 'LtOperator';
            }
            _Class.prototype.emit = function (context) {
                logging.debug('' + this.name + ': Emitting');
                return context.emitLtNumber();
            };
            return _Class;
        }(GtLtOperatorBase);
        module.GtOperator = function (_super) {
            __extends(_Class, _super);
            function _Class() {
                this.emit = __bind(this.emit, this);
                this.name = 'GtOperator';
            }
            _Class.prototype.emit = function (context) {
                logging.debug('' + this.name + ': Emitting');
                return context.emitGtNumber();
            };
            return _Class;
        }(GtLtOperatorBase);
        module.WhileStatement = function (_super) {
            __extends(_Class, _super);
            function _Class(cond, body) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                this.scanPass1 = __bind(this.scanPass1, this);
                _Class.__super__.constructor.call(this, 'WhileStatement');
                this.condition = cond;
                this.body = body;
            }
            _Class.prototype.scanPass1 = function () {
                this.condition.scanPass1();
                this.body.scanPass1();
            };
            _Class.prototype.scanPass2 = function (context) {
                this.condition.scanPass2(context);
                this.body.scanPass2(context);
            };
            _Class.prototype.scanPass3 = function (context) {
                this.condition.scanPass3(context);
                this.body.scanPass3(context);
            };
            _Class.prototype.scanPass4 = function (context) {
                logging.debug('WhileStatement: Type checking condition');
                this.condition.scanPass4(context);
                logging.debug('WhileStatement: Body');
                this.body.scanPass4(context);
            };
            _Class.prototype.scanPass5 = function (context) {
                var branchEq, breakJmp, startIndex;
                startIndex = context.getNextIndex();
                this.condition.scanPass5(context);
                context.emitRegPushImm(false);
                logging.debug('WhileStatement: Emitting BranchEq');
                branchEq = context.emitBranchEq();
                this.body.scanPass5(context);
                logging.debug('WhileStatement: Emitting GoTo (instruction number ' + startIndex + ')');
                context.emitGoto(startIndex);
                context.evaluateBreaks();
                breakJmp = context.getNextIndex();
                logging.debug('WhileStatement: Configuring BranchEq instruction to jump to instruction number ' + breakJmp);
                branchEq.jmp = breakJmp;
            };
            return _Class;
        }(NodeBase);
        module.ForStatement = function (_super) {
            __extends(_Class, _super);
            function _Class(c1, c2, c3, body) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                _Class.__super__.constructor.call(this, 'ForStatement');
                this.c1 = c1;
                this.c2 = c2;
                this.c3 = c3;
                this.body = body;
            }
            _Class.prototype.scanPass2 = function (context) {
                this.c1.scanPass2(context);
                this.c2.scanPass2(context);
                if (this.c3 != null) {
                    this.c3.scanPass2(context);
                }
                this.body.scanPass2(context);
            };
            _Class.prototype.scanPass3 = function (context) {
                logging.debug('' + this.nodeType);
                context.enterScope();
                this.c1.scanPass3(context);
                this.c2.scanPass3(context);
                if (this.c3 != null) {
                    this.c3.scanPass3(context);
                }
                this.body.scanPass3(context);
                context.exitScope();
            };
            _Class.prototype.scanPass4 = function (context) {
                logging.debug('' + this.nodeType);
                context.enterScope();
                logging.debug('' + this.nodeType + ': Checking the initial');
                this.c1.scanPass4(context);
                logging.debug('' + this.nodeType + ': Checking the condition');
                this.c2.scanPass4(context);
                if (this.c3 != null) {
                    logging.debug('' + this.nodeType + ': Checking the post');
                    this.c3.scanPass4(context);
                }
                logging.debug('' + this.nodeType + ': Checking the body');
                this.body.scanPass4(context);
                context.exitScope();
            };
            _Class.prototype.scanPass5 = function (context) {
                var branchEq, breakJmp, startIndex;
                context.enterCodeScope();
                logging.debug('' + this.nodeType + ': Emitting the initial');
                this.c1.scanPass5(context);
                startIndex = context.getNextIndex();
                logging.debug('' + this.nodeType + ': Emitting the condition');
                this.c2.scanPass5(context, { pop: false });
                context.emitRegPushImm(false);
                logging.debug('' + this.nodeType + ': Emitting BranchEq');
                branchEq = context.emitBranchEq();
                context.enterCodeScope();
                logging.debug('' + this.nodeType + ': Emitting the body');
                this.body.scanPass5(context);
                context.exitCodeScope();
                if (this.c3 != null) {
                    logging.debug('' + this.nodeType + ': Emitting the post');
                    this.c3.scanPass5(context);
                    context.emitPopWord();
                }
                logging.debug('ForStatement: Emitting GoTo (instruction number ' + startIndex + ')');
                context.emitGoto(startIndex);
                if (this.c2 != null) {
                    breakJmp = context.getNextIndex();
                    logging.debug('ForStatement: Configuring BranchEq instruction to jump to instruction number ' + breakJmp);
                    branchEq.jmp = breakJmp;
                }
                context.evaluateBreaks();
                context.exitCodeScope();
            };
            return _Class;
        }(NodeBase);
        module.CodeStatement = function (_super) {
            __extends(_Class, _super);
            function _Class(statementList) {
                _Class.__super__.constructor.call(this, statementList, 'CodeStatement');
            }
            return _Class;
        }(ParentNodeBase);
        module.BreakStatement = function (_super) {
            __extends(_Class, _super);
            function _Class() {
                _Class.__super__.constructor.call(this, 'BreakStatement');
            }
            _Class.prototype.scanPass5 = function (context) {
                context.emitBreak();
            };
            return _Class;
        }(NodeBase);
        module.DotMemberExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(base, id) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                this.scanPass2 = __bind(this.scanPass2, this);
                _Class.__super__.constructor.call(this, 'DotMemberExpression');
                this.base = base;
                this.id = id;
            }
            _Class.prototype.scanPass2 = function () {
                this.base.scanPass2();
            };
            _Class.prototype.scanPass3 = function () {
                this.base.scanPass3();
            };
            _Class.prototype.scanPass4 = function (context) {
                var baseType;
                logging.debug('' + this.nodeType + ' scanPass4');
                this.base.scanPass4(context);
                this.isStatic = this.base.type.actualType != null;
                if (this.isStatic) {
                    logging.debug('' + this.nodeType + ' scanPass4: This is a static member expression');
                }
                baseType = this.isStatic ? this.base.type.actualType : this.base.type;
                logging.debug('' + this.nodeType + ' scanPass4: Finding member \'' + this.id + '\' in base type ' + baseType.name);
                this.value = baseType.findValue(this.id);
                this.type = this.value.type;
                logging.debug('' + this.nodeType + ' scanPass4: Member type is ' + this.type.name);
                return this.type;
            };
            _Class.prototype.scanPass5 = function (context) {
                logging.debug('' + this.nodeType + ' scanPass5');
                if (!this.isStatic) {
                    logging.debug('' + this.nodeType + ' scanPass5: Emitting base expression');
                    this.base.scanPass5(context);
                }
            };
            return _Class;
        }(NodeBase);
        module.PostfixExpression = function (_super) {
            __extends(_Class, _super);
            function _Class(base, operator) {
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                _Class.__super__.constructor.call(this, 'PostfixExpression', 'variable');
                this.exp = base;
                this.op = operator;
            }
            _Class.prototype.scanPass4 = function (context) {
                this.exp.scanPass4(context);
                return this.type = this.op.check(this.exp);
            };
            _Class.prototype.scanPass5 = function (context) {
                this.exp.scanPass5(context);
                return this.op.emit(context, this.exp.value.isContextGlobal);
            };
            return _Class;
        }(NodeBase);
        module.ArraySub = function (_super) {
            __extends(_Class, _super);
            function _Class(exp) {
                this.getCount = __bind(this.getCount, this);
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                _Class.__super__.constructor.call(this, 'ArraySub');
                this.exp = exp;
            }
            _Class.prototype.scanPass4 = function (context) {
                logging.debug('' + this.nodeType + ' scanPass4');
                return this.exp.scanPass4(context);
            };
            _Class.prototype.scanPass5 = function (context) {
                logging.debug('' + this.nodeType + ': Emitting array indices');
                return this.exp.scanPass5(context);
            };
            _Class.prototype.getCount = function () {
                if (this.exp) {
                    return this.exp.getCount();
                } else {
                    return 0;
                }
            };
            return _Class;
        }(NodeBase);
        module.PrimaryArrayExpression = PrimaryArrayExpression = function (_super) {
            __extends(PrimaryArrayExpression, _super);
            function PrimaryArrayExpression(exp) {
                this.exp = exp;
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                PrimaryArrayExpression.__super__.constructor.call(this, 'PrimaryArrayExpression');
            }
            PrimaryArrayExpression.prototype.scanPass4 = function (context) {
                var type;
                logging.debug('' + this.nodeType + ' scanPass4');
                type = this.exp.scanPass4(context);
                return this.type = new typesModule.ChuckType(type.name, typesModule['@array']);
            };
            PrimaryArrayExpression.prototype.scanPass5 = function (context) {
                logging.debug('' + this.nodeType + ' scanPass5');
                this.exp.scanPass5(context);
                return context.emitArrayInit(this.exp.type, this.exp.getCount());
            };
            return PrimaryArrayExpression;
        }(NodeBase);
        module.FunctionDefinition = FunctionDefinition = function (_super) {
            __extends(FunctionDefinition, _super);
            function FunctionDefinition(funcDecl, staticDecl, typeDecl, name, args, code) {
                this.funcDecl = funcDecl;
                this.staticDecl = staticDecl;
                this.typeDecl = typeDecl;
                this.name = name;
                this.args = args;
                this.code = code;
                this.scanPass5 = __bind(this.scanPass5, this);
                this.scanPass4 = __bind(this.scanPass4, this);
                this.scanPass3 = __bind(this.scanPass3, this);
                FunctionDefinition.__super__.constructor.call(this, 'FunctionDefinition');
            }
            FunctionDefinition.prototype.scanPass2 = function (context) {
                var arg, i, _i, _len, _ref;
                logging.debug('' + this.nodeType + ' scanPass2');
                this.retType = context.findType(this.typeDecl.type);
                logging.debug('' + this.nodeType + ' scanPass3: Return type determined as ' + this.retType.name);
                _ref = this.args;
                for (i = _i = 0, _len = _ref.length; _i < _len; i = ++_i) {
                    arg = _ref[i];
                    arg.type = context.findType(arg.typeDecl.type);
                    logging.debug('' + this.nodeType + ' scanPass3: Type of argument ' + i + ' determined as ' + arg.type.name);
                }
                context.enterFunctionScope();
                this.code.scanPass2(context);
                context.exitFunctionScope();
            };
            FunctionDefinition.prototype.scanPass3 = function (context) {
                var arg, func, i, value, _i, _len, _ref;
                logging.debug('' + this.nodeType + ' scanPass3');
                func = context.addFunction(this);
                this._ckFunc = func;
                context.enterFunctionScope();
                _ref = this.args;
                for (i = _i = 0, _len = _ref.length; _i < _len; i = ++_i) {
                    arg = _ref[i];
                    logging.debug('' + this.nodeType + ': Creating value for argument ' + i + ' (' + arg.varDecl.name + ')');
                    value = context.createValue(arg.type, arg.varDecl.name);
                    value.offset = func.stackDepth;
                    arg.varDecl.value = value;
                }
                this.code.scanPass3(context);
                context.exitFunctionScope();
            };
            FunctionDefinition.prototype.scanPass4 = function (context) {
                var arg, i, value, _i, _len, _ref;
                logging.debug('' + this.nodeType + ' scanPass4');
                context.enterFunctionScope();
                _ref = this.args;
                for (i = _i = 0, _len = _ref.length; _i < _len; i = ++_i) {
                    arg = _ref[i];
                    value = arg.varDecl.value;
                    logging.debug('' + this.nodeType + ' scanPass4: Adding parameter ' + i + ' (' + value.name + ') to function\'s scope');
                    context.addValue(value);
                }
                this.code.scanPass4(context);
                context.exitFunctionScope();
            };
            FunctionDefinition.prototype.scanPass5 = function (context) {
                var arg, i, local, value, _i, _len, _ref;
                logging.debug('' + this.nodeType + ' emitting');
                local = context.allocateLocal(this._ckFunc.value.type, this._ckFunc.value, false);
                context.emitMemSetImm(local.offset, this._ckFunc, true);
                context.pushCode('' + this._ckFunc.name + '( ... )');
                context.enterCodeScope();
                _ref = this.args;
                for (i = _i = 0, _len = _ref.length; _i < _len; i = ++_i) {
                    arg = _ref[i];
                    value = arg.varDecl.value;
                    logging.debug('' + this.nodeType + ' scanPass5: Allocating local variable for parameter ' + i + ' (' + value.name + ')');
                    local = context.allocateLocal(value.type, value, false);
                    value.offset = local.offset;
                }
                this.code.scanPass5(context);
                context.exitCodeScope();
                context.emitFuncReturn();
                this._ckFunc.code = context.popCode();
            };
            return FunctionDefinition;
        }(NodeBase);
        module.Arg = Arg = function (_super) {
            __extends(Arg, _super);
            function Arg(typeDecl, varDecl) {
                this.typeDecl = typeDecl;
                this.varDecl = varDecl;
                Arg.__super__.constructor.call(this, 'Arg');
            }
            return Arg;
        }(NodeBase);
        return module;
    }(chuck_types, chuck_logging, chuck_audioContextService);
var chuck_parserService = function (lexer, nodes, logging) {
        var yy;
        yy = _.extend({}, nodes);
        yy.addLocationDataFn = function (first, last) {
            return function (obj) {
                return obj;
            };
        };
        return {
            parse: function (sourceCode) {
                var parser, tokens;
                parser = new ChuckParser();
                parser.yy = yy;
                parser.lexer = {
                    lex: function () {
                        var tag, token;
                        token = this.tokens[this.pos++];
                        if (token) {
                            tag = token[0], this.yytext = token[1], this.yylloc = token[2];
                            this.yylineno = this.yylloc.first_line;
                        } else {
                            tag = '';
                        }
                        return tag;
                    },
                    setInput: function (tokens) {
                        this.tokens = tokens;
                        return this.pos = 0;
                    },
                    upcomingInput: function () {
                        return '';
                    }
                };
                tokens = lexer.tokenize(sourceCode);
                logging.debug('Parsing tokens:', tokens);
                return parser.parse(tokens);
            }
        };
    }(chuck_lexer, chuck_nodes, chuck_logging);
var chuck_ugen = function (types, logging) {
        var module = {};
        function UGenChannel() {
            var self = this;
            self.current = 0;
            self.sources = [];
        }
        function uGenChannelTick(self, now) {
            var i, ugen, source;
            self.current = 0;
            if (self.sources.length === 0) {
                return self.current;
            }
            // Tick sources
            ugen = self.sources[0];
            ugen.tick(now);
            self.current = ugen.current;
            for (i = 1; i < self.sources.length; ++i) {
                source = self.sources[i];
                source.tick(now);
                self.current += source.current;
            }
            return self.current;
        }
        function uGenChannelAdd(self, source) {
            logging.debug('UGen channel: Adding source #' + self.sources.length);
            self.sources.push(source);
        }
        function uGenChannelRemove(self, source) {
            var idx = _.find(self.sources, function (src) {
                    return src === source;
                });
            logging.debug('UGen channel: Removing source #' + idx);
            self.sources.splice(idx, 1);
        }
        function uGenChannelStop(self) {
            self.sources.splice(0, self.sources.length);
        }
        module.UGen = function UGen(type) {
            var self = this, i;
            self.type = type;
            self.size = self.type.size;
            self.pmsg = self.type.ugenPmsg;
            self.numIns = self.type.ugenNumIns;
            self.numOuts = self.type.ugenNumOuts;
            self._channels = [];
            for (i = 0; i < self.numIns; ++i) {
                self._channels.push(new UGenChannel());
            }
            self._tick = type.ugenTick ? type.ugenTick : function (input) {
                return input;
            };
            self._now = -1;
            self._destList = [];
            self._gain = 1;
        };
        module.UGen.prototype.stop = function () {
            var self = this, i;
            for (i = 0; i < self._channels.length; ++i) {
                uGenChannelStop(self._channels[i]);
            }
            if (self._destList.length === 0) {
                return;
            }
            self._destList.splice(0, self._destList.length);
        };
        module.UGen.prototype.tick = function (now) {
            var self = this, sum = 0, i;
            if (self._now >= now) {
                return self.current;
            }
            self._now = now;
            // Tick inputs
            for (i = 0; i < self._channels.length; ++i) {
                sum += uGenChannelTick(self._channels[i], now);
            }
            sum /= self._channels.length;
            // Synthesize
            self.current = self._tick.call(self, sum) * self._gain;
            return self.current;
        };
        module.UGen.prototype.setGain = function (gain) {
            var self = this;
            self._gain = gain;
            return gain;
        };
        module.uGenAdd = function uGenAdd(self, src) {
            var i;
            for (i = 0; i < self._channels.length; ++i) {
                uGenChannelAdd(self._channels[i], src);
            }
            _uGenAddDest(src, self);
        };
        module.uGenRemove = function uGenRemove(self, src) {
            var i;
            for (i = 0; i < self._channels.length; ++i) {
                uGenChannelRemove(self._channels[i], src);
            }
            _ugenRemoveDest(src, self);
        };
        function _uGenAddDest(self, dest) {
            self._destList.push(dest);
        }
        function _ugenRemoveDest(self, dest) {
            var idx = _.find(self._destList, function (d) {
                    return d == dest;
                });
            logging.debug('UGen: Removing destination ' + idx);
            self._destList.splice(idx, 1);
        }
        module.Dac = function Dac() {
            var self = this;
            module.UGen.call(self, types.types.Dac);
        };
        module.Dac.prototype = Object.create(module.UGen.prototype);
        module.Dac.prototype.tick = function (now, frame) {
            var self = this, i;
            module.UGen.prototype.tick.call(self, now);
            for (i = 0; i < frame.length; ++i) {
                frame[i] = self._channels[i].current;
            }
        };
        return module;
    }(chuck_types, chuck_logging);
var __bind = function (fn, me) {
        return function () {
            return fn.apply(me, arguments);
        };
    }, __hasProp = {}.hasOwnProperty, __extends = function (child, parent) {
        for (var key in parent) {
            if (__hasProp.call(parent, key))
                child[key] = parent[key];
        }
        function ctor() {
            this.constructor = child;
        }
        ctor.prototype = parent.prototype;
        child.prototype = new ctor();
        child.__super__ = parent.prototype;
        return child;
    };
var chuck_instructions = function (ugen, logging, typesModule) {
        var Instruction, UnaryOpInstruction, callMethod, formatFloat, module, types, uGenAdd, uGenRemove, _this = this;
        module = {};
        types = typesModule.types;
        uGenAdd = ugen.uGenAdd, uGenRemove = ugen.uGenRemove;
        callMethod = function (vm) {
            var args, func, i, localDepth, retVal, stackDepth, thisObj;
            localDepth = vm.popFromReg();
            logging.debug('Popped local depth from stack: ' + localDepth);
            func = vm.popFromReg();
            logging.debug('Popped function from stack');
            stackDepth = func.stackDepth;
            args = [];
            i = 0;
            logging.debug('Popping ' + stackDepth + ' arguments from stack');
            while (i < stackDepth) {
                logging.debug('Popping argument ' + i + ' from stack');
                args.unshift(vm.popFromReg());
                ++i;
            }
            thisObj = void 0;
            if (func.isMember) {
                logging.debug('Function is a method, passing \'this\' to it');
                thisObj = args.pop();
            }
            retVal = func.apply(thisObj, args);
            if (func.retType !== types['void']) {
                logging.debug('Pushing return value ' + retVal + ' to stack');
                return vm.pushToReg(retVal);
            }
        };
        Instruction = function () {
            function Instruction(name, params, execute) {
                this.execute = __bind(this.execute, this);
                this.instructionName = name;
                _.extend(this, params);
                this._executeCb = execute;
            }
            Instruction.prototype.execute = function (vm) {
                if (!this._executeCb) {
                    return;
                }
                return this._executeCb.call(this, vm);
            };
            return Instruction;
        }();
        module.instantiateObject = function (type) {
            return new Instruction('InstantiateObject', { type: type }, function (vm) {
                var ug;
                logging.debug('Instantiating object of type ' + type.name);
                ug = new ugen.UGen(type);
                vm.addUgen(ug);
                return vm.pushToReg(ug);
            });
        };
        module.allocWord = function (offset, isGlobal) {
            return new Instruction('AllocWord', { offset: offset }, function (vm) {
                var scopeStr;
                vm.insertIntoMemory(this.offset, 0, isGlobal);
                scopeStr = isGlobal ? 'global' : 'function';
                logging.debug('Pushing memory stack index ' + this.offset + ' (scope: ' + scopeStr + ') to regular stack');
                return vm.pushToReg(this.offset);
            });
        };
        module.popWord = function () {
            return new Instruction('PopWord', void 0, function (vm) {
                logging.debug('Popping from regular stack');
                return vm.popFromReg();
            });
        };
        module.preConstructor = function (type, stackOffset) {
            return new Instruction('PreConstructor', {
                type: type,
                stackOffset: stackOffset
            }, function (vm) {
                logging.debug('Calling pre-constructor of ' + this.type.name);
                vm.pushToReg(vm.peekReg());
                this.type.preConstructor.isMember = true;
                this.type.preConstructor.stackDepth = 1;
                this.type.preConstructor.retType = types['void'];
                vm.pushToReg(this.type.preConstructor);
                vm.pushToReg(this.stackOffset);
                return callMethod(vm);
            });
        };
        module.assignObject = function (isArray, isGlobal) {
            if (isGlobal == null) {
                isGlobal = true;
            }
            return new Instruction('AssignObject', {}, function (vm) {
                var array, index, memStackIndex, obj, scopeStr;
                memStackIndex = vm.popFromReg();
                obj = vm.popFromReg();
                scopeStr = isGlobal ? 'global' : 'function';
                if (!isArray) {
                    logging.debug('' + this.instructionName + ': Assigning object to memory stack index ' + memStackIndex + '         (scope: ' + scopeStr + '):', obj);
                    vm.insertIntoMemory(memStackIndex, obj, isGlobal);
                } else {
                    array = memStackIndex[0], index = memStackIndex[1];
                    logging.debug('' + this.instructionName + ': Assigning object to array, index ' + index + ' (scope: ' + scopeStr + '):', obj);
                    array[index] = obj;
                }
                vm.pushToReg(obj);
            });
        };
        module.plusAssign = function (isGlobal) {
            return new Instruction('PlusAssign', {}, function (vm) {
                var lhs, memStackIndex, result, rhs;
                memStackIndex = vm.popFromReg();
                rhs = vm.popFromReg();
                lhs = vm.getFromMemory(memStackIndex, isGlobal);
                result = lhs + rhs;
                vm.insertIntoMemory(memStackIndex, result, isGlobal);
                vm.pushToReg(result);
            });
        };
        module.minusAssign = function (isGlobal) {
            return new Instruction('MinusAssign', {}, function (vm) {
                var lhs, memStackIndex, result, rhs;
                memStackIndex = vm.popFromReg();
                rhs = vm.popFromReg();
                lhs = vm.getFromMemory(memStackIndex, isGlobal);
                result = lhs - rhs;
                vm.insertIntoMemory(memStackIndex, result, isGlobal);
                vm.pushToReg(result);
            });
        };
        module.allocateArray = function (type) {
            return new Instruction('AllocateArray', {}, function (vm) {
                var array, i, sz, _i;
                sz = vm.popFromReg();
                logging.debug('' + this.instructionName + ': Allocating array of type ' + type.name + ' and of size ' + sz);
                array = new Array(sz);
                for (i = _i = 0; 0 <= sz ? _i < sz : _i > sz; i = 0 <= sz ? ++_i : --_i) {
                    array[i] = 0;
                }
                vm.pushToReg(array);
                if (typesModule.isObj(type.arrayType)) {
                    logging.debug('' + this.instructionName + ': Pushing index to stack');
                    vm.pushToReg(0);
                }
            });
        };
        module.dac = function () {
            return new Instruction('Dac', {}, function (vm) {
                vm.pushDac();
            });
        };
        module.releaseObject2 = function (offset, isGlobal) {
            return new Instruction('ReleaseObject2', { offset: offset }, function (vm) {
                vm.removeFromMemory(offset, isGlobal);
            });
        };
        module.eoc = function () {
            return new Instruction('Eoc');
        };
        module.uGenLink = function () {
            return new Instruction('UGenLink', {}, function (vm) {
                var dest, src;
                dest = vm.popFromReg();
                src = vm.popFromReg();
                logging.debug('UGenLink: Linking node of type ' + src.type.name + ' to node of type ' + dest.type.name);
                uGenAdd(dest, src);
                vm.pushToReg(dest);
            });
        };
        module.uGenUnlink = function () {
            return new Instruction('UGenUnlink', {}, function (vm) {
                var dest, src;
                dest = vm.popFromReg();
                src = vm.popFromReg();
                logging.debug('' + this.instructionName + ': Unlinking node of type ' + src.type.name + ' from node of type ' + dest.type.name);
                uGenRemove(dest, src);
                vm.pushToReg(dest);
            });
        };
        module.regPushImm = function (val) {
            return new Instruction('RegPushImm', { val: val }, function (vm) {
                logging.debug('RegPushImm: Pushing ' + val + ' to stack');
                vm.pushToReg(val);
            });
        };
        module.funcCallMember = function () {
            return new Instruction('FuncCallMember', {}, function (vm) {
                var func, localDepth;
                localDepth = vm.popFromReg();
                func = vm.popFromReg();
                vm.pushToReg(func);
                vm.pushToReg(localDepth);
                logging.debug('Calling instance method \'' + func.name + '\'');
                return callMethod(vm);
            });
        };
        module.funcCallStatic = function () {
            return new Instruction('FuncCallStatic', {}, function (vm) {
                var func, localDepth, stackDepth;
                localDepth = vm.popFromReg();
                logging.debug('Popped local depth from stack: ' + localDepth);
                func = vm.popFromReg();
                stackDepth = func.stackDepth;
                logging.debug('Calling static method \'' + func.name + '\'');
                vm.pushToReg(func);
                vm.pushToReg(localDepth);
                return callMethod(vm);
            });
        };
        module.funcCall = function () {
            return new Instruction('FuncCall', {}, function (vm) {
                var arg, args, func, i, localDepth, obj, stackDepth, _i, _j, _len;
                localDepth = vm.popFromReg();
                func = vm.popFromReg();
                stackDepth = func.stackDepth;
                logging.debug('' + this.instructionName + ': Calling function ' + func.name + ', with stackDepth ' + stackDepth);
                logging.debug('' + this.instructionName + ': Pushing current instructions to memory stack');
                vm.pushToMem(vm.instructions);
                logging.debug('' + this.instructionName + ': Pushing current instruction counter to memory stack');
                vm.pushToMem(vm._pc + 1);
                vm._nextPc = 0;
                vm.instructions = func.code.instructions;
                vm.enterFunctionScope();
                if (func.needThis) {
                    obj = vm.popFromReg();
                    vm.pushToMem(obj, false);
                    --stackDepth;
                }
                args = [];
                for (i = _i = 0; 0 <= stackDepth ? _i < stackDepth : _i > stackDepth; i = 0 <= stackDepth ? ++_i : --_i) {
                    arg = vm.popFromReg();
                    args.unshift(arg);
                }
                for (_j = 0, _len = args.length; _j < _len; _j++) {
                    arg = args[_j];
                    vm.pushToMem(arg, false);
                }
            });
        };
        module.funcReturn = function () {
            return new Instruction('FuncReturn', {}, function (vm) {
                var instructions, pc;
                logging.debug('' + this.instructionName + ': Returning from function');
                vm.exitFunctionScope();
                logging.debug('' + this.instructionName + ': Popping current instructions from memory stack');
                pc = vm.popFromMem(true);
                logging.debug('' + this.instructionName + ': Popping current instruction counter from memory stack');
                instructions = vm.popFromMem(true);
                vm._nextPc = pc;
                vm.instructions = instructions;
            });
        };
        module.regPushMemAddr = function (offset, isGlobal) {
            return new Instruction('RegPushMemAddr', {}, function (vm) {
                var globalStr;
                globalStr = isGlobal ? ' global' : '';
                logging.debug('' + this.instructionName + ': Pushing' + globalStr + ' memory address (@' + offset + ') to regular stack');
                vm.pushMemAddrToReg(offset, isGlobal);
            });
        };
        module.regPushMem = function (offset, isGlobal) {
            return new Instruction('RegPushMem', {}, function (vm) {
                var globalStr;
                globalStr = isGlobal ? ' global' : '';
                logging.debug('' + this.instructionName + ': Pushing' + globalStr + ' memory value (@' + offset + ') to regular stack');
                vm.pushToRegFromMem(offset, isGlobal);
            });
        };
        module.regDupLast = function () {
            return new Instruction('RegDupLast', {}, function (vm) {
                var last;
                last = vm.regStack[vm.regStack.length - 1];
                logging.debug('RegDupLast: Duplicating top of stack: ' + last);
                vm.regStack.push(last);
            });
        };
        module.dotMemberFunc = function (func) {
            return new Instruction('DotMemberFunc', {}, function (vm) {
                logging.debug('' + this.instructionName + ': Popping instance from stack');
                vm.popFromReg();
                logging.debug('' + this.instructionName + ': Pushing instance method to stack:', func);
                return vm.pushToReg(func);
            });
        };
        module.dotStaticFunc = function (func) {
            return new Instruction('DotStaticFunc', {}, function (vm) {
                logging.debug('DotStaticFunc: Pushing static method to stack:', func);
                vm.pushToReg(func);
            });
        };
        module.timesNumber = function () {
            return new Instruction('TimesNumber', {}, function (vm) {
                var lhs, number, rhs;
                lhs = vm.popFromReg();
                rhs = vm.popFromReg();
                number = lhs * rhs;
                logging.debug('TimesNumber resulted in: ' + number);
                vm.pushToReg(number);
            });
        };
        module.divideNumber = function () {
            return new Instruction('DivideNumber', {}, function (vm) {
                var lhs, number, rhs;
                rhs = vm.popFromReg();
                lhs = vm.popFromReg();
                number = lhs / rhs;
                logging.debug('DivideNumber (' + lhs + '/' + rhs + ') resulted in: ' + number);
                vm.pushToReg(number);
            });
        };
        module.regPushNow = function () {
            return new Instruction('RegPushNow', {}, function (vm) {
                vm.pushNow();
            });
        };
        module.regPushMe = function () {
            return new Instruction('RegPushMe', {}, function (vm) {
                vm.pushMe();
            });
        };
        module.addNumber = function () {
            return new Instruction('AddNumber', {}, function (vm) {
                var lhs, number, rhs;
                rhs = vm.popFromReg();
                lhs = vm.popFromReg();
                number = lhs + rhs;
                logging.debug('' + this.instructionName + ' resulted in: ' + number);
                vm.pushToReg(number);
            });
        };
        module.preIncNumber = function (isGlobal) {
            return new Instruction('PreIncnUmber', {}, function (vm) {
                var memStackIndex, val;
                memStackIndex = vm.popFromReg();
                val = vm.getFromMemory(memStackIndex, isGlobal);
                ++val;
                vm.insertIntoMemory(memStackIndex, val, isGlobal);
                vm.pushToReg(val);
            });
        };
        module.postIncNumber = function (isGlobal) {
            return new Instruction('PostIncnUmber', {}, function (vm) {
                var memStackIndex, val;
                memStackIndex = vm.popFromReg();
                val = vm.getFromMemory(memStackIndex, isGlobal);
                vm.pushToReg(val);
                ++val;
                vm.insertIntoMemory(memStackIndex, val, isGlobal);
            });
        };
        module.subtractNumber = function () {
            return new Instruction('SubtractNumber', {}, function (vm) {
                var lhs, number, rhs;
                rhs = vm.popFromReg();
                lhs = vm.popFromReg();
                number = lhs - rhs;
                logging.debug('' + this.instructionName + ': Subtracting ' + rhs + ' from ' + lhs + ' resulted in: ' + number);
                vm.pushToReg(number);
            });
        };
        module.timesNumber = function () {
            return new Instruction('TimesNumber', {}, function (vm) {
                var lhs, number, rhs;
                rhs = vm.popFromReg();
                lhs = vm.popFromReg();
                number = lhs * rhs;
                logging.debug('' + this.instructionName + ': Multiplying ' + lhs + ' with ' + rhs + ' resulted in: ' + number);
                vm.pushToReg(number);
            });
        };
        module.ltNumber = function () {
            return new Instruction('LtNumber', {}, function (vm) {
                var lhs, result, rhs;
                rhs = vm.popFromReg();
                lhs = vm.popFromReg();
                result = lhs < rhs;
                logging.debug('' + this.instructionName + ': Pushing ' + result + ' to regular stack');
                vm.pushToReg(result);
            });
        };
        module.gtNumber = function () {
            return new Instruction('GtNumber', {}, function (vm) {
                var lhs, result, rhs;
                rhs = vm.popFromReg();
                lhs = vm.popFromReg();
                result = lhs > rhs;
                logging.debug('' + this.instructionName + ': Pushing ' + result + ' to regular stack');
                vm.pushToReg(result);
            });
        };
        module.timeAdvance = function () {
            return new Instruction('TimeAdvance', {}, function (vm) {
                var time;
                time = vm.popFromReg();
                vm.suspendUntil(time);
                vm.pushToReg(time);
            });
        };
        formatFloat = function (value) {
            return value.toFixed(6);
        };
        module.gack = function (types) {
            return new Instruction('Gack', {}, function (vm) {
                var i, str, tp, value, values, _i, _j, _len, _ref;
                if (types.length === 1) {
                    module.hack(types[0]).execute(vm);
                    return;
                }
                values = [];
                for (i = _i = 0, _ref = types.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
                    values.unshift(vm.popFromReg());
                }
                str = '';
                for (i = _j = 0, _len = types.length; _j < _len; i = ++_j) {
                    tp = types[i];
                    value = values[i];
                    if (tp === types.float) {
                        str += '' + formatFloat(value) + ' ';
                    } else {
                        str += '' + value + ' ';
                    }
                    vm.pushToReg(value);
                }
                console.log(str.slice(0, str.length - 1));
            });
        };
        module.hack = function (type) {
            return new Instruction('Hack', {}, function (vm) {
                var arrStr, obj;
                obj = vm.peekReg();
                logging.debug('Printing object of type ' + type.name + ':', obj);
                if (_.isArray(obj)) {
                    arrStr = _.str.join(',', obj);
                    console.log('[' + arrStr + '] :(' + type.name + '[])');
                } else if (type === types.String) {
                    console.log('"' + obj + '" : (' + type.name + ')');
                } else if (type === types.float) {
                    console.log('' + formatFloat(obj) + ' :(' + type.name + ')');
                } else if (type === types.int) {
                    console.log('' + obj + ' :(' + type.name + ')');
                } else {
                    console.log('' + obj + ' : (' + type.name + ')');
                }
            });
        };
        module.branchEq = function (jmp) {
            return new Instruction('BranchEq', { jmp: jmp }, function (vm) {
                var lhs, result, rhs;
                rhs = vm.popFromReg();
                lhs = vm.popFromReg();
                result = lhs === rhs;
                logging.debug('Comparing ' + lhs + ' to ' + rhs + ': ' + result);
                if (result) {
                    logging.debug('Jumping to instruction number ' + this.jmp);
                    vm.jumpTo(this.jmp);
                } else {
                    logging.debug('Not jumping');
                }
            });
        };
        module.goto = function (jmp) {
            return new Instruction('Goto', { jmp: jmp }, function (vm) {
                logging.debug('Jumping to instruction number ' + this.jmp);
                vm.jumpTo(this.jmp);
            });
        };
        module.arrayAccess = function (type, emitAddr) {
            return new Instruction('ArrayAccess', {}, function (vm) {
                var array, idx, val, _ref;
                logging.debug('' + this.instructionName + ': Accessing array of type ' + type.name);
                _ref = [
                    vm.popFromReg(),
                    vm.popFromReg()
                ], idx = _ref[0], array = _ref[1];
                if (!emitAddr) {
                    val = array[idx];
                    logging.debug('Pushing array[' + idx + '] (' + val + ') to regular stack');
                    vm.pushToReg(val);
                } else {
                    logging.debug('Pushing array (' + array + ') and index (' + idx + ') to regular stack');
                    vm.pushToReg([
                        array,
                        idx
                    ]);
                }
            });
        };
        module.memSetImm = function (offset, value, isGlobal) {
            return new Instruction('MemSetImm', {}, function (vm) {
                var scopeStr;
                scopeStr = isGlobal ? 'global' : 'function';
                logging.debug('' + this.instructionName + ': Setting memory at offset ' + offset + ' (scope: ' + scopeStr + ') to:', value);
                return vm.insertIntoMemory(offset, value, isGlobal);
            });
        };
        UnaryOpInstruction = function (_super) {
            __extends(UnaryOpInstruction, _super);
            function UnaryOpInstruction(name, params, execute) {
                this.set = __bind(this.set, this);
                UnaryOpInstruction.__super__.constructor.call(this, name, params, execute);
                this._val = 0;
            }
            UnaryOpInstruction.prototype.set = function (val) {
                return this._val = val;
            };
            return UnaryOpInstruction;
        }(Instruction);
        module.preCtorArrayTop = function (type) {
            return new UnaryOpInstruction('PreCtorArrayTop', {}, function (vm) {
                var array, index;
                index = vm.peekReg();
                array = vm.peekReg(1);
                if (index >= array.length) {
                    logging.debug('' + this.instructionName + ': Finished instantiating elements');
                    return vm.jumpTo(this._val);
                } else {
                    logging.debug('' + this.instructionName + ': Instantiating element ' + index + ' of type ' + type.name);
                    return module.instantiateObject(type).execute(vm);
                }
            });
        };
        module.preCtorArrayBottom = function () {
            return new UnaryOpInstruction('PreCtorArrayBottom', {}, function (vm) {
                var array, index, obj;
                logging.debug('' + this.instructionName + ': Popping object and index from stack');
                obj = vm.popFromReg();
                index = vm.popFromReg();
                logging.debug('' + this.instructionName + ': Peeking array from stack');
                array = vm.peekReg();
                logging.debug('' + this.instructionName + ': Assigning to index ' + index + ' of array:', obj);
                array[index] = obj;
                logging.debug('' + this.instructionName + ': Pushing incremented index to stack');
                vm.pushToReg(index + 1);
                logging.debug('' + this.instructionName + ': Jumping to instruction ' + this._val);
                return vm.jumpTo(this._val);
            });
        };
        module.preCtorArrayPost = function () {
            return new Instruction('PreCtorArrayPost', {}, function (vm) {
                logging.debug('' + this.instructionName + ': Cleaning up, popping index from stack');
                return vm.popFromReg();
            });
        };
        module.arrayInit = function (type, count) {
            return new Instruction('ArrayInit', {}, function (vm) {
                var i, values, _i;
                logging.debug('' + this.instructionName + ': Popping ' + count + ' elements from stack');
                values = [];
                for (i = _i = 0; 0 <= count ? _i < count : _i > count; i = 0 <= count ? ++_i : --_i) {
                    values.unshift(vm.popFromReg());
                }
                logging.debug('' + this.instructionName + ': Pushing instantiated array to stack', values);
                return vm.pushToReg(values);
            });
        };
        return module;
    }(chuck_ugen, chuck_logging, chuck_types);
var chuck_libs_math = function (typesModule) {
        var ChuckStaticMethod, ChuckType, FuncArg, FunctionOverload, Object, float, int, mathNamespace, module, types, _ref;
        ChuckType = typesModule.ChuckType, ChuckStaticMethod = typesModule.ChuckStaticMethod, FuncArg = typesModule.FuncArg, FunctionOverload = typesModule.FunctionOverload;
        _ref = typesModule.types, Object = _ref.Object, float = _ref.float, int = _ref.int;
        module = {};
        types = module.types = {};
        mathNamespace = {
            pow: new ChuckStaticMethod('pow', [new FunctionOverload([
                    new FuncArg('x', float),
                    new FuncArg('y', float)
                ], function (x, y) {
                    return Math.pow(x, y);
                })], 'Math', float),
            random2: new ChuckStaticMethod('random2', [new FunctionOverload([
                    new FuncArg('min', int),
                    new FuncArg('max', int)
                ], function (min, max) {
                    return Math.floor(Math.random() * (max - min + 1)) + min;
                })], 'Math', int)
        };
        types.Math = new ChuckType('Math', Object, { namespace: mathNamespace });
        return module;
    }(chuck_types);
var chuck_libs_std = function (typesModule) {
        var ChuckStaticMethod, ChuckType, FuncArg, FunctionOverload, Object, float, int, module, stdNamespace, types, _ref;
        ChuckType = typesModule.ChuckType, ChuckStaticMethod = typesModule.ChuckStaticMethod, FuncArg = typesModule.FuncArg, FunctionOverload = typesModule.FunctionOverload;
        _ref = typesModule.types, Object = _ref.Object, float = _ref.float, int = _ref.int;
        module = {};
        types = module.types = {};
        stdNamespace = {
            mtof: new ChuckStaticMethod('mtof', [new FunctionOverload([new FuncArg('value', float)], function (value) {
                    return Math.pow(2, (value - 69) / 12) * 440;
                })], 'Std', float)
        };
        types.Std = new ChuckType('Std', Object, { namespace: stdNamespace });
        return module;
    }(chuck_types);
var chuck_libs_stk = function (typesModule, audioContextService) {
        var ChuckType = typesModule.ChuckType, ChuckMethod = typesModule.ChuckMethod, FuncArg = typesModule.FuncArg, FunctionOverload = typesModule.FunctionOverload, float = typesModule.types.float, int = typesModule.types.int, UGen = typesModule.types.UGen, Osc = typesModule.types.Osc, module = {}, types = module.types = {}, TwoPi = Math.PI * 2;
        function isPrime(number) {
            var i;
            if (number === 2) {
                return true;
            }
            if (number & 1) {
                for (i = 3; i < Math.sqrt(number) + 1; i += 2) {
                    if (number % i === 0)
                        return false;
                }
                return true;
            }
            return false;
        }
        function Delay(delay, max) {
            var self = this, i;
            // Writing before reading allows delays from 0 to length-1.
            // If we want to allow a delay of maxDelay, we need a
            // delay-line of length = maxDelay+1.
            self.length = max + 1;
            self.clear();
            self.inPoint = 0;
            if (delay > self.length - 1) {
                // The value is too big.
                // std::cerr << "[chuck](via STK): Delay: setDelay(" << theDelay << ") too big!" << std::endl;
                // Force delay to maxLength.
                self.outPoint = self.inPoint + 1;
                delay = self.length - 1;
            } else if (delay < 0) {
                // std::cerr << "[chuck](via STK): Delay: setDelay(" << theDelay << ") less than zero!" << std::endl;
                self.outPoint = self.inPoint;
                delay = 0;
            } else {
                self.outPoint = self.inPoint - delay;
            }
            self.delay = delay;
            while (self.outPoint < 0) {
                self.outPoint += self.length;
            }
        }
        Delay.prototype.clear = function () {
            var self = this;
            self.inputs = [];
            for (i = 0; i < self.length; ++i) {
                self.inputs.push(0);
            }
            self.output = 0;
        };
        Delay.prototype.tick = function (sample) {
            var self = this;
            self.inputs[self.inPoint++] = sample;
            // Check for end condition
            if (self.inPoint >= self.length) {
                self.inPoint = 0;
            }
            // Read out next value
            self.output = self.inputs[self.outPoint++];
            if (self.outPoint >= self.length) {
                self.outPoint = 0;
            }
            return self.output;
        };
        types.JcReverb = new ChuckType('JCRev', UGen, {
            preConstructor: function () {
                // Delay lengths for 44100 Hz sample rate.
                var lengths = [
                        1777,
                        1847,
                        1993,
                        2137,
                        389,
                        127,
                        43,
                        211,
                        179
                    ];
                var i, delay, sampleRate = audioContextService.getSampleRate(), scaler = sampleRate / 44100, d, t60 = 4;
                d = this.data = {
                    mix: 0.3,
                    allpassDelays: [],
                    combDelays: [],
                    combCoefficient: [],
                    allpassCoefficient: 0.7,
                    lastOutput: []
                };
                if (scaler !== 1) {
                    for (i = 0; i < 9; ++i) {
                        delay = Math.floor(scaler * lengths[i]);
                        if ((delay & 1) === 0) {
                            delay++;
                        }
                        while (!isPrime(delay)) {
                            delay += 2;
                        }
                        lengths[i] = delay;
                    }
                }
                for (i = 0; i < 3; i++) {
                    d.allpassDelays.push(new Delay(lengths[i + 4], lengths[i + 4]));
                }
                for (i = 0; i < 4; i++) {
                    d.combDelays.push(new Delay(lengths[i], lengths[i]));
                    d.combCoefficient.push(Math.pow(10, -3 * lengths[i] / (t60 * sampleRate)));
                }
                d.outLeftDelay = new Delay(lengths[7], lengths[7]);
                d.outRightDelay = new Delay(lengths[8], lengths[8]);
                [
                    d.allpassDelays,
                    d.combDelays,
                    [
                        d.outRightDelay,
                        d.outLeftDelay
                    ]
                ].forEach(function (e) {
                    e.forEach(function (delay) {
                        delay.clear();
                    });
                });
                d.lastOutput[0] = d.lastOutput[1] = 0;
            },
            namespace: {
                mix: new ChuckMethod('mix', [new FunctionOverload([new FuncArg('value', float)], function (value) {
                        this.data.mix = value;
                        return this.data.mix;
                    })], 'JCRev', float)
            },
            ugenTick: function (input) {
                var self = this, d = self.data, temp, temp0, temp1, temp2, temp3, temp4, temp5, temp6, filtout;
                temp = d.allpassDelays[0].output;
                temp0 = d.allpassCoefficient * temp;
                temp0 += input;
                d.allpassDelays[0].tick(temp0);
                temp0 = -(d.allpassCoefficient * temp0) + temp;
                temp = d.allpassDelays[1].output;
                temp1 = d.allpassCoefficient * temp;
                temp1 += temp0;
                d.allpassDelays[1].tick(temp1);
                temp1 = -(d.allpassCoefficient * temp1) + temp;
                temp = d.allpassDelays[2].output;
                temp2 = d.allpassCoefficient * temp;
                temp2 += temp1;
                d.allpassDelays[2].tick(temp2);
                temp2 = -(d.allpassCoefficient * temp2) + temp;
                temp3 = temp2 + d.combCoefficient[0] * d.combDelays[0].output;
                temp4 = temp2 + d.combCoefficient[1] * d.combDelays[1].output;
                temp5 = temp2 + d.combCoefficient[2] * d.combDelays[2].output;
                temp6 = temp2 + d.combCoefficient[3] * d.combDelays[3].output;
                d.combDelays[0].tick(temp3);
                d.combDelays[1].tick(temp4);
                d.combDelays[2].tick(temp5);
                d.combDelays[3].tick(temp6);
                filtout = temp3 + temp4 + temp5 + temp6;
                d.lastOutput[0] = d.mix * d.outLeftDelay.tick(filtout);
                d.lastOutput[1] = d.mix * d.outRightDelay.tick(filtout);
                temp = (1 - d.mix) * input;
                d.lastOutput[0] += temp;
                d.lastOutput[1] += temp;
                return (d.lastOutput[0] + d.lastOutput[1]) * 0.5;
            }
        });
        function blitSetFrequency(self, frequency) {
            var sampleRate = audioContextService.getSampleRate(), d = self.data;
            d.p = sampleRate / frequency;
            d.rate = Math.PI / d.p;
            d.phase = 0;
            blitUpdateHarmonics(self);
        }
        function blitUpdateHarmonics(self) {
            var d = self.data, maxHarmonics;
            if (d.nHarmonics <= 0) {
                maxHarmonics = Math.floor(0.5 * d.p);
                d.m = 2 * maxHarmonics + 1;
            } else
                d.m = 2 * d.nHarmonics + 1;
        }
        types.Blit = new ChuckType('Blit', Osc, {
            preConstructor: function () {
                var self = this, d = self.data;
                d.nHarmonics = 0;
                self.setFrequency = function (frequency) {
                    blitSetFrequency(self, frequency);
                    return frequency;
                };
                blitSetFrequency(self, 220);
            },
            namespace: {
                harmonics: new ChuckMethod('harmonics', [new FunctionOverload([new FuncArg('nHarmonics', int)], function (nHarmonics) {
                        this.data.nHarmonics = nHarmonics;
                        return this.data.nHarmonics;
                    })], 'Blit', int)
            },
            ugenTick: function () {
                var d = this.data, out, denominator;
                // The code below implements the SincM algorithm of Stilson and
                // Smith with an additional scale factor of P / M applied to
                // normalize the output.
                // A fully optimized version of this code would replace the two sin
                // calls with a pair of fast sin oscillators, for which stable fast
                // two-multiply algorithms are well known. In the spirit of STK,
                // which favors clarity over performance, the optimization has not
                // been made here.
                // Avoid a divide by zero at the sinc peak, which has a limiting
                // value of 1.0.
                denominator = Math.sin(d.phase);
                if (denominator <= Number.EPSILON) {
                    out = 1;
                } else {
                    out = Math.sin(d.m * d.phase);
                    out /= d.m * denominator;
                }
                d.phase += d.rate;
                if (d.phase >= Math.PI) {
                    d.phase -= Math.PI;
                }
                return out;
            }
        });
        return module;
    }(chuck_types, chuck_audioContextService);
var __bind = function (fn, me) {
        return function () {
            return fn.apply(me, arguments);
        };
    }, __hasProp = {}.hasOwnProperty;
var chuck_scanner = function (nodes, types, instructions, namespaceModule, logging, mathLib, stdLib, stkLib) {
        var ChuckCode, ChuckFrame, ChuckLocal, Scanner, ScanningContext, module;
        module = {};
        ChuckLocal = function () {
            function ChuckLocal(size, offset, name, isContextGlobal) {
                this.size = size;
                this.offset = offset;
                this.name = name;
                this.isContextGlobal = isContextGlobal;
            }
            return ChuckLocal;
        }();
        ChuckFrame = function () {
            function ChuckFrame() {
                this.currentOffset = 0;
                this.stack = [];
            }
            return ChuckFrame;
        }();
        ChuckCode = function () {
            function ChuckCode() {
                this.getNextIndex = __bind(this.getNextIndex, this);
                this.finish = __bind(this.finish, this);
                this.allocateLocal = __bind(this.allocateLocal, this);
                this.append = __bind(this.append, this);
                this.popScope = __bind(this.popScope, this);
                this.pushScope = __bind(this.pushScope, this);
                this.instructions = [];
                this.frame = new ChuckFrame();
                this.pushScope();
            }
            ChuckCode.prototype.pushScope = function () {
                this.frame.stack.push(null);
            };
            ChuckCode.prototype.popScope = function () {
                while (this.frame.stack.length > 0 && this.frame.stack[this.frame.stack.length - 1] != null) {
                    this.frame.stack.pop();
                    --this.frame.currentOffset;
                }
                this.frame.stack.pop();
                logging.debug('After popping scope, current stack offset is ' + this.frame.currentOffset);
            };
            ChuckCode.prototype.append = function (instruction) {
                this.instructions.push(instruction);
                return instruction;
            };
            ChuckCode.prototype.allocateLocal = function (type, value, isGlobal) {
                var local, scopeStr;
                local = new ChuckLocal(type.size, this.frame.currentOffset, value.name, isGlobal);
                scopeStr = this._isGlobal ? 'global' : 'function';
                logging.debug('Allocating local ' + value.name + ' of type ' + type.name + ' at offset ' + local.offset + ' (scope: ' + scopeStr + ')');
                this.frame.currentOffset += 1;
                this.frame.stack.push(local);
                value.offset = local.offset;
                return local;
            };
            ChuckCode.prototype.finish = function () {
                var local, locals, stack;
                stack = this.frame.stack;
                locals = [];
                while (stack.length > 0 && stack[stack.length - 1] != null) {
                    local = stack.pop();
                    if (local != null) {
                        this.frame.currentOffset -= local.size;
                        locals.push(local);
                    }
                }
                stack.pop();
                return locals;
            };
            ChuckCode.prototype.getNextIndex = function () {
                return this.instructions.length;
            };
            return ChuckCode;
        }();
        ScanningContext = function () {
            function ScanningContext() {
                this._nextIndex = __bind(this._nextIndex, this);
                this._emitPreConstructor = __bind(this._emitPreConstructor, this);
                this.getCurrentOffset = __bind(this.getCurrentOffset, this);
                this.addFunction = __bind(this.addFunction, this);
                this.finishScanning = __bind(this.finishScanning, this);
                this.evaluateBreaks = __bind(this.evaluateBreaks, this);
                this.emitFuncReturn = __bind(this.emitFuncReturn, this);
                this.emitMemSetImm = __bind(this.emitMemSetImm, this);
                this.emitArrayInit = __bind(this.emitArrayInit, this);
                this.emitArrayAccess = __bind(this.emitArrayAccess, this);
                this.emitBreak = __bind(this.emitBreak, this);
                this.emitGoto = __bind(this.emitGoto, this);
                this.emitBranchEq = __bind(this.emitBranchEq, this);
                this.emitGack = __bind(this.emitGack, this);
                this.emitOpAtChuck = __bind(this.emitOpAtChuck, this);
                this.emitTimeAdvance = __bind(this.emitTimeAdvance, this);
                this.emitGtNumber = __bind(this.emitGtNumber, this);
                this.emitLtNumber = __bind(this.emitLtNumber, this);
                this.emitTimesNumber = __bind(this.emitTimesNumber, this);
                this.emitSubtractNumber = __bind(this.emitSubtractNumber, this);
                this.emitPostIncNumber = __bind(this.emitPostIncNumber, this);
                this.emitPreIncNumber = __bind(this.emitPreIncNumber, this);
                this.emitAddNumber = __bind(this.emitAddNumber, this);
                this.emitRegPushMe = __bind(this.emitRegPushMe, this);
                this.emitRegPushNow = __bind(this.emitRegPushNow, this);
                this.emitDivideNumber = __bind(this.emitDivideNumber, this);
                this.emitTimesNumber = __bind(this.emitTimesNumber, this);
                this.emitDotMemberFunc = __bind(this.emitDotMemberFunc, this);
                this.emitDotStaticFunc = __bind(this.emitDotStaticFunc, this);
                this.emitRegDupLast = __bind(this.emitRegDupLast, this);
                this.emitRegPushMem = __bind(this.emitRegPushMem, this);
                this.emitRegPushMemAddr = __bind(this.emitRegPushMemAddr, this);
                this.emitFuncCall = __bind(this.emitFuncCall, this);
                this.emitFuncCallStatic = __bind(this.emitFuncCallStatic, this);
                this.emitFuncCallMember = __bind(this.emitFuncCallMember, this);
                this.emitRegPushImm = __bind(this.emitRegPushImm, this);
                this.emitPopWord = __bind(this.emitPopWord, this);
                this.emitUGenUnlink = __bind(this.emitUGenUnlink, this);
                this.emitUGenLink = __bind(this.emitUGenLink, this);
                this.emitDac = __bind(this.emitDac, this);
                this.emitMinusAssign = __bind(this.emitMinusAssign, this);
                this.emitPlusAssign = __bind(this.emitPlusAssign, this);
                this.emitAssignment = __bind(this.emitAssignment, this);
                this.exitCodeScope = __bind(this.exitCodeScope, this);
                this.enterCodeScope = __bind(this.enterCodeScope, this);
                this.exitScope = __bind(this.exitScope, this);
                this.enterScope = __bind(this.enterScope, this);
                this.getNextIndex = __bind(this.getNextIndex, this);
                this.allocateLocal = __bind(this.allocateLocal, this);
                this.instantiateObject = __bind(this.instantiateObject, this);
                this.pushToContStack = __bind(this.pushToContStack, this);
                this.pushToBreakStack = __bind(this.pushToBreakStack, this);
                this.createValue = __bind(this.createValue, this);
                this.addValue = __bind(this.addValue, this);
                this.addConstant = __bind(this.addConstant, this);
                this.addVariable = __bind(this.addVariable, this);
                this.findValue = __bind(this.findValue, this);
                this.findType = __bind(this.findType, this);
                this.exitFunctionScope = __bind(this.exitFunctionScope, this);
                this.enterFunctionScope = __bind(this.enterFunctionScope, this);
                this.popCode = __bind(this.popCode, this);
                this.pushCode = __bind(this.pushCode, this);
                var k, lib, type, typeType, _i, _len, _ref, _ref1;
                this.code = new ChuckCode();
                this._globalNamespace = new namespaceModule.Namespace('global');
                _ref = [
                    types,
                    mathLib,
                    stdLib,
                    stkLib
                ];
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    lib = _ref[_i];
                    _ref1 = lib.types;
                    for (k in _ref1) {
                        if (!__hasProp.call(_ref1, k))
                            continue;
                        type = _ref1[k];
                        this._globalNamespace.addType(type);
                        typeType = _.extend({}, types.Class);
                        typeType.actualType = type;
                        this._globalNamespace.addVariable(type.name, typeType, type);
                    }
                }
                this._globalNamespace.commit();
                this._namespaceStack = [this._globalNamespace];
                this._currentNamespace = this._globalNamespace;
                this._breakStack = [];
                this._contStack = [];
                this._codeStack = [];
                this._isGlobal = true;
                this._functionLevel = 0;
            }
            /**
            Replace code object while storing the old one on the stack.
            */
            ScanningContext.prototype.pushCode = function (name) {
                this.enterFunctionScope();
                logging.debug('Pushing code object');
                this._codeStack.push(this.code);
                this.code = new ChuckCode();
                this.code.name = name;
                return this.code;
            };
            /**
            Restore code object at the top of the stack.
            */
            ScanningContext.prototype.popCode = function () {
                var toReturn;
                logging.debug('Popping code object');
                toReturn = this.code;
                this.code = this._codeStack.pop();
                this._isGlobal = this._codeStack.length === 0;
                if (this._isGlobal) {
                    logging.debug('Back at global scope');
                }
                this.exitFunctionScope();
                return toReturn;
            };
            ScanningContext.prototype.enterFunctionScope = function () {
                ++this._functionLevel;
                this._isGlobal = false;
                this.enterScope();
            };
            ScanningContext.prototype.exitFunctionScope = function () {
                this.exitScope();
                --this._functionLevel;
                this._isGlobal = this._functionLevel <= 0;
            };
            ScanningContext.prototype.findType = function (typeName) {
                var type;
                type = this._currentNamespace.findType(typeName);
                return type;
            };
            ScanningContext.prototype.findValue = function (name, climb) {
                var val;
                if (climb == null) {
                    climb = false;
                }
                val = this._currentNamespace.findValue(name, climb);
                if (val != null) {
                    return val;
                }
                return val = this._currentNamespace.findValue(name, true);
            };
            ScanningContext.prototype.addVariable = function (name, type) {
                return this._currentNamespace.addVariable(name, type, null, this._isGlobal);
            };
            ScanningContext.prototype.addConstant = function (name, type, value) {
                var scopeStr;
                scopeStr = this._isGlobal ? 'global' : 'function';
                logging.debug('Adding constant ' + name + ' (scope: ' + scopeStr + ')');
                return this._currentNamespace.addConstant(name, type, value, this._isGlobal);
            };
            ScanningContext.prototype.addValue = function (value, name) {
                var scopeStr;
                scopeStr = this._isGlobal ? 'global' : 'function';
                logging.debug('Adding value ' + name + ' (scope: ' + scopeStr + ')');
                return this._currentNamespace.addValue(value, name, this._isGlobal);
            };
            ScanningContext.prototype.createValue = function (type, name) {
                return new namespaceModule.ChuckValue(type, name, this._currentNamespace, this._isGlobal);
            };
            ScanningContext.prototype.pushToBreakStack = function (statement) {
                return this._breakStack.push(statement);
            };
            ScanningContext.prototype.pushToContStack = function (statement) {
                return this._contStack.push(statement);
            };
            ScanningContext.prototype.instantiateObject = function (type) {
                logging.debug('Emitting instantiation of object of type ' + type.name + ' along with preconstructor');
                this.code.append(instructions.instantiateObject(type));
                return this._emitPreConstructor(type);
            };
            ScanningContext.prototype.allocateLocal = function (type, value, emit) {
                var local, scopeStr;
                if (emit == null) {
                    emit = true;
                }
                scopeStr = this._isGlobal ? 'global' : 'function';
                logging.debug('Allocating local (scope: ' + scopeStr + ')');
                local = this.code.allocateLocal(type, value, this._isGlobal);
                if (emit) {
                    logging.debug('Emitting AllocWord instruction');
                    this.code.append(instructions.allocWord(local.offset, this._isGlobal));
                }
                return local;
            };
            ScanningContext.prototype.getNextIndex = function () {
                return this.code.getNextIndex();
            };
            ScanningContext.prototype.enterScope = function () {
                return this._currentNamespace.enterScope();
            };
            ScanningContext.prototype.exitScope = function () {
                return this._currentNamespace.exitScope();
            };
            ScanningContext.prototype.enterCodeScope = function () {
                logging.debug('Entering nested code scope');
                this.code.pushScope();
            };
            ScanningContext.prototype.exitCodeScope = function () {
                logging.debug('Exiting nested code scope');
                this.code.popScope();
            };
            ScanningContext.prototype.emitAssignment = function (type, varDecl) {
                var array, bottom, elemType, isObj, startIndex, top, value;
                value = varDecl.value, array = varDecl.array;
                if (array != null) {
                    logging.debug('Emitting array indices');
                    array.scanPass5(this);
                    logging.debug('Emitting AllocateArray');
                    this.code.append(instructions.allocateArray(type));
                    elemType = type.arrayType;
                    if (types.isObj(elemType)) {
                        startIndex = this._nextIndex();
                        logging.debug('Emitting PreCtorArrayTop');
                        top = this.code.append(instructions.preCtorArrayTop(elemType));
                        this._emitPreConstructor(elemType);
                        logging.debug('Emitting PreCtorArrayBottom');
                        bottom = this.code.append(instructions.preCtorArrayBottom(elemType));
                        top.set(this._nextIndex());
                        bottom.set(startIndex);
                        this.code.append(instructions.preCtorArrayPost());
                    }
                }
                isObj = types.isObj(type) || array != null;
                if (isObj && array == null && !type.isRef) {
                    this.instantiateObject(type);
                }
                this.allocateLocal(type, value);
                if (isObj && !type.isRef) {
                    logging.debug('Emitting AssignObject');
                    this.code.append(instructions.assignObject(false, this._isGlobal));
                }
            };
            ScanningContext.prototype.emitPlusAssign = function (isGlobal) {
                this.code.append(instructions.plusAssign(isGlobal));
            };
            ScanningContext.prototype.emitMinusAssign = function (isGlobal) {
                this.code.append(instructions.minusAssign(isGlobal));
            };
            ScanningContext.prototype.emitDac = function () {
                this.code.append(instructions.dac());
            };
            ScanningContext.prototype.emitUGenLink = function () {
                this.code.append(instructions.uGenLink());
            };
            ScanningContext.prototype.emitUGenUnlink = function () {
                this.code.append(instructions.uGenUnlink());
            };
            ScanningContext.prototype.emitPopWord = function () {
                this.code.append(instructions.popWord());
            };
            ScanningContext.prototype.emitRegPushImm = function (value) {
                this.code.append(instructions.regPushImm(value));
            };
            ScanningContext.prototype.emitFuncCallMember = function () {
                this.code.append(instructions.funcCallMember());
            };
            ScanningContext.prototype.emitFuncCallStatic = function () {
                this.code.append(instructions.funcCallStatic());
            };
            ScanningContext.prototype.emitFuncCall = function () {
                return this.code.append(instructions.funcCall());
            };
            ScanningContext.prototype.emitRegPushMemAddr = function (offset, isGlobal) {
                this.code.append(instructions.regPushMemAddr(offset, isGlobal));
            };
            ScanningContext.prototype.emitRegPushMem = function (offset, isGlobal) {
                this.code.append(instructions.regPushMem(offset, isGlobal));
            };
            ScanningContext.prototype.emitRegDupLast = function () {
                this.code.append(instructions.regDupLast());
            };
            ScanningContext.prototype.emitDotStaticFunc = function (func) {
                this.code.append(instructions.dotStaticFunc(func));
            };
            ScanningContext.prototype.emitDotMemberFunc = function (func) {
                this.code.append(instructions.dotMemberFunc(func));
            };
            ScanningContext.prototype.emitTimesNumber = function () {
                this.code.append(instructions.timesNumber());
            };
            ScanningContext.prototype.emitDivideNumber = function () {
                this.code.append(instructions.divideNumber());
            };
            ScanningContext.prototype.emitRegPushNow = function () {
                this.code.append(instructions.regPushNow());
            };
            ScanningContext.prototype.emitRegPushMe = function () {
                this.code.append(instructions.regPushMe());
            };
            ScanningContext.prototype.emitAddNumber = function () {
                this.code.append(instructions.addNumber());
            };
            ScanningContext.prototype.emitPreIncNumber = function (isGlobal) {
                return this.code.append(instructions.preIncNumber(isGlobal));
            };
            ScanningContext.prototype.emitPostIncNumber = function (isGlobal) {
                return this.code.append(instructions.postIncNumber(isGlobal));
            };
            ScanningContext.prototype.emitSubtractNumber = function () {
                this.code.append(instructions.subtractNumber());
            };
            ScanningContext.prototype.emitTimesNumber = function () {
                return this.code.append(instructions.timesNumber());
            };
            ScanningContext.prototype.emitLtNumber = function () {
                this.code.append(instructions.ltNumber());
            };
            ScanningContext.prototype.emitGtNumber = function () {
                this.code.append(instructions.gtNumber());
            };
            ScanningContext.prototype.emitTimeAdvance = function () {
                this.code.append(instructions.timeAdvance());
            };
            ScanningContext.prototype.emitOpAtChuck = function (isArray) {
                if (isArray == null) {
                    isArray = false;
                }
                logging.debug('Emitting AssignObject (isArray: ' + isArray + ')');
                this.code.append(instructions.assignObject(isArray, this._isGlobal));
            };
            ScanningContext.prototype.emitGack = function (types) {
                this.code.append(instructions.gack(types));
            };
            ScanningContext.prototype.emitBranchEq = function (jmp) {
                return this.code.append(instructions.branchEq(jmp));
            };
            ScanningContext.prototype.emitGoto = function (jmp) {
                return this.code.append(instructions.goto(jmp));
            };
            ScanningContext.prototype.emitBreak = function () {
                var instr;
                instr = instructions.goto();
                this.code.append(instr);
                return this._breakStack.push(instr);
            };
            ScanningContext.prototype.emitArrayAccess = function (type, emitAddr) {
                return this.code.append(instructions.arrayAccess(type, emitAddr));
            };
            ScanningContext.prototype.emitArrayInit = function (type, count) {
                return this.code.append(instructions.arrayInit(type, count));
            };
            ScanningContext.prototype.emitMemSetImm = function (offset, value, isGlobal) {
                return this.code.append(instructions.memSetImm(offset, value, isGlobal));
            };
            ScanningContext.prototype.emitFuncReturn = function () {
                return this.code.append(instructions.funcReturn());
            };
            ScanningContext.prototype.evaluateBreaks = function () {
                var instr;
                while (this._breakStack.length) {
                    instr = this._breakStack.pop();
                    instr.jmp = this._nextIndex();
                }
            };
            ScanningContext.prototype.finishScanning = function () {
                var local, locals, _i, _len;
                locals = this.code.finish();
                for (_i = 0, _len = locals.length; _i < _len; _i++) {
                    local = locals[_i];
                    this.code.append(instructions.releaseObject2(local.offset, local.isContextGlobal));
                }
                this.code.append(instructions.eoc());
            };
            ScanningContext.prototype.addFunction = function (funcDef) {
                var arg, args, func, funcArg, funcGroup, name, type, value, _i, _len, _ref;
                value = this.findValue(funcDef.name);
                if (value != null) {
                    funcGroup = value.value;
                    logging.debug('Found corresponding function group ' + funcDef.name);
                } else {
                    logging.debug('Creating function group ' + funcDef.name);
                    type = new types.ChuckType('[function]', types.types.Function);
                    funcGroup = new types.ChuckFunction(funcDef.name, [], funcDef.retType);
                    type.func = funcGroup;
                    funcGroup.value = this.addConstant(funcGroup.name, type, funcGroup);
                }
                name = '' + funcDef.name + '@' + funcGroup.getNumberOfOverloads() + '@' + (this._currentNamespace.name || '');
                logging.debug('Adding function ' + name);
                args = [];
                _ref = funcDef.args;
                for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                    arg = _ref[_i];
                    funcArg = new types.FuncArg(arg.varDecl.name, types.types[arg.typeDecl.type]);
                    logging.debug('Adding function argument ' + funcArg.name + ' of type ' + funcArg.type.name);
                    args.push(funcArg);
                }
                func = new types.FunctionOverload(args, null, false, name);
                funcGroup.addOverload(func);
                func.value = this.addConstant(name, funcGroup.value.type, func);
                return func;
            };
            ScanningContext.prototype.getCurrentOffset = function () {
                return this.code.frame.currentOffset;
            };
            ScanningContext.prototype._emitPreConstructor = function (type) {
                if (type.parent != null) {
                    this._emitPreConstructor(type.parent);
                }
                if (type.hasConstructor) {
                    this.code.append(instructions.preConstructor(type, this.getCurrentOffset()));
                }
            };
            ScanningContext.prototype._nextIndex = function () {
                return this.code.instructions.length;
            };
            return ScanningContext;
        }();
        Scanner = function () {
            function Scanner(ast) {
                this._pass = __bind(this._pass, this);
                this.pass5 = __bind(this.pass5, this);
                this.pass4 = __bind(this.pass4, this);
                this.pass3 = __bind(this.pass3, this);
                this.pass2 = __bind(this.pass2, this);
                this.pass1 = __bind(this.pass1, this);
                this._ast = ast;
                this._context = new ScanningContext();
            }
            Scanner.prototype.pass1 = function () {
                return this._pass(1);
            };
            Scanner.prototype.pass2 = function () {
                return this._pass(2);
            };
            Scanner.prototype.pass3 = function () {
                return this._pass(3);
            };
            Scanner.prototype.pass4 = function () {
                return this._pass(4);
            };
            Scanner.prototype.pass5 = function () {
                this._pass(5);
                this._context.finishScanning();
                return this.byteCode = this._context.code.instructions;
            };
            Scanner.prototype._pass = function (num) {
                var program;
                program = this._ast;
                return program['scanPass' + num](this._context);
            };
            return Scanner;
        }();
        module.scan = function (ast) {
            var scanner;
            scanner = new Scanner(ast);
            logging.debug('Scan pass 1');
            scanner.pass1();
            logging.debug('Scan pass 2');
            scanner.pass2();
            logging.debug('Scan pass 3');
            scanner.pass3();
            logging.debug('Scan pass 4');
            scanner.pass4();
            logging.debug('Scan pass 5');
            scanner.pass5();
            return scanner.byteCode;
        };
        return module;
    }(chuck_nodes, chuck_types, chuck_instructions, chuck_namespace, chuck_logging, chuck_libs_math, chuck_libs_std, chuck_libs_stk);
var __bind = function (fn, me) {
    return function () {
        return fn.apply(me, arguments);
    };
};
var chuck_vm = function (logging, ugen, types, audioContextService) {
        var Shred, Vm, module;
        module = {};
        Shred = function () {
            function Shred(args) {
                this.args = args || [];
            }
            return Shred;
        }();
        module.Vm = Vm = function () {
            function Vm(args) {
                this._processAudio = __bind(this._processAudio, this);
                this._isRunning = __bind(this._isRunning, this);
                this._getMemStack = __bind(this._getMemStack, this);
                this._terminateProcessing = __bind(this._terminateProcessing, this);
                this.exitFunctionScope = __bind(this.exitFunctionScope, this);
                this.enterFunctionScope = __bind(this.enterFunctionScope, this);
                this.jumpTo = __bind(this.jumpTo, this);
                this.suspendUntil = __bind(this.suspendUntil, this);
                this.pushMe = __bind(this.pushMe, this);
                this.pushNow = __bind(this.pushNow, this);
                this.pushDac = __bind(this.pushDac, this);
                this.popFromMem = __bind(this.popFromMem, this);
                this.pushToMem = __bind(this.pushToMem, this);
                this.getFromMemory = __bind(this.getFromMemory, this);
                this.removeFromMemory = __bind(this.removeFromMemory, this);
                this.insertIntoMemory = __bind(this.insertIntoMemory, this);
                this.peekReg = __bind(this.peekReg, this);
                this.popFromReg = __bind(this.popFromReg, this);
                this.pushToRegFromMem = __bind(this.pushToRegFromMem, this);
                this.pushMemAddrToReg = __bind(this.pushMemAddrToReg, this);
                this.pushToReg = __bind(this.pushToReg, this);
                this.addUgen = __bind(this.addUgen, this);
                this._compute = __bind(this._compute, this);
                this.stop = __bind(this.stop, this);
                this.execute = __bind(this.execute, this);
                this.regStack = [];
                this.memStack = [];
                this._funcMemStacks = [];
                this.isExecuting = false;
                this._ugens = [];
                this._dac = new ugen.Dac();
                this._wakeTime = void 0;
                this._pc = 0;
                this._nextPc = 1;
                this._shouldStop = false;
                this._now = 0;
                this._me = new Shred(args);
                this._nowSystem = 0;
                this._gain = 1;
            }
            Vm.prototype.execute = function (byteCode) {
                var deferred, _this = this;
                this._pc = 0;
                this.isExecuting = true;
                this.instructions = byteCode;
                deferred = Q.defer();
                setTimeout(function () {
                    if (!_this._compute(deferred)) {
                        logging.debug('Ending VM execution');
                        _this._terminateProcessing();
                        deferred.resolve();
                        return;
                    }
                    logging.debug('Starting audio processing');
                    _this._scriptProcessor = audioContextService.createScriptProcessor();
                    return _this._scriptProcessor.onaudioprocess = function (event) {
                        var error;
                        try {
                            _this._processAudio(event, deferred);
                        } catch (_error) {
                            error = _error;
                            _this._terminateProcessing();
                            deferred.reject('Caught exception in audio processing callback after ' + _this._nowSystem + ' samples: ' + error);
                        }
                    };
                }, 0);
                return deferred.promise;
            };
            Vm.prototype.stop = function () {
                logging.debug('Stopping VM');
                this._shouldStop = true;
            };
            Vm.prototype._compute = function (deferred) {
                var err, instr, sampleRate;
                try {
                    if (this._pc === 0) {
                        logging.debug('VM executing');
                    } else {
                        logging.debug('Resuming VM execution');
                    }
                    while (this._pc < this.instructions.length && this._isRunning()) {
                        instr = this.instructions[this._pc];
                        logging.debug('Executing instruction no. ' + this._pc + ': ' + instr.instructionName);
                        instr.execute(this);
                        this._pc = this._nextPc;
                        ++this._nextPc;
                    }
                    if (this._wakeTime != null && !this._shouldStop) {
                        sampleRate = audioContextService.getSampleRate();
                        logging.debug('Halting VM execution for ' + (this._wakeTime - this._now) / sampleRate + ' second(s)');
                        return true;
                    } else {
                        logging.debug('VM execution has ended after ' + this._nowSystem + ' samples:', this._shouldStop);
                        this._shouldStop = true;
                        return false;
                    }
                } catch (_error) {
                    err = _error;
                    deferred.reject(err);
                    throw err;
                }
            };
            Vm.prototype.addUgen = function (ugen) {
                this._ugens.push(ugen);
            };
            Vm.prototype.pushToReg = function (value) {
                if (value == null) {
                    throw new Error('pushToReg: value is undefined');
                }
                this.regStack.push(value);
            };
            Vm.prototype.pushMemAddrToReg = function (offset, isGlobal) {
                var scopeStr, value;
                value = this._getMemStack(isGlobal)[offset];
                scopeStr = isGlobal ? 'global' : 'function';
                logging.debug('Pushing memory stack address ' + offset + ' (scope: ' + scopeStr + ') to regular stack:', value);
                return this.regStack.push(offset);
            };
            Vm.prototype.pushToRegFromMem = function (offset, isGlobal) {
                var scopeStr, value;
                value = this._getMemStack(isGlobal)[offset];
                scopeStr = isGlobal ? 'global' : 'function';
                logging.debug('Pushing memory stack value @' + offset + ' (scope: ' + scopeStr + ') to regular stack:', value);
                return this.regStack.push(value);
            };
            Vm.prototype.popFromReg = function () {
                var val;
                val = this.regStack.pop();
                if (val == null) {
                    throw new Error('Nothing on the stack');
                }
                return val;
            };
            Vm.prototype.peekReg = function (offset) {
                if (offset == null) {
                    offset = 0;
                }
                return this.regStack[this.regStack.length - (1 + offset)];
            };
            Vm.prototype.insertIntoMemory = function (index, value, isGlobal) {
                var scopeStr;
                scopeStr = isGlobal ? 'global' : 'function';
                logging.debug('Inserting value ' + value + ' (' + typeof value + ') into memory stack at index ' + index + ' (scope: ' + scopeStr + ')');
                this._getMemStack(isGlobal)[index] = value;
            };
            Vm.prototype.removeFromMemory = function (index, isGlobal) {
                logging.debug('Removing element ' + index + ' of memory stack');
                this._getMemStack(isGlobal).splice(index, 1);
            };
            Vm.prototype.getFromMemory = function (index, isGlobal) {
                var memStack, scopeStr, val;
                memStack = this._getMemStack(isGlobal);
                val = memStack[index];
                scopeStr = isGlobal ? 'global' : 'function';
                logging.debug('Getting value from memory stack at index ' + index + ' (scope: ' + scopeStr + '):', val);
                return val;
            };
            Vm.prototype.pushToMem = function (value, isGlobal) {
                var memStack;
                if (isGlobal == null) {
                    isGlobal = true;
                }
                if (value == null) {
                    throw new Error('pushToMem: value is undefined');
                }
                memStack = this._getMemStack(isGlobal);
                if (isGlobal) {
                    logging.debug('Pushing value to global memory stack:', value);
                } else {
                    logging.debug('Pushing value to function memory stack:', value);
                }
                return memStack.push(value);
            };
            Vm.prototype.popFromMem = function (isGlobal) {
                return this._getMemStack(isGlobal).pop();
            };
            Vm.prototype.pushDac = function () {
                this.regStack.push(this._dac);
            };
            Vm.prototype.pushNow = function () {
                logging.debug('Pushing now (' + this._now + ') to stack');
                this.regStack.push(this._now);
            };
            Vm.prototype.pushMe = function () {
                logging.debug('Pushing me to stack:', this._me);
                this.regStack.push(this._me);
            };
            Vm.prototype.suspendUntil = function (time) {
                logging.debug('Suspending VM execution until ' + time + ' (now: ' + this._now + ')');
                this._wakeTime = time;
            };
            Vm.prototype.jumpTo = function (jmp) {
                this._nextPc = jmp;
            };
            Vm.prototype.enterFunctionScope = function () {
                logging.debug('Entering new function scope');
                return this._funcMemStacks.push([]);
            };
            Vm.prototype.exitFunctionScope = function () {
                logging.debug('Exiting current function scope');
                return this._funcMemStacks.pop();
            };
            Vm.prototype._terminateProcessing = function () {
                logging.debug('Terminating processing');
                this._dac.stop();
                if (this._scriptProcessor != null) {
                    this._scriptProcessor.disconnect(0);
                    this._scriptProcessor = void 0;
                }
                return this.isExecuting = false;
            };
            /** Get the memory stack for the requested scope (global/function)
            */
            Vm.prototype._getMemStack = function (isGlobal) {
                if (isGlobal == null) {
                    throw new Error('isGlobal must be specified');
                }
                if (isGlobal) {
                    return this.memStack;
                } else {
                    return this._funcMemStacks[this._funcMemStacks.length - 1];
                }
            };
            Vm.prototype._isRunning = function () {
                return this._wakeTime == null && !this._shouldStop;
            };
            Vm.prototype._processAudio = function (event, deferred) {
                var frame, i, samplesLeft, samplesRight, _i, _j, _ref, _ref1;
                samplesLeft = event.outputBuffer.getChannelData(0);
                samplesRight = event.outputBuffer.getChannelData(1);
                if (this._shouldStop) {
                    logging.debug('Audio callback finishing execution after processing ' + this._nowSystem + ' samples');
                    for (i = _i = 0, _ref = event.outputBuffer.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
                        samplesLeft[i] = 0;
                        samplesRight[i] = 0;
                    }
                    this._terminateProcessing();
                    deferred.resolve();
                    return;
                }
                logging.debug('Audio callback processing ' + event.outputBuffer.length + ' samples');
                for (i = _j = 0, _ref1 = event.outputBuffer.length; 0 <= _ref1 ? _j < _ref1 : _j > _ref1; i = 0 <= _ref1 ? ++_j : --_j) {
                    if (this._wakeTime <= this._nowSystem + 0.5) {
                        this._now = this._wakeTime;
                        this._wakeTime = void 0;
                        logging.debug('Letting VM compute sample, now: ' + this._now);
                        this._compute(deferred);
                    }
                    ++this._nowSystem;
                    frame = [
                        0,
                        0
                    ];
                    if (!this._shouldStop) {
                        this._dac.tick(this._nowSystem, frame);
                    }
                    samplesLeft[i] = frame[0] * this._gain;
                    samplesRight[i] = frame[1] * this._gain;
                }
                if (this._shouldStop) {
                    logging.debug('Audio callback: In the process of stopping, flushing buffers');
                }
                logging.debug('Audio callback finished processing, currently at ' + this._nowSystem + ' samples in total');
            };
            return Vm;
        }();
        return module;
    }(chuck_logging, chuck_ugen, chuck_types, chuck_audioContextService);
var __bind = function (fn, me) {
    return function () {
        return fn.apply(me, arguments);
    };
};
var chuck = function (parserService, scanner, vmModule, logging, audioContextService) {
        var module;
        module = {};
        module.Chuck = function () {
            function _Class(audioContext, audioDestination) {
                this.audioContext = audioContext;
                this.audioDestination = audioDestination;
                this.isExecuting = __bind(this.isExecuting, this);
                this.stop = __bind(this.stop, this);
                this.execute = __bind(this.execute, this);
            }
            _Class.prototype.execute = function (sourceCode, args) {
                var ast, byteCode;
                audioContextService.prepareForExecution(this.audioContext, this.audioDestination);
                ast = parserService.parse(sourceCode);
                byteCode = scanner.scan(ast);
                this._vm = new vmModule.Vm(args);
                return this._vm.execute(byteCode);
            };
            _Class.prototype.stop = function () {
                var deferred;
                if (!this.isExecuting()) {
                    deferred = Q.defer();
                    deferred.resolve();
                    deferred.promise;
                }
                this._vm.stop();
                return audioContextService.stopOperation();
            };
            _Class.prototype.isExecuting = function () {
                if (this._vm == null) {
                    return;
                }
                return this._vm.isExecuting;
            };
            return _Class;
        }();
        module.setLogger = function (logger) {
            return logging.setLogger(logger);
        };
        return module;
    }(chuck_parserService, chuck_scanner, chuck_vm, chuck_logging, chuck_audioContextService);
(function () {
    /** Used as a safe reference for `undefined` in pre ES5 environments */
    var undefined;
    /** Used to pool arrays and objects used internally */
    var arrayPool = [], objectPool = [];
    /** Used to generate unique IDs */
    var idCounter = 0;
    /** Used internally to indicate various things */
    var indicatorObject = {};
    /** Used to prefix keys to avoid issues with `__proto__` and properties on `Object.prototype` */
    var keyPrefix = +new Date() + '';
    /** Used as the size when optimizations are enabled for large arrays */
    var largeArraySize = 75;
    /** Used as the max size of the `arrayPool` and `objectPool` */
    var maxPoolSize = 40;
    /** Used to detect and test whitespace */
    var whitespace = // whitespace
        ' \t\x0B\f\xA0\uFEFF' + // line terminators
        '\n\r\u2028\u2029' + // unicode category "Zs" space separators
        '\u1680\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000';
    /** Used to match empty string literals in compiled template source */
    var reEmptyStringLeading = /\b__p \+= '';/g, reEmptyStringMiddle = /\b(__p \+=) '' \+/g, reEmptyStringTrailing = /(__e\(.*?\)|\b__t\)) \+\n'';/g;
    /**
     * Used to match ES6 template delimiters
     * http://people.mozilla.org/~jorendorff/es6-draft.html#sec-7.8.6
     */
    var reEsTemplate = /\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;
    /** Used to match regexp flags from their coerced string values */
    var reFlags = /\w*$/;
    /** Used to detected named functions */
    var reFuncName = /^\s*function[ \n\r\t]+\w/;
    /** Used to match "interpolate" template delimiters */
    var reInterpolate = /<%=([\s\S]+?)%>/g;
    /** Used to match leading whitespace and zeros to be removed */
    var reLeadingSpacesAndZeros = RegExp('^[' + whitespace + ']*0+(?=.$)');
    /** Used to ensure capturing order of template delimiters */
    var reNoMatch = /($^)/;
    /** Used to detect functions containing a `this` reference */
    var reThis = /\bthis\b/;
    /** Used to match unescaped characters in compiled string literals */
    var reUnescapedString = /['\n\r\t\u2028\u2029\\]/g;
    /** Used to assign default `context` object properties */
    var contextProps = [
            'Array',
            'Boolean',
            'Date',
            'Error',
            'Function',
            'Math',
            'Number',
            'Object',
            'RegExp',
            'String',
            '_',
            'attachEvent',
            'clearTimeout',
            'isFinite',
            'isNaN',
            'parseInt',
            'setImmediate',
            'setTimeout'
        ];
    /** Used to fix the JScript [[DontEnum]] bug */
    var shadowedProps = [
            'constructor',
            'hasOwnProperty',
            'isPrototypeOf',
            'propertyIsEnumerable',
            'toLocaleString',
            'toString',
            'valueOf'
        ];
    /** Used to make template sourceURLs easier to identify */
    var templateCounter = 0;
    /** `Object#toString` result shortcuts */
    var argsClass = '[object Arguments]', arrayClass = '[object Array]', boolClass = '[object Boolean]', dateClass = '[object Date]', errorClass = '[object Error]', funcClass = '[object Function]', numberClass = '[object Number]', objectClass = '[object Object]', regexpClass = '[object RegExp]', stringClass = '[object String]';
    /** Used to identify object classifications that `_.clone` supports */
    var cloneableClasses = {};
    cloneableClasses[funcClass] = false;
    cloneableClasses[argsClass] = cloneableClasses[arrayClass] = cloneableClasses[boolClass] = cloneableClasses[dateClass] = cloneableClasses[numberClass] = cloneableClasses[objectClass] = cloneableClasses[regexpClass] = cloneableClasses[stringClass] = true;
    /** Used as an internal `_.debounce` options object */
    var debounceOptions = {
            'leading': false,
            'maxWait': 0,
            'trailing': false
        };
    /** Used as the property descriptor for `__bindData__` */
    var descriptor = {
            'configurable': false,
            'enumerable': false,
            'value': null,
            'writable': false
        };
    /** Used as the data object for `iteratorTemplate` */
    var iteratorData = {
            'args': '',
            'array': null,
            'bottom': '',
            'firstArg': '',
            'init': '',
            'keys': null,
            'loop': '',
            'shadowedProps': null,
            'support': null,
            'top': '',
            'useHas': false
        };
    /** Used to determine if values are of the language type Object */
    var objectTypes = {
            'boolean': false,
            'function': true,
            'object': true,
            'number': false,
            'string': false,
            'undefined': false
        };
    /** Used to escape characters for inclusion in compiled string literals */
    var stringEscapes = {
            '\\': '\\',
            '\'': '\'',
            '\n': 'n',
            '\r': 'r',
            '\t': 't',
            '\u2028': 'u2028',
            '\u2029': 'u2029'
        };
    /** Used as a reference to the global object */
    var root = objectTypes[typeof window] && window || this;
    /** Detect free variable `exports` */
    var freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports;
    /** Detect free variable `module` */
    var freeModule = objectTypes[typeof module] && module && !module.nodeType && module;
    /** Detect the popular CommonJS extension `module.exports` */
    var moduleExports = freeModule && freeModule.exports === freeExports && freeExports;
    /** Detect free variable `global` from Node.js or Browserified code and use it as `root` */
    var freeGlobal = objectTypes[typeof global] && global;
    if (freeGlobal && (freeGlobal.global === freeGlobal || freeGlobal.window === freeGlobal)) {
        root = freeGlobal;
    }
    /*--------------------------------------------------------------------------*/
    /**
     * The base implementation of `_.indexOf` without support for binary searches
     * or `fromIndex` constraints.
     *
     * @private
     * @param {Array} array The array to search.
     * @param {*} value The value to search for.
     * @param {number} [fromIndex=0] The index to search from.
     * @returns {number} Returns the index of the matched value or `-1`.
     */
    function baseIndexOf(array, value, fromIndex) {
        var index = (fromIndex || 0) - 1, length = array ? array.length : 0;
        while (++index < length) {
            if (array[index] === value) {
                return index;
            }
        }
        return -1;
    }
    /**
     * An implementation of `_.contains` for cache objects that mimics the return
     * signature of `_.indexOf` by returning `0` if the value is found, else `-1`.
     *
     * @private
     * @param {Object} cache The cache object to inspect.
     * @param {*} value The value to search for.
     * @returns {number} Returns `0` if `value` is found, else `-1`.
     */
    function cacheIndexOf(cache, value) {
        var type = typeof value;
        cache = cache.cache;
        if (type == 'boolean' || value == null) {
            return cache[value] ? 0 : -1;
        }
        if (type != 'number' && type != 'string') {
            type = 'object';
        }
        var key = type == 'number' ? value : keyPrefix + value;
        cache = (cache = cache[type]) && cache[key];
        return type == 'object' ? cache && baseIndexOf(cache, value) > -1 ? 0 : -1 : cache ? 0 : -1;
    }
    /**
     * Adds a given value to the corresponding cache object.
     *
     * @private
     * @param {*} value The value to add to the cache.
     */
    function cachePush(value) {
        var cache = this.cache, type = typeof value;
        if (type == 'boolean' || value == null) {
            cache[value] = true;
        } else {
            if (type != 'number' && type != 'string') {
                type = 'object';
            }
            var key = type == 'number' ? value : keyPrefix + value, typeCache = cache[type] || (cache[type] = {});
            if (type == 'object') {
                (typeCache[key] || (typeCache[key] = [])).push(value);
            } else {
                typeCache[key] = true;
            }
        }
    }
    /**
     * Used by `_.max` and `_.min` as the default callback when a given
     * collection is a string value.
     *
     * @private
     * @param {string} value The character to inspect.
     * @returns {number} Returns the code unit of given character.
     */
    function charAtCallback(value) {
        return value.charCodeAt(0);
    }
    /**
     * Used by `sortBy` to compare transformed `collection` elements, stable sorting
     * them in ascending order.
     *
     * @private
     * @param {Object} a The object to compare to `b`.
     * @param {Object} b The object to compare to `a`.
     * @returns {number} Returns the sort order indicator of `1` or `-1`.
     */
    function compareAscending(a, b) {
        var ac = a.criteria, bc = b.criteria;
        // ensure a stable sort in V8 and other engines
        // http://code.google.com/p/v8/issues/detail?id=90
        if (ac !== bc) {
            if (ac > bc || typeof ac == 'undefined') {
                return 1;
            }
            if (ac < bc || typeof bc == 'undefined') {
                return -1;
            }
        }
        // The JS engine embedded in Adobe applications like InDesign has a buggy
        // `Array#sort` implementation that causes it, under certain circumstances,
        // to return the same value for `a` and `b`.
        // See https://github.com/jashkenas/underscore/pull/1247
        return a.index - b.index;
    }
    /**
     * Creates a cache object to optimize linear searches of large arrays.
     *
     * @private
     * @param {Array} [array=[]] The array to search.
     * @returns {null|Object} Returns the cache object or `null` if caching should not be used.
     */
    function createCache(array) {
        var index = -1, length = array.length, first = array[0], mid = array[length / 2 | 0], last = array[length - 1];
        if (first && typeof first == 'object' && mid && typeof mid == 'object' && last && typeof last == 'object') {
            return false;
        }
        var cache = getObject();
        cache['false'] = cache['null'] = cache['true'] = cache['undefined'] = false;
        var result = getObject();
        result.array = array;
        result.cache = cache;
        result.push = cachePush;
        while (++index < length) {
            result.push(array[index]);
        }
        return result;
    }
    /**
     * Used by `template` to escape characters for inclusion in compiled
     * string literals.
     *
     * @private
     * @param {string} match The matched character to escape.
     * @returns {string} Returns the escaped character.
     */
    function escapeStringChar(match) {
        return '\\' + stringEscapes[match];
    }
    /**
     * Gets an array from the array pool or creates a new one if the pool is empty.
     *
     * @private
     * @returns {Array} The array from the pool.
     */
    function getArray() {
        return arrayPool.pop() || [];
    }
    /**
     * Gets an object from the object pool or creates a new one if the pool is empty.
     *
     * @private
     * @returns {Object} The object from the pool.
     */
    function getObject() {
        return objectPool.pop() || {
            'array': null,
            'cache': null,
            'criteria': null,
            'false': false,
            'index': 0,
            'null': false,
            'number': null,
            'object': null,
            'push': null,
            'string': null,
            'true': false,
            'undefined': false,
            'value': null
        };
    }
    /**
     * Checks if `value` is a DOM node in IE < 9.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if the `value` is a DOM node, else `false`.
     */
    function isNode(value) {
        // IE < 9 presents DOM nodes as `Object` objects except they have `toString`
        // methods that are `typeof` "string" and still can coerce nodes to strings
        return typeof value.toString != 'function' && typeof (value + '') == 'string';
    }
    /**
     * Releases the given array back to the array pool.
     *
     * @private
     * @param {Array} [array] The array to release.
     */
    function releaseArray(array) {
        array.length = 0;
        if (arrayPool.length < maxPoolSize) {
            arrayPool.push(array);
        }
    }
    /**
     * Releases the given object back to the object pool.
     *
     * @private
     * @param {Object} [object] The object to release.
     */
    function releaseObject(object) {
        var cache = object.cache;
        if (cache) {
            releaseObject(cache);
        }
        object.array = object.cache = object.criteria = object.object = object.number = object.string = object.value = null;
        if (objectPool.length < maxPoolSize) {
            objectPool.push(object);
        }
    }
    /**
     * Slices the `collection` from the `start` index up to, but not including,
     * the `end` index.
     *
     * Note: This function is used instead of `Array#slice` to support node lists
     * in IE < 9 and to ensure dense arrays are returned.
     *
     * @private
     * @param {Array|Object|string} collection The collection to slice.
     * @param {number} start The start index.
     * @param {number} end The end index.
     * @returns {Array} Returns the new array.
     */
    function slice(array, start, end) {
        start || (start = 0);
        if (typeof end == 'undefined') {
            end = array ? array.length : 0;
        }
        var index = -1, length = end - start || 0, result = Array(length < 0 ? 0 : length);
        while (++index < length) {
            result[index] = array[start + index];
        }
        return result;
    }
    /*--------------------------------------------------------------------------*/
    /**
     * Create a new `lodash` function using the given context object.
     *
     * @static
     * @memberOf _
     * @category Utilities
     * @param {Object} [context=root] The context object.
     * @returns {Function} Returns the `lodash` function.
     */
    function runInContext(context) {
        // Avoid issues with some ES3 environments that attempt to use values, named
        // after built-in constructors like `Object`, for the creation of literals.
        // ES5 clears this up by stating that literals must use built-in constructors.
        // See http://es5.github.io/#x11.1.5.
        context = context ? _.defaults(root.Object(), context, _.pick(root, contextProps)) : root;
        /** Native constructor references */
        var Array = context.Array, Boolean = context.Boolean, Date = context.Date, Error = context.Error, Function = context.Function, Math = context.Math, Number = context.Number, Object = context.Object, RegExp = context.RegExp, String = context.String, TypeError = context.TypeError;
        /**
         * Used for `Array` method references.
         *
         * Normally `Array.prototype` would suffice, however, using an array literal
         * avoids issues in Narwhal.
         */
        var arrayRef = [];
        /** Used for native method references */
        var errorProto = Error.prototype, objectProto = Object.prototype, stringProto = String.prototype;
        /** Used to restore the original `_` reference in `noConflict` */
        var oldDash = context._;
        /** Used to resolve the internal [[Class]] of values */
        var toString = objectProto.toString;
        /** Used to detect if a method is native */
        var reNative = RegExp('^' + String(toString).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/toString| for [^\]]+/g, '.*?') + '$');
        /** Native method shortcuts */
        var ceil = Math.ceil, clearTimeout = context.clearTimeout, floor = Math.floor, fnToString = Function.prototype.toString, getPrototypeOf = reNative.test(getPrototypeOf = Object.getPrototypeOf) && getPrototypeOf, hasOwnProperty = objectProto.hasOwnProperty, now = reNative.test(now = Date.now) && now || function () {
                return +new Date();
            }, push = arrayRef.push, propertyIsEnumerable = objectProto.propertyIsEnumerable, setTimeout = context.setTimeout, splice = arrayRef.splice, unshift = arrayRef.unshift;
        /** Used to detect `setImmediate` in Node.js */
        var setImmediate = typeof (setImmediate = freeGlobal && moduleExports && freeGlobal.setImmediate) == 'function' && !reNative.test(setImmediate) && setImmediate;
        /** Used to set meta data on functions */
        var defineProperty = function () {
                // IE 8 only accepts DOM elements
                try {
                    var o = {}, func = reNative.test(func = Object.defineProperty) && func, result = func(o, o, o) && func;
                } catch (e) {
                }
                return result;
            }();
        /* Native method shortcuts for methods with the same name as other `lodash` methods */
        var nativeCreate = reNative.test(nativeCreate = Object.create) && nativeCreate, nativeIsArray = reNative.test(nativeIsArray = Array.isArray) && nativeIsArray, nativeIsFinite = context.isFinite, nativeIsNaN = context.isNaN, nativeKeys = reNative.test(nativeKeys = Object.keys) && nativeKeys, nativeMax = Math.max, nativeMin = Math.min, nativeParseInt = context.parseInt, nativeRandom = Math.random;
        /** Used to lookup a built-in constructor by [[Class]] */
        var ctorByClass = {};
        ctorByClass[arrayClass] = Array;
        ctorByClass[boolClass] = Boolean;
        ctorByClass[dateClass] = Date;
        ctorByClass[funcClass] = Function;
        ctorByClass[objectClass] = Object;
        ctorByClass[numberClass] = Number;
        ctorByClass[regexpClass] = RegExp;
        ctorByClass[stringClass] = String;
        /** Used to avoid iterating non-enumerable properties in IE < 9 */
        var nonEnumProps = {};
        nonEnumProps[arrayClass] = nonEnumProps[dateClass] = nonEnumProps[numberClass] = {
            'constructor': true,
            'toLocaleString': true,
            'toString': true,
            'valueOf': true
        };
        nonEnumProps[boolClass] = nonEnumProps[stringClass] = {
            'constructor': true,
            'toString': true,
            'valueOf': true
        };
        nonEnumProps[errorClass] = nonEnumProps[funcClass] = nonEnumProps[regexpClass] = {
            'constructor': true,
            'toString': true
        };
        nonEnumProps[objectClass] = { 'constructor': true };
        (function () {
            var length = shadowedProps.length;
            while (length--) {
                var key = shadowedProps[length];
                for (var className in nonEnumProps) {
                    if (hasOwnProperty.call(nonEnumProps, className) && !hasOwnProperty.call(nonEnumProps[className], key)) {
                        nonEnumProps[className][key] = false;
                    }
                }
            }
        }());
        /*--------------------------------------------------------------------------*/
        /**
         * Creates a `lodash` object which wraps the given value to enable intuitive
         * method chaining.
         *
         * In addition to Lo-Dash methods, wrappers also have the following `Array` methods:
         * `concat`, `join`, `pop`, `push`, `reverse`, `shift`, `slice`, `sort`, `splice`,
         * and `unshift`
         *
         * Chaining is supported in custom builds as long as the `value` method is
         * implicitly or explicitly included in the build.
         *
         * The chainable wrapper functions are:
         * `after`, `assign`, `bind`, `bindAll`, `bindKey`, `chain`, `compact`,
         * `compose`, `concat`, `countBy`, `create`, `createCallback`, `curry`,
         * `debounce`, `defaults`, `defer`, `delay`, `difference`, `filter`, `flatten`,
         * `forEach`, `forEachRight`, `forIn`, `forInRight`, `forOwn`, `forOwnRight`,
         * `functions`, `groupBy`, `indexBy`, `initial`, `intersection`, `invert`,
         * `invoke`, `keys`, `map`, `max`, `memoize`, `merge`, `min`, `object`, `omit`,
         * `once`, `pairs`, `partial`, `partialRight`, `pick`, `pluck`, `pull`, `push`,
         * `range`, `reject`, `remove`, `rest`, `reverse`, `shuffle`, `slice`, `sort`,
         * `sortBy`, `splice`, `tap`, `throttle`, `times`, `toArray`, `transform`,
         * `union`, `uniq`, `unshift`, `unzip`, `values`, `where`, `without`, `wrap`,
         * and `zip`
         *
         * The non-chainable wrapper functions are:
         * `clone`, `cloneDeep`, `contains`, `escape`, `every`, `find`, `findIndex`,
         * `findKey`, `findLast`, `findLastIndex`, `findLastKey`, `has`, `identity`,
         * `indexOf`, `isArguments`, `isArray`, `isBoolean`, `isDate`, `isElement`,
         * `isEmpty`, `isEqual`, `isFinite`, `isFunction`, `isNaN`, `isNull`, `isNumber`,
         * `isObject`, `isPlainObject`, `isRegExp`, `isString`, `isUndefined`, `join`,
         * `lastIndexOf`, `mixin`, `noConflict`, `parseInt`, `pop`, `random`, `reduce`,
         * `reduceRight`, `result`, `shift`, `size`, `some`, `sortedIndex`, `runInContext`,
         * `template`, `unescape`, `uniqueId`, and `value`
         *
         * The wrapper functions `first` and `last` return wrapped values when `n` is
         * provided, otherwise they return unwrapped values.
         *
         * Explicit chaining can be enabled by using the `_.chain` method.
         *
         * @name _
         * @constructor
         * @category Chaining
         * @param {*} value The value to wrap in a `lodash` instance.
         * @returns {Object} Returns a `lodash` instance.
         * @example
         *
         * var wrapped = _([1, 2, 3]);
         *
         * // returns an unwrapped value
         * wrapped.reduce(function(sum, num) {
         *   return sum + num;
         * });
         * // => 6
         *
         * // returns a wrapped value
         * var squares = wrapped.map(function(num) {
         *   return num * num;
         * });
         *
         * _.isArray(squares);
         * // => false
         *
         * _.isArray(squares.value());
         * // => true
         */
        function lodash(value) {
            // don't wrap if already wrapped, even if wrapped by a different `lodash` constructor
            return value && typeof value == 'object' && !isArray(value) && hasOwnProperty.call(value, '__wrapped__') ? value : new lodashWrapper(value);
        }
        /**
         * A fast path for creating `lodash` wrapper objects.
         *
         * @private
         * @param {*} value The value to wrap in a `lodash` instance.
         * @param {boolean} chainAll A flag to enable chaining for all methods
         * @returns {Object} Returns a `lodash` instance.
         */
        function lodashWrapper(value, chainAll) {
            this.__chain__ = !!chainAll;
            this.__wrapped__ = value;
        }
        // ensure `new lodashWrapper` is an instance of `lodash`
        lodashWrapper.prototype = lodash.prototype;
        /**
         * An object used to flag environments features.
         *
         * @static
         * @memberOf _
         * @type Object
         */
        var support = lodash.support = {};
        (function () {
            var ctor = function () {
                    this.x = 1;
                }, object = {
                    '0': 1,
                    'length': 1
                }, props = [];
            ctor.prototype = {
                'valueOf': 1,
                'y': 1
            };
            for (var key in new ctor()) {
                props.push(key);
            }
            for (key in arguments) {
            }
            /**
             * Detect if an `arguments` object's [[Class]] is resolvable (all but Firefox < 4, IE < 9).
             *
             * @memberOf _.support
             * @type boolean
             */
            support.argsClass = toString.call(arguments) == argsClass;
            /**
             * Detect if `arguments` objects are `Object` objects (all but Narwhal and Opera < 10.5).
             *
             * @memberOf _.support
             * @type boolean
             */
            support.argsObject = arguments.constructor == Object && !(arguments instanceof Array);
            /**
             * Detect if `name` or `message` properties of `Error.prototype` are
             * enumerable by default. (IE < 9, Safari < 5.1)
             *
             * @memberOf _.support
             * @type boolean
             */
            support.enumErrorProps = propertyIsEnumerable.call(errorProto, 'message') || propertyIsEnumerable.call(errorProto, 'name');
            /**
             * Detect if `prototype` properties are enumerable by default.
             *
             * Firefox < 3.6, Opera > 9.50 - Opera < 11.60, and Safari < 5.1
             * (if the prototype or a property on the prototype has been set)
             * incorrectly sets a function's `prototype` property [[Enumerable]]
             * value to `true`.
             *
             * @memberOf _.support
             * @type boolean
             */
            support.enumPrototypes = propertyIsEnumerable.call(ctor, 'prototype');
            /**
             * Detect if functions can be decompiled by `Function#toString`
             * (all but PS3 and older Opera mobile browsers & avoided in Windows 8 apps).
             *
             * @memberOf _.support
             * @type boolean
             */
            support.funcDecomp = !reNative.test(context.WinRTError) && reThis.test(runInContext);
            /**
             * Detect if `Function#name` is supported (all but IE).
             *
             * @memberOf _.support
             * @type boolean
             */
            support.funcNames = typeof Function.name == 'string';
            /**
             * Detect if `arguments` object indexes are non-enumerable
             * (Firefox < 4, IE < 9, PhantomJS, Safari < 5.1).
             *
             * @memberOf _.support
             * @type boolean
             */
            support.nonEnumArgs = key != 0;
            /**
             * Detect if properties shadowing those on `Object.prototype` are non-enumerable.
             *
             * In IE < 9 an objects own properties, shadowing non-enumerable ones, are
             * made non-enumerable as well (a.k.a the JScript [[DontEnum]] bug).
             *
             * @memberOf _.support
             * @type boolean
             */
            support.nonEnumShadows = !/valueOf/.test(props);
            /**
             * Detect if own properties are iterated after inherited properties (all but IE < 9).
             *
             * @memberOf _.support
             * @type boolean
             */
            support.ownLast = props[0] != 'x';
            /**
             * Detect if `Array#shift` and `Array#splice` augment array-like objects correctly.
             *
             * Firefox < 10, IE compatibility mode, and IE < 9 have buggy Array `shift()`
             * and `splice()` functions that fail to remove the last element, `value[0]`,
             * of array-like objects even though the `length` property is set to `0`.
             * The `shift()` method is buggy in IE 8 compatibility mode, while `splice()`
             * is buggy regardless of mode in IE < 9 and buggy in compatibility mode in IE 9.
             *
             * @memberOf _.support
             * @type boolean
             */
            support.spliceObjects = (arrayRef.splice.call(object, 0, 1), !object[0]);
            /**
             * Detect lack of support for accessing string characters by index.
             *
             * IE < 8 can't access characters by index and IE 8 can only access
             * characters by index on string literals.
             *
             * @memberOf _.support
             * @type boolean
             */
            support.unindexedChars = 'x'[0] + Object('x')[0] != 'xx';
            /**
             * Detect if a DOM node's [[Class]] is resolvable (all but IE < 9)
             * and that the JS engine errors when attempting to coerce an object to
             * a string without a `toString` function.
             *
             * @memberOf _.support
             * @type boolean
             */
            try {
                support.nodeClass = !(toString.call(document) == objectClass && !({ 'toString': 0 } + ''));
            } catch (e) {
                support.nodeClass = true;
            }
        }(1));
        /**
         * By default, the template delimiters used by Lo-Dash are similar to those in
         * embedded Ruby (ERB). Change the following template settings to use alternative
         * delimiters.
         *
         * @static
         * @memberOf _
         * @type Object
         */
        lodash.templateSettings = {
            /**
             * Used to detect `data` property values to be HTML-escaped.
             *
             * @memberOf _.templateSettings
             * @type RegExp
             */
            'escape': /<%-([\s\S]+?)%>/g,
            /**
             * Used to detect code to be evaluated.
             *
             * @memberOf _.templateSettings
             * @type RegExp
             */
            'evaluate': /<%([\s\S]+?)%>/g,
            /**
             * Used to detect `data` property values to inject.
             *
             * @memberOf _.templateSettings
             * @type RegExp
             */
            'interpolate': reInterpolate,
            /**
             * Used to reference the data object in the template text.
             *
             * @memberOf _.templateSettings
             * @type string
             */
            'variable': '',
            /**
             * Used to import variables into the compiled template.
             *
             * @memberOf _.templateSettings
             * @type Object
             */
            'imports': {
                /**
                 * A reference to the `lodash` function.
                 *
                 * @memberOf _.templateSettings.imports
                 * @type Function
                 */
                '_': lodash
            }
        };
        /*--------------------------------------------------------------------------*/
        /**
         * The template used to create iterator functions.
         *
         * @private
         * @param {Object} data The data object used to populate the text.
         * @returns {string} Returns the interpolated text.
         */
        var iteratorTemplate = template(// the `iterable` may be reassigned by the `top` snippet
            'var index, iterable = <%= firstArg %>, ' + // assign the `result` variable an initial value
            'result = <%= init %>;\n' + // exit early if the first argument is falsey
            'if (!iterable) return result;\n' + // add code before the iteration branches
            '<%= top %>;' + // array-like iteration:
            '<% if (array) { %>\n' + 'var length = iterable.length; index = -1;\n' + 'if (<%= array %>) {' + // add support for accessing string characters by index if needed
            '  <% if (support.unindexedChars) { %>\n' + '  if (isString(iterable)) {\n' + '    iterable = iterable.split(\'\')\n' + '  }' + '  <% } %>\n' + // iterate over the array-like value
            '  while (++index < length) {\n' + '    <%= loop %>;\n' + '  }\n' + '}\n' + 'else {' + // object iteration:
            // add support for iterating over `arguments` objects if needed
            '  <% } else if (support.nonEnumArgs) { %>\n' + '  var length = iterable.length; index = -1;\n' + '  if (length && isArguments(iterable)) {\n' + '    while (++index < length) {\n' + '      index += \'\';\n' + '      <%= loop %>;\n' + '    }\n' + '  } else {' + '  <% } %>' + // avoid iterating over `prototype` properties in older Firefox, Opera, and Safari
            '  <% if (support.enumPrototypes) { %>\n' + '  var skipProto = typeof iterable == \'function\';\n' + '  <% } %>' + // avoid iterating over `Error.prototype` properties in older IE and Safari
            '  <% if (support.enumErrorProps) { %>\n' + '  var skipErrorProps = iterable === errorProto || iterable instanceof Error;\n' + '  <% } %>' + // define conditions used in the loop
            '  <%' + '    var conditions = [];' + '    if (support.enumPrototypes) { conditions.push(\'!(skipProto && index == "prototype")\'); }' + '    if (support.enumErrorProps)  { conditions.push(\'!(skipErrorProps && (index == "message" || index == "name"))\'); }' + '  %>' + // iterate own properties using `Object.keys`
            '  <% if (useHas && keys) { %>\n' + '  var ownIndex = -1,\n' + '      ownProps = objectTypes[typeof iterable] && keys(iterable),\n' + '      length = ownProps ? ownProps.length : 0;\n\n' + '  while (++ownIndex < length) {\n' + '    index = ownProps[ownIndex];\n<%' + '    if (conditions.length) { %>    if (<%= conditions.join(\' && \') %>) {\n  <% } %>' + '    <%= loop %>;' + '    <% if (conditions.length) { %>\n    }<% } %>\n' + '  }' + // else using a for-in loop
            '  <% } else { %>\n' + '  for (index in iterable) {\n<%' + '    if (useHas) { conditions.push("hasOwnProperty.call(iterable, index)"); }' + '    if (conditions.length) { %>    if (<%= conditions.join(\' && \') %>) {\n  <% } %>' + '    <%= loop %>;' + '    <% if (conditions.length) { %>\n    }<% } %>\n' + '  }' + // Because IE < 9 can't set the `[[Enumerable]]` attribute of an
            // existing property and the `constructor` property of a prototype
            // defaults to non-enumerable, Lo-Dash skips the `constructor`
            // property when it infers it's iterating over a `prototype` object.
            '    <% if (support.nonEnumShadows) { %>\n\n' + '  if (iterable !== objectProto) {\n' + '    var ctor = iterable.constructor,\n' + '        isProto = iterable === (ctor && ctor.prototype),\n' + '        className = iterable === stringProto ? stringClass : iterable === errorProto ? errorClass : toString.call(iterable),\n' + '        nonEnum = nonEnumProps[className];\n' + '      <% for (k = 0; k < 7; k++) { %>\n' + '    index = \'<%= shadowedProps[k] %>\';\n' + '    if ((!(isProto && nonEnum[index]) && hasOwnProperty.call(iterable, index))<%' + '        if (!useHas) { %> || (!nonEnum[index] && iterable[index] !== objectProto[index])<% }' + '      %>) {\n' + '      <%= loop %>;\n' + '    }' + '      <% } %>\n' + '  }' + '    <% } %>' + '  <% } %>' + '  <% if (array || support.nonEnumArgs) { %>\n}<% } %>\n' + // add code to the bottom of the iteration function
            '<%= bottom %>;\n' + // finally, return the `result`
            'return result');
        /*--------------------------------------------------------------------------*/
        /**
         * The base implementation of `_.bind` that creates the bound function and
         * sets its meta data.
         *
         * @private
         * @param {Array} bindData The bind data array.
         * @returns {Function} Returns the new bound function.
         */
        function baseBind(bindData) {
            var func = bindData[0], partialArgs = bindData[2], thisArg = bindData[4];
            function bound() {
                // `Function#bind` spec
                // http://es5.github.io/#x15.3.4.5
                if (partialArgs) {
                    var args = partialArgs.slice();
                    push.apply(args, arguments);
                }
                // mimic the constructor's `return` behavior
                // http://es5.github.io/#x13.2.2
                if (this instanceof bound) {
                    // ensure `new bound` is an instance of `func`
                    var thisBinding = baseCreate(func.prototype), result = func.apply(thisBinding, args || arguments);
                    return isObject(result) ? result : thisBinding;
                }
                return func.apply(thisArg, args || arguments);
            }
            setBindData(bound, bindData);
            return bound;
        }
        /**
         * The base implementation of `_.clone` without argument juggling or support
         * for `thisArg` binding.
         *
         * @private
         * @param {*} value The value to clone.
         * @param {boolean} [isDeep=false] Specify a deep clone.
         * @param {Function} [callback] The function to customize cloning values.
         * @param {Array} [stackA=[]] Tracks traversed source objects.
         * @param {Array} [stackB=[]] Associates clones with source counterparts.
         * @returns {*} Returns the cloned value.
         */
        function baseClone(value, isDeep, callback, stackA, stackB) {
            if (callback) {
                var result = callback(value);
                if (typeof result != 'undefined') {
                    return result;
                }
            }
            // inspect [[Class]]
            var isObj = isObject(value);
            if (isObj) {
                var className = toString.call(value);
                if (!cloneableClasses[className] || !support.nodeClass && isNode(value)) {
                    return value;
                }
                var ctor = ctorByClass[className];
                switch (className) {
                case boolClass:
                case dateClass:
                    return new ctor(+value);
                case numberClass:
                case stringClass:
                    return new ctor(value);
                case regexpClass:
                    result = ctor(value.source, reFlags.exec(value));
                    result.lastIndex = value.lastIndex;
                    return result;
                }
            } else {
                return value;
            }
            var isArr = isArray(value);
            if (isDeep) {
                // check for circular references and return corresponding clone
                var initedStack = !stackA;
                stackA || (stackA = getArray());
                stackB || (stackB = getArray());
                var length = stackA.length;
                while (length--) {
                    if (stackA[length] == value) {
                        return stackB[length];
                    }
                }
                result = isArr ? ctor(value.length) : {};
            } else {
                result = isArr ? slice(value) : assign({}, value);
            }
            // add array properties assigned by `RegExp#exec`
            if (isArr) {
                if (hasOwnProperty.call(value, 'index')) {
                    result.index = value.index;
                }
                if (hasOwnProperty.call(value, 'input')) {
                    result.input = value.input;
                }
            }
            // exit for shallow clone
            if (!isDeep) {
                return result;
            }
            // add the source value to the stack of traversed objects
            // and associate it with its clone
            stackA.push(value);
            stackB.push(result);
            // recursively populate clone (susceptible to call stack limits)
            (isArr ? baseEach : forOwn)(value, function (objValue, key) {
                result[key] = baseClone(objValue, isDeep, callback, stackA, stackB);
            });
            if (initedStack) {
                releaseArray(stackA);
                releaseArray(stackB);
            }
            return result;
        }
        /**
         * The base implementation of `_.create` without support for assigning
         * properties to the created object.
         *
         * @private
         * @param {Object} prototype The object to inherit from.
         * @returns {Object} Returns the new object.
         */
        function baseCreate(prototype, properties) {
            return isObject(prototype) ? nativeCreate(prototype) : {};
        }
        // fallback for browsers without `Object.create`
        if (!nativeCreate) {
            baseCreate = function () {
                function Object() {
                }
                return function (prototype) {
                    if (isObject(prototype)) {
                        Object.prototype = prototype;
                        var result = new Object();
                        Object.prototype = null;
                    }
                    return result || context.Object();
                };
            }();
        }
        /**
         * The base implementation of `_.createCallback` without support for creating
         * "_.pluck" or "_.where" style callbacks.
         *
         * @private
         * @param {*} [func=identity] The value to convert to a callback.
         * @param {*} [thisArg] The `this` binding of the created callback.
         * @param {number} [argCount] The number of arguments the callback accepts.
         * @returns {Function} Returns a callback function.
         */
        function baseCreateCallback(func, thisArg, argCount) {
            if (typeof func != 'function') {
                return identity;
            }
            // exit early for no `thisArg` or already bound by `Function#bind`
            if (typeof thisArg == 'undefined' || !('prototype' in func)) {
                return func;
            }
            var bindData = func.__bindData__;
            if (typeof bindData == 'undefined') {
                if (support.funcNames) {
                    bindData = !func.name;
                }
                bindData = bindData || !support.funcDecomp;
                if (!bindData) {
                    var source = fnToString.call(func);
                    if (!support.funcNames) {
                        bindData = !reFuncName.test(source);
                    }
                    if (!bindData) {
                        // checks if `func` references the `this` keyword and stores the result
                        bindData = reThis.test(source);
                        setBindData(func, bindData);
                    }
                }
            }
            // exit early if there are no `this` references or `func` is bound
            if (bindData === false || bindData !== true && bindData[1] & 1) {
                return func;
            }
            switch (argCount) {
            case 1:
                return function (value) {
                    return func.call(thisArg, value);
                };
            case 2:
                return function (a, b) {
                    return func.call(thisArg, a, b);
                };
            case 3:
                return function (value, index, collection) {
                    return func.call(thisArg, value, index, collection);
                };
            case 4:
                return function (accumulator, value, index, collection) {
                    return func.call(thisArg, accumulator, value, index, collection);
                };
            }
            return bind(func, thisArg);
        }
        /**
         * The base implementation of `createWrapper` that creates the wrapper and
         * sets its meta data.
         *
         * @private
         * @param {Array} bindData The bind data array.
         * @returns {Function} Returns the new function.
         */
        function baseCreateWrapper(bindData) {
            var func = bindData[0], bitmask = bindData[1], partialArgs = bindData[2], partialRightArgs = bindData[3], thisArg = bindData[4], arity = bindData[5];
            var isBind = bitmask & 1, isBindKey = bitmask & 2, isCurry = bitmask & 4, isCurryBound = bitmask & 8, key = func;
            function bound() {
                var thisBinding = isBind ? thisArg : this;
                if (partialArgs) {
                    var args = partialArgs.slice();
                    push.apply(args, arguments);
                }
                if (partialRightArgs || isCurry) {
                    args || (args = slice(arguments));
                    if (partialRightArgs) {
                        push.apply(args, partialRightArgs);
                    }
                    if (isCurry && args.length < arity) {
                        bitmask |= 16 & ~32;
                        return baseCreateWrapper([
                            func,
                            isCurryBound ? bitmask : bitmask & ~3,
                            args,
                            null,
                            thisArg,
                            arity
                        ]);
                    }
                }
                args || (args = arguments);
                if (isBindKey) {
                    func = thisBinding[key];
                }
                if (this instanceof bound) {
                    thisBinding = baseCreate(func.prototype);
                    var result = func.apply(thisBinding, args);
                    return isObject(result) ? result : thisBinding;
                }
                return func.apply(thisBinding, args);
            }
            setBindData(bound, bindData);
            return bound;
        }
        /**
         * The base implementation of `_.difference` that accepts a single array
         * of values to exclude.
         *
         * @private
         * @param {Array} array The array to process.
         * @param {Array} [values] The array of values to exclude.
         * @returns {Array} Returns a new array of filtered values.
         */
        function baseDifference(array, values) {
            var index = -1, indexOf = getIndexOf(), length = array ? array.length : 0, isLarge = length >= largeArraySize && indexOf === baseIndexOf, result = [];
            if (isLarge) {
                var cache = createCache(values);
                if (cache) {
                    indexOf = cacheIndexOf;
                    values = cache;
                } else {
                    isLarge = false;
                }
            }
            while (++index < length) {
                var value = array[index];
                if (indexOf(values, value) < 0) {
                    result.push(value);
                }
            }
            if (isLarge) {
                releaseObject(values);
            }
            return result;
        }
        /**
         * The base implementation of `_.flatten` without support for callback
         * shorthands or `thisArg` binding.
         *
         * @private
         * @param {Array} array The array to flatten.
         * @param {boolean} [isShallow=false] A flag to restrict flattening to a single level.
         * @param {boolean} [isStrict=false] A flag to restrict flattening to arrays and `arguments` objects.
         * @param {number} [fromIndex=0] The index to start from.
         * @returns {Array} Returns a new flattened array.
         */
        function baseFlatten(array, isShallow, isStrict, fromIndex) {
            var index = (fromIndex || 0) - 1, length = array ? array.length : 0, result = [];
            while (++index < length) {
                var value = array[index];
                if (value && typeof value == 'object' && typeof value.length == 'number' && (isArray(value) || isArguments(value))) {
                    // recursively flatten arrays (susceptible to call stack limits)
                    if (!isShallow) {
                        value = baseFlatten(value, isShallow, isStrict);
                    }
                    var valIndex = -1, valLength = value.length, resIndex = result.length;
                    result.length += valLength;
                    while (++valIndex < valLength) {
                        result[resIndex++] = value[valIndex];
                    }
                } else if (!isStrict) {
                    result.push(value);
                }
            }
            return result;
        }
        /**
         * The base implementation of `_.isEqual`, without support for `thisArg` binding,
         * that allows partial "_.where" style comparisons.
         *
         * @private
         * @param {*} a The value to compare.
         * @param {*} b The other value to compare.
         * @param {Function} [callback] The function to customize comparing values.
         * @param {Function} [isWhere=false] A flag to indicate performing partial comparisons.
         * @param {Array} [stackA=[]] Tracks traversed `a` objects.
         * @param {Array} [stackB=[]] Tracks traversed `b` objects.
         * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
         */
        function baseIsEqual(a, b, callback, isWhere, stackA, stackB) {
            // used to indicate that when comparing objects, `a` has at least the properties of `b`
            if (callback) {
                var result = callback(a, b);
                if (typeof result != 'undefined') {
                    return !!result;
                }
            }
            // exit early for identical values
            if (a === b) {
                // treat `+0` vs. `-0` as not equal
                return a !== 0 || 1 / a == 1 / b;
            }
            var type = typeof a, otherType = typeof b;
            // exit early for unlike primitive values
            if (a === a && !(a && objectTypes[type]) && !(b && objectTypes[otherType])) {
                return false;
            }
            // exit early for `null` and `undefined` avoiding ES3's Function#call behavior
            // http://es5.github.io/#x15.3.4.4
            if (a == null || b == null) {
                return a === b;
            }
            // compare [[Class]] names
            var className = toString.call(a), otherClass = toString.call(b);
            if (className == argsClass) {
                className = objectClass;
            }
            if (otherClass == argsClass) {
                otherClass = objectClass;
            }
            if (className != otherClass) {
                return false;
            }
            switch (className) {
            case boolClass:
            case dateClass:
                // coerce dates and booleans to numbers, dates to milliseconds and booleans
                // to `1` or `0` treating invalid dates coerced to `NaN` as not equal
                return +a == +b;
            case numberClass:
                // treat `NaN` vs. `NaN` as equal
                return a != +a ? b != +b    // but treat `+0` vs. `-0` as not equal
 : a == 0 ? 1 / a == 1 / b : a == +b;
            case regexpClass:
            case stringClass:
                // coerce regexes to strings (http://es5.github.io/#x15.10.6.4)
                // treat string primitives and their corresponding object instances as equal
                return a == String(b);
            }
            var isArr = className == arrayClass;
            if (!isArr) {
                // unwrap any `lodash` wrapped values
                var aWrapped = hasOwnProperty.call(a, '__wrapped__'), bWrapped = hasOwnProperty.call(b, '__wrapped__');
                if (aWrapped || bWrapped) {
                    return baseIsEqual(aWrapped ? a.__wrapped__ : a, bWrapped ? b.__wrapped__ : b, callback, isWhere, stackA, stackB);
                }
                // exit for functions and DOM nodes
                if (className != objectClass || !support.nodeClass && (isNode(a) || isNode(b))) {
                    return false;
                }
                // in older versions of Opera, `arguments` objects have `Array` constructors
                var ctorA = !support.argsObject && isArguments(a) ? Object : a.constructor, ctorB = !support.argsObject && isArguments(b) ? Object : b.constructor;
                // non `Object` object instances with different constructors are not equal
                if (ctorA != ctorB && !(isFunction(ctorA) && ctorA instanceof ctorA && isFunction(ctorB) && ctorB instanceof ctorB) && ('constructor' in a && 'constructor' in b)) {
                    return false;
                }
            }
            // assume cyclic structures are equal
            // the algorithm for detecting cyclic structures is adapted from ES 5.1
            // section 15.12.3, abstract operation `JO` (http://es5.github.io/#x15.12.3)
            var initedStack = !stackA;
            stackA || (stackA = getArray());
            stackB || (stackB = getArray());
            var length = stackA.length;
            while (length--) {
                if (stackA[length] == a) {
                    return stackB[length] == b;
                }
            }
            var size = 0;
            result = true;
            // add `a` and `b` to the stack of traversed objects
            stackA.push(a);
            stackB.push(b);
            // recursively compare objects and arrays (susceptible to call stack limits)
            if (isArr) {
                length = a.length;
                size = b.length;
                // compare lengths to determine if a deep comparison is necessary
                result = size == a.length;
                if (!result && !isWhere) {
                    return result;
                }
                // deep compare the contents, ignoring non-numeric properties
                while (size--) {
                    var index = length, value = b[size];
                    if (isWhere) {
                        while (index--) {
                            if (result = baseIsEqual(a[index], value, callback, isWhere, stackA, stackB)) {
                                break;
                            }
                        }
                    } else if (!(result = baseIsEqual(a[size], value, callback, isWhere, stackA, stackB))) {
                        break;
                    }
                }
                return result;
            }
            // deep compare objects using `forIn`, instead of `forOwn`, to avoid `Object.keys`
            // which, in this case, is more costly
            forIn(b, function (value, key, b) {
                if (hasOwnProperty.call(b, key)) {
                    // count the number of properties.
                    size++;
                    // deep compare each property value.
                    return result = hasOwnProperty.call(a, key) && baseIsEqual(a[key], value, callback, isWhere, stackA, stackB);
                }
            });
            if (result && !isWhere) {
                // ensure both objects have the same number of properties
                forIn(a, function (value, key, a) {
                    if (hasOwnProperty.call(a, key)) {
                        // `size` will be `-1` if `a` has more properties than `b`
                        return result = --size > -1;
                    }
                });
            }
            if (initedStack) {
                releaseArray(stackA);
                releaseArray(stackB);
            }
            return result;
        }
        /**
         * The base implementation of `_.merge` without argument juggling or support
         * for `thisArg` binding.
         *
         * @private
         * @param {Object} object The destination object.
         * @param {Object} source The source object.
         * @param {Function} [callback] The function to customize merging properties.
         * @param {Array} [stackA=[]] Tracks traversed source objects.
         * @param {Array} [stackB=[]] Associates values with source counterparts.
         */
        function baseMerge(object, source, callback, stackA, stackB) {
            (isArray(source) ? forEach : forOwn)(source, function (source, key) {
                var found, isArr, result = source, value = object[key];
                if (source && ((isArr = isArray(source)) || isPlainObject(source))) {
                    // avoid merging previously merged cyclic sources
                    var stackLength = stackA.length;
                    while (stackLength--) {
                        if (found = stackA[stackLength] == source) {
                            value = stackB[stackLength];
                            break;
                        }
                    }
                    if (!found) {
                        var isShallow;
                        if (callback) {
                            result = callback(value, source);
                            if (isShallow = typeof result != 'undefined') {
                                value = result;
                            }
                        }
                        if (!isShallow) {
                            value = isArr ? isArray(value) ? value : [] : isPlainObject(value) ? value : {};
                        }
                        // add `source` and associated `value` to the stack of traversed objects
                        stackA.push(source);
                        stackB.push(value);
                        // recursively merge objects and arrays (susceptible to call stack limits)
                        if (!isShallow) {
                            baseMerge(value, source, callback, stackA, stackB);
                        }
                    }
                } else {
                    if (callback) {
                        result = callback(value, source);
                        if (typeof result == 'undefined') {
                            result = source;
                        }
                    }
                    if (typeof result != 'undefined') {
                        value = result;
                    }
                }
                object[key] = value;
            });
        }
        /**
         * The base implementation of `_.random` without argument juggling or support
         * for returning floating-point numbers.
         *
         * @private
         * @param {number} min The minimum possible value.
         * @param {number} max The maximum possible value.
         * @returns {number} Returns a random number.
         */
        function baseRandom(min, max) {
            return min + floor(nativeRandom() * (max - min + 1));
        }
        /**
         * The base implementation of `_.uniq` without support for callback shorthands
         * or `thisArg` binding.
         *
         * @private
         * @param {Array} array The array to process.
         * @param {boolean} [isSorted=false] A flag to indicate that `array` is sorted.
         * @param {Function} [callback] The function called per iteration.
         * @returns {Array} Returns a duplicate-value-free array.
         */
        function baseUniq(array, isSorted, callback) {
            var index = -1, indexOf = getIndexOf(), length = array ? array.length : 0, result = [];
            var isLarge = !isSorted && length >= largeArraySize && indexOf === baseIndexOf, seen = callback || isLarge ? getArray() : result;
            if (isLarge) {
                var cache = createCache(seen);
                if (cache) {
                    indexOf = cacheIndexOf;
                    seen = cache;
                } else {
                    isLarge = false;
                    seen = callback ? seen : (releaseArray(seen), result);
                }
            }
            while (++index < length) {
                var value = array[index], computed = callback ? callback(value, index, array) : value;
                if (isSorted ? !index || seen[seen.length - 1] !== computed : indexOf(seen, computed) < 0) {
                    if (callback || isLarge) {
                        seen.push(computed);
                    }
                    result.push(value);
                }
            }
            if (isLarge) {
                releaseArray(seen.array);
                releaseObject(seen);
            } else if (callback) {
                releaseArray(seen);
            }
            return result;
        }
        /**
         * Creates a function that aggregates a collection, creating an object composed
         * of keys generated from the results of running each element of the collection
         * through a callback. The given `setter` function sets the keys and values
         * of the composed object.
         *
         * @private
         * @param {Function} setter The setter function.
         * @returns {Function} Returns the new aggregator function.
         */
        function createAggregator(setter) {
            return function (collection, callback, thisArg) {
                var result = {};
                callback = lodash.createCallback(callback, thisArg, 3);
                if (isArray(collection)) {
                    var index = -1, length = collection.length;
                    while (++index < length) {
                        var value = collection[index];
                        setter(result, value, callback(value, index, collection), collection);
                    }
                } else {
                    baseEach(collection, function (value, key, collection) {
                        setter(result, value, callback(value, key, collection), collection);
                    });
                }
                return result;
            };
        }
        /**
         * Creates a function that, when called, either curries or invokes `func`
         * with an optional `this` binding and partially applied arguments.
         *
         * @private
         * @param {Function|string} func The function or method name to reference.
         * @param {number} bitmask The bitmask of method flags to compose.
         *  The bitmask may be composed of the following flags:
         *  1 - `_.bind`
         *  2 - `_.bindKey`
         *  4 - `_.curry`
         *  8 - `_.curry` (bound)
         *  16 - `_.partial`
         *  32 - `_.partialRight`
         * @param {Array} [partialArgs] An array of arguments to prepend to those
         *  provided to the new function.
         * @param {Array} [partialRightArgs] An array of arguments to append to those
         *  provided to the new function.
         * @param {*} [thisArg] The `this` binding of `func`.
         * @param {number} [arity] The arity of `func`.
         * @returns {Function} Returns the new function.
         */
        function createWrapper(func, bitmask, partialArgs, partialRightArgs, thisArg, arity) {
            var isBind = bitmask & 1, isBindKey = bitmask & 2, isCurry = bitmask & 4, isCurryBound = bitmask & 8, isPartial = bitmask & 16, isPartialRight = bitmask & 32;
            if (!isBindKey && !isFunction(func)) {
                throw new TypeError();
            }
            if (isPartial && !partialArgs.length) {
                bitmask &= ~16;
                isPartial = partialArgs = false;
            }
            if (isPartialRight && !partialRightArgs.length) {
                bitmask &= ~32;
                isPartialRight = partialRightArgs = false;
            }
            var bindData = func && func.__bindData__;
            if (bindData && bindData !== true) {
                bindData = bindData.slice();
                // set `thisBinding` is not previously bound
                if (isBind && !(bindData[1] & 1)) {
                    bindData[4] = thisArg;
                }
                // set if previously bound but not currently (subsequent curried functions)
                if (!isBind && bindData[1] & 1) {
                    bitmask |= 8;
                }
                // set curried arity if not yet set
                if (isCurry && !(bindData[1] & 4)) {
                    bindData[5] = arity;
                }
                // append partial left arguments
                if (isPartial) {
                    push.apply(bindData[2] || (bindData[2] = []), partialArgs);
                }
                // append partial right arguments
                if (isPartialRight) {
                    push.apply(bindData[3] || (bindData[3] = []), partialRightArgs);
                }
                // merge flags
                bindData[1] |= bitmask;
                return createWrapper.apply(null, bindData);
            }
            // fast path for `_.bind`
            var creater = bitmask == 1 || bitmask === 17 ? baseBind : baseCreateWrapper;
            return creater([
                func,
                bitmask,
                partialArgs,
                partialRightArgs,
                thisArg,
                arity
            ]);
        }
        /**
         * Creates compiled iteration functions.
         *
         * @private
         * @param {...Object} [options] The compile options object(s).
         * @param {string} [options.array] Code to determine if the iterable is an array or array-like.
         * @param {boolean} [options.useHas] Specify using `hasOwnProperty` checks in the object loop.
         * @param {Function} [options.keys] A reference to `_.keys` for use in own property iteration.
         * @param {string} [options.args] A comma separated string of iteration function arguments.
         * @param {string} [options.top] Code to execute before the iteration branches.
         * @param {string} [options.loop] Code to execute in the object loop.
         * @param {string} [options.bottom] Code to execute after the iteration branches.
         * @returns {Function} Returns the compiled function.
         */
        function createIterator() {
            // data properties
            iteratorData.shadowedProps = shadowedProps;
            iteratorData.support = support;
            // iterator options
            iteratorData.array = iteratorData.bottom = iteratorData.loop = iteratorData.top = '';
            iteratorData.init = 'iterable';
            iteratorData.useHas = true;
            // merge options into a template data object
            for (var object, index = 0; object = arguments[index]; index++) {
                for (var key in object) {
                    iteratorData[key] = object[key];
                }
            }
            var args = iteratorData.args;
            iteratorData.firstArg = /^[^,]+/.exec(args)[0];
            // create the function factory
            var factory = Function('baseCreateCallback, errorClass, errorProto, hasOwnProperty, ' + 'indicatorObject, isArguments, isArray, isString, keys, objectProto, ' + 'objectTypes, nonEnumProps, stringClass, stringProto, toString', 'return function(' + args + ') {\n' + iteratorTemplate(iteratorData) + '\n}');
            // return the compiled function
            return factory(baseCreateCallback, errorClass, errorProto, hasOwnProperty, indicatorObject, isArguments, isArray, isString, iteratorData.keys, objectProto, objectTypes, nonEnumProps, stringClass, stringProto, toString);
        }
        /**
         * Used by `escape` to convert characters to HTML entities.
         *
         * @private
         * @param {string} match The matched character to escape.
         * @returns {string} Returns the escaped character.
         */
        function escapeHtmlChar(match) {
            return htmlEscapes[match];
        }
        /**
         * Gets the appropriate "indexOf" function. If the `_.indexOf` method is
         * customized, this method returns the custom method, otherwise it returns
         * the `baseIndexOf` function.
         *
         * @private
         * @returns {Function} Returns the "indexOf" function.
         */
        function getIndexOf() {
            var result = (result = lodash.indexOf) === indexOf ? baseIndexOf : result;
            return result;
        }
        /**
         * Sets `this` binding data on a given function.
         *
         * @private
         * @param {Function} func The function to set data on.
         * @param {Array} value The data array to set.
         */
        var setBindData = !defineProperty ? noop : function (func, value) {
                descriptor.value = value;
                defineProperty(func, '__bindData__', descriptor);
            };
        /**
         * A fallback implementation of `isPlainObject` which checks if a given value
         * is an object created by the `Object` constructor, assuming objects created
         * by the `Object` constructor have no inherited enumerable properties and that
         * there are no `Object.prototype` extensions.
         *
         * @private
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
         */
        function shimIsPlainObject(value) {
            var ctor, result;
            // avoid non Object objects, `arguments` objects, and DOM elements
            if (!(value && toString.call(value) == objectClass) || (ctor = value.constructor, isFunction(ctor) && !(ctor instanceof ctor)) || !support.argsClass && isArguments(value) || !support.nodeClass && isNode(value)) {
                return false;
            }
            // IE < 9 iterates inherited properties before own properties. If the first
            // iterated property is an object's own property then there are no inherited
            // enumerable properties.
            if (support.ownLast) {
                forIn(value, function (value, key, object) {
                    result = hasOwnProperty.call(object, key);
                    return false;
                });
                return result !== false;
            }
            // In most environments an object's own properties are iterated before
            // its inherited properties. If the last iterated property is an object's
            // own property then there are no inherited enumerable properties.
            forIn(value, function (value, key) {
                result = key;
            });
            return typeof result == 'undefined' || hasOwnProperty.call(value, result);
        }
        /**
         * Used by `unescape` to convert HTML entities to characters.
         *
         * @private
         * @param {string} match The matched character to unescape.
         * @returns {string} Returns the unescaped character.
         */
        function unescapeHtmlChar(match) {
            return htmlUnescapes[match];
        }
        /*--------------------------------------------------------------------------*/
        /**
         * Checks if `value` is an `arguments` object.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is an `arguments` object, else `false`.
         * @example
         *
         * (function() { return _.isArguments(arguments); })(1, 2, 3);
         * // => true
         *
         * _.isArguments([1, 2, 3]);
         * // => false
         */
        function isArguments(value) {
            return value && typeof value == 'object' && typeof value.length == 'number' && toString.call(value) == argsClass || false;
        }
        // fallback for browsers that can't detect `arguments` objects by [[Class]]
        if (!support.argsClass) {
            isArguments = function (value) {
                return value && typeof value == 'object' && typeof value.length == 'number' && hasOwnProperty.call(value, 'callee') && !propertyIsEnumerable.call(value, 'callee') || false;
            };
        }
        /**
         * Checks if `value` is an array.
         *
         * @static
         * @memberOf _
         * @type Function
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is an array, else `false`.
         * @example
         *
         * (function() { return _.isArray(arguments); })();
         * // => false
         *
         * _.isArray([1, 2, 3]);
         * // => true
         */
        var isArray = nativeIsArray || function (value) {
                return value && typeof value == 'object' && typeof value.length == 'number' && toString.call(value) == arrayClass || false;
            };
        /**
         * A fallback implementation of `Object.keys` which produces an array of the
         * given object's own enumerable property names.
         *
         * @private
         * @type Function
         * @param {Object} object The object to inspect.
         * @returns {Array} Returns an array of property names.
         */
        var shimKeys = createIterator({
                'args': 'object',
                'init': '[]',
                'top': 'if (!(objectTypes[typeof object])) return result',
                'loop': 'result.push(index)'
            });
        /**
         * Creates an array composed of the own enumerable property names of an object.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to inspect.
         * @returns {Array} Returns an array of property names.
         * @example
         *
         * _.keys({ 'one': 1, 'two': 2, 'three': 3 });
         * // => ['one', 'two', 'three'] (property order is not guaranteed across environments)
         */
        var keys = !nativeKeys ? shimKeys : function (object) {
                if (!isObject(object)) {
                    return [];
                }
                if (support.enumPrototypes && typeof object == 'function' || support.nonEnumArgs && object.length && isArguments(object)) {
                    return shimKeys(object);
                }
                return nativeKeys(object);
            };
        /** Reusable iterator options shared by `each`, `forIn`, and `forOwn` */
        var eachIteratorOptions = {
                'args': 'collection, callback, thisArg',
                'top': 'callback = callback && typeof thisArg == \'undefined\' ? callback : baseCreateCallback(callback, thisArg, 3)',
                'array': 'typeof length == \'number\'',
                'keys': keys,
                'loop': 'if (callback(iterable[index], index, collection) === false) return result'
            };
        /** Reusable iterator options for `assign` and `defaults` */
        var defaultsIteratorOptions = {
                'args': 'object, source, guard',
                'top': 'var args = arguments,\n' + '    argsIndex = 0,\n' + '    argsLength = typeof guard == \'number\' ? 2 : args.length;\n' + 'while (++argsIndex < argsLength) {\n' + '  iterable = args[argsIndex];\n' + '  if (iterable && objectTypes[typeof iterable]) {',
                'keys': keys,
                'loop': 'if (typeof result[index] == \'undefined\') result[index] = iterable[index]',
                'bottom': '  }\n}'
            };
        /** Reusable iterator options for `forIn` and `forOwn` */
        var forOwnIteratorOptions = {
                'top': 'if (!objectTypes[typeof iterable]) return result;\n' + eachIteratorOptions.top,
                'array': false
            };
        /**
         * Used to convert characters to HTML entities:
         *
         * Though the `>` character is escaped for symmetry, characters like `>` and `/`
         * don't require escaping in HTML and have no special meaning unless they're part
         * of a tag or an unquoted attribute value.
         * http://mathiasbynens.be/notes/ambiguous-ampersands (under "semi-related fun fact")
         */
        var htmlEscapes = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                '\'': '&#39;'
            };
        /** Used to convert HTML entities to characters */
        var htmlUnescapes = invert(htmlEscapes);
        /** Used to match HTML entities and HTML characters */
        var reEscapedHtml = RegExp('(' + keys(htmlUnescapes).join('|') + ')', 'g'), reUnescapedHtml = RegExp('[' + keys(htmlEscapes).join('') + ']', 'g');
        /**
         * A function compiled to iterate `arguments` objects, arrays, objects, and
         * strings consistenly across environments, executing the callback for each
         * element in the collection. The callback is bound to `thisArg` and invoked
         * with three arguments; (value, index|key, collection). Callbacks may exit
         * iteration early by explicitly returning `false`.
         *
         * @private
         * @type Function
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array|Object|string} Returns `collection`.
         */
        var baseEach = createIterator(eachIteratorOptions);
        /*--------------------------------------------------------------------------*/
        /**
         * Assigns own enumerable properties of source object(s) to the destination
         * object. Subsequent sources will overwrite property assignments of previous
         * sources. If a callback is provided it will be executed to produce the
         * assigned values. The callback is bound to `thisArg` and invoked with two
         * arguments; (objectValue, sourceValue).
         *
         * @static
         * @memberOf _
         * @type Function
         * @alias extend
         * @category Objects
         * @param {Object} object The destination object.
         * @param {...Object} [source] The source objects.
         * @param {Function} [callback] The function to customize assigning values.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns the destination object.
         * @example
         *
         * _.assign({ 'name': 'fred' }, { 'employer': 'slate' });
         * // => { 'name': 'fred', 'employer': 'slate' }
         *
         * var defaults = _.partialRight(_.assign, function(a, b) {
         *   return typeof a == 'undefined' ? b : a;
         * });
         *
         * var object = { 'name': 'barney' };
         * defaults(object, { 'name': 'fred', 'employer': 'slate' });
         * // => { 'name': 'barney', 'employer': 'slate' }
         */
        var assign = createIterator(defaultsIteratorOptions, {
                'top': defaultsIteratorOptions.top.replace(';', ';\n' + 'if (argsLength > 3 && typeof args[argsLength - 2] == \'function\') {\n' + '  var callback = baseCreateCallback(args[--argsLength - 1], args[argsLength--], 2);\n' + '} else if (argsLength > 2 && typeof args[argsLength - 1] == \'function\') {\n' + '  callback = args[--argsLength];\n' + '}'),
                'loop': 'result[index] = callback ? callback(result[index], iterable[index]) : iterable[index]'
            });
        /**
         * Creates a clone of `value`. If `isDeep` is `true` nested objects will also
         * be cloned, otherwise they will be assigned by reference. If a callback
         * is provided it will be executed to produce the cloned values. If the
         * callback returns `undefined` cloning will be handled by the method instead.
         * The callback is bound to `thisArg` and invoked with one argument; (value).
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to clone.
         * @param {boolean} [isDeep=false] Specify a deep clone.
         * @param {Function} [callback] The function to customize cloning values.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the cloned value.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * var shallow = _.clone(characters);
         * shallow[0] === characters[0];
         * // => true
         *
         * var deep = _.clone(characters, true);
         * deep[0] === characters[0];
         * // => false
         *
         * _.mixin({
         *   'clone': _.partialRight(_.clone, function(value) {
         *     return _.isElement(value) ? value.cloneNode(false) : undefined;
         *   })
         * });
         *
         * var clone = _.clone(document.body);
         * clone.childNodes.length;
         * // => 0
         */
        function clone(value, isDeep, callback, thisArg) {
            // allows working with "Collections" methods without using their `index`
            // and `collection` arguments for `isDeep` and `callback`
            if (typeof isDeep != 'boolean' && isDeep != null) {
                thisArg = callback;
                callback = isDeep;
                isDeep = false;
            }
            return baseClone(value, isDeep, typeof callback == 'function' && baseCreateCallback(callback, thisArg, 1));
        }
        /**
         * Creates a deep clone of `value`. If a callback is provided it will be
         * executed to produce the cloned values. If the callback returns `undefined`
         * cloning will be handled by the method instead. The callback is bound to
         * `thisArg` and invoked with one argument; (value).
         *
         * Note: This method is loosely based on the structured clone algorithm. Functions
         * and DOM nodes are **not** cloned. The enumerable properties of `arguments` objects and
         * objects created by constructors other than `Object` are cloned to plain `Object` objects.
         * See http://www.w3.org/TR/html5/infrastructure.html#internal-structured-cloning-algorithm.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to deep clone.
         * @param {Function} [callback] The function to customize cloning values.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the deep cloned value.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * var deep = _.cloneDeep(characters);
         * deep[0] === characters[0];
         * // => false
         *
         * var view = {
         *   'label': 'docs',
         *   'node': element
         * };
         *
         * var clone = _.cloneDeep(view, function(value) {
         *   return _.isElement(value) ? value.cloneNode(true) : undefined;
         * });
         *
         * clone.node == view.node;
         * // => false
         */
        function cloneDeep(value, callback, thisArg) {
            return baseClone(value, true, typeof callback == 'function' && baseCreateCallback(callback, thisArg, 1));
        }
        /**
         * Creates an object that inherits from the given `prototype` object. If a
         * `properties` object is provided its own enumerable properties are assigned
         * to the created object.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} prototype The object to inherit from.
         * @param {Object} [properties] The properties to assign to the object.
         * @returns {Object} Returns the new object.
         * @example
         *
         * function Shape() {
         *   this.x = 0;
         *   this.y = 0;
         * }
         *
         * function Circle() {
         *   Shape.call(this);
         * }
         *
         * Circle.prototype = _.create(Shape.prototype, { 'constructor': Circle });
         *
         * var circle = new Circle;
         * circle instanceof Circle;
         * // => true
         *
         * circle instanceof Shape;
         * // => true
         */
        function create(prototype, properties) {
            var result = baseCreate(prototype);
            return properties ? assign(result, properties) : result;
        }
        /**
         * Assigns own enumerable properties of source object(s) to the destination
         * object for all destination properties that resolve to `undefined`. Once a
         * property is set, additional defaults of the same property will be ignored.
         *
         * @static
         * @memberOf _
         * @type Function
         * @category Objects
         * @param {Object} object The destination object.
         * @param {...Object} [source] The source objects.
         * @param- {Object} [guard] Allows working with `_.reduce` without using its
         *  `key` and `object` arguments as sources.
         * @returns {Object} Returns the destination object.
         * @example
         *
         * var object = { 'name': 'barney' };
         * _.defaults(object, { 'name': 'fred', 'employer': 'slate' });
         * // => { 'name': 'barney', 'employer': 'slate' }
         */
        var defaults = createIterator(defaultsIteratorOptions);
        /**
         * This method is like `_.findIndex` except that it returns the key of the
         * first element that passes the callback check, instead of the element itself.
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to search.
         * @param {Function|Object|string} [callback=identity] The function called per
         *  iteration. If a property name or object is provided it will be used to
         *  create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {string|undefined} Returns the key of the found element, else `undefined`.
         * @example
         *
         * var characters = {
         *   'barney': {  'age': 36, 'blocked': false },
         *   'fred': {    'age': 40, 'blocked': true },
         *   'pebbles': { 'age': 1,  'blocked': false }
         * };
         *
         * _.findKey(characters, function(chr) {
         *   return chr.age < 40;
         * });
         * // => 'barney' (property order is not guaranteed across environments)
         *
         * // using "_.where" callback shorthand
         * _.findKey(characters, { 'age': 1 });
         * // => 'pebbles'
         *
         * // using "_.pluck" callback shorthand
         * _.findKey(characters, 'blocked');
         * // => 'fred'
         */
        function findKey(object, callback, thisArg) {
            var result;
            callback = lodash.createCallback(callback, thisArg, 3);
            forOwn(object, function (value, key, object) {
                if (callback(value, key, object)) {
                    result = key;
                    return false;
                }
            });
            return result;
        }
        /**
         * This method is like `_.findKey` except that it iterates over elements
         * of a `collection` in the opposite order.
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to search.
         * @param {Function|Object|string} [callback=identity] The function called per
         *  iteration. If a property name or object is provided it will be used to
         *  create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {string|undefined} Returns the key of the found element, else `undefined`.
         * @example
         *
         * var characters = {
         *   'barney': {  'age': 36, 'blocked': true },
         *   'fred': {    'age': 40, 'blocked': false },
         *   'pebbles': { 'age': 1,  'blocked': true }
         * };
         *
         * _.findLastKey(characters, function(chr) {
         *   return chr.age < 40;
         * });
         * // => returns `pebbles`, assuming `_.findKey` returns `barney`
         *
         * // using "_.where" callback shorthand
         * _.findLastKey(characters, { 'age': 40 });
         * // => 'fred'
         *
         * // using "_.pluck" callback shorthand
         * _.findLastKey(characters, 'blocked');
         * // => 'pebbles'
         */
        function findLastKey(object, callback, thisArg) {
            var result;
            callback = lodash.createCallback(callback, thisArg, 3);
            forOwnRight(object, function (value, key, object) {
                if (callback(value, key, object)) {
                    result = key;
                    return false;
                }
            });
            return result;
        }
        /**
         * Iterates over own and inherited enumerable properties of an object,
         * executing the callback for each property. The callback is bound to `thisArg`
         * and invoked with three arguments; (value, key, object). Callbacks may exit
         * iteration early by explicitly returning `false`.
         *
         * @static
         * @memberOf _
         * @type Function
         * @category Objects
         * @param {Object} object The object to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns `object`.
         * @example
         *
         * function Shape() {
         *   this.x = 0;
         *   this.y = 0;
         * }
         *
         * Shape.prototype.move = function(x, y) {
         *   this.x += x;
         *   this.y += y;
         * };
         *
         * _.forIn(new Shape, function(value, key) {
         *   console.log(key);
         * });
         * // => logs 'x', 'y', and 'move' (property order is not guaranteed across environments)
         */
        var forIn = createIterator(eachIteratorOptions, forOwnIteratorOptions, { 'useHas': false });
        /**
         * This method is like `_.forIn` except that it iterates over elements
         * of a `collection` in the opposite order.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns `object`.
         * @example
         *
         * function Shape() {
         *   this.x = 0;
         *   this.y = 0;
         * }
         *
         * Shape.prototype.move = function(x, y) {
         *   this.x += x;
         *   this.y += y;
         * };
         *
         * _.forInRight(new Shape, function(value, key) {
         *   console.log(key);
         * });
         * // => logs 'move', 'y', and 'x' assuming `_.forIn ` logs 'x', 'y', and 'move'
         */
        function forInRight(object, callback, thisArg) {
            var pairs = [];
            forIn(object, function (value, key) {
                pairs.push(key, value);
            });
            var length = pairs.length;
            callback = baseCreateCallback(callback, thisArg, 3);
            while (length--) {
                if (callback(pairs[length--], pairs[length], object) === false) {
                    break;
                }
            }
            return object;
        }
        /**
         * Iterates over own enumerable properties of an object, executing the callback
         * for each property. The callback is bound to `thisArg` and invoked with three
         * arguments; (value, key, object). Callbacks may exit iteration early by
         * explicitly returning `false`.
         *
         * @static
         * @memberOf _
         * @type Function
         * @category Objects
         * @param {Object} object The object to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns `object`.
         * @example
         *
         * _.forOwn({ '0': 'zero', '1': 'one', 'length': 2 }, function(num, key) {
         *   console.log(key);
         * });
         * // => logs '0', '1', and 'length' (property order is not guaranteed across environments)
         */
        var forOwn = createIterator(eachIteratorOptions, forOwnIteratorOptions);
        /**
         * This method is like `_.forOwn` except that it iterates over elements
         * of a `collection` in the opposite order.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns `object`.
         * @example
         *
         * _.forOwnRight({ '0': 'zero', '1': 'one', 'length': 2 }, function(num, key) {
         *   console.log(key);
         * });
         * // => logs 'length', '1', and '0' assuming `_.forOwn` logs '0', '1', and 'length'
         */
        function forOwnRight(object, callback, thisArg) {
            var props = keys(object), length = props.length;
            callback = baseCreateCallback(callback, thisArg, 3);
            while (length--) {
                var key = props[length];
                if (callback(object[key], key, object) === false) {
                    break;
                }
            }
            return object;
        }
        /**
         * Creates a sorted array of property names of all enumerable properties,
         * own and inherited, of `object` that have function values.
         *
         * @static
         * @memberOf _
         * @alias methods
         * @category Objects
         * @param {Object} object The object to inspect.
         * @returns {Array} Returns an array of property names that have function values.
         * @example
         *
         * _.functions(_);
         * // => ['all', 'any', 'bind', 'bindAll', 'clone', 'compact', 'compose', ...]
         */
        function functions(object) {
            var result = [];
            forIn(object, function (value, key) {
                if (isFunction(value)) {
                    result.push(key);
                }
            });
            return result.sort();
        }
        /**
         * Checks if the specified object `property` exists and is a direct property,
         * instead of an inherited property.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to check.
         * @param {string} property The property to check for.
         * @returns {boolean} Returns `true` if key is a direct property, else `false`.
         * @example
         *
         * _.has({ 'a': 1, 'b': 2, 'c': 3 }, 'b');
         * // => true
         */
        function has(object, property) {
            return object ? hasOwnProperty.call(object, property) : false;
        }
        /**
         * Creates an object composed of the inverted keys and values of the given object.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to invert.
         * @returns {Object} Returns the created inverted object.
         * @example
         *
         *  _.invert({ 'first': 'fred', 'second': 'barney' });
         * // => { 'fred': 'first', 'barney': 'second' }
         */
        function invert(object) {
            var index = -1, props = keys(object), length = props.length, result = {};
            while (++index < length) {
                var key = props[index];
                result[object[key]] = key;
            }
            return result;
        }
        /**
         * Checks if `value` is a boolean value.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is a boolean value, else `false`.
         * @example
         *
         * _.isBoolean(null);
         * // => false
         */
        function isBoolean(value) {
            return value === true || value === false || value && typeof value == 'object' && toString.call(value) == boolClass || false;
        }
        /**
         * Checks if `value` is a date.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is a date, else `false`.
         * @example
         *
         * _.isDate(new Date);
         * // => true
         */
        function isDate(value) {
            return value && typeof value == 'object' && toString.call(value) == dateClass || false;
        }
        /**
         * Checks if `value` is a DOM element.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is a DOM element, else `false`.
         * @example
         *
         * _.isElement(document.body);
         * // => true
         */
        function isElement(value) {
            return value && value.nodeType === 1 || false;
        }
        /**
         * Checks if `value` is empty. Arrays, strings, or `arguments` objects with a
         * length of `0` and objects with no own enumerable properties are considered
         * "empty".
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Array|Object|string} value The value to inspect.
         * @returns {boolean} Returns `true` if the `value` is empty, else `false`.
         * @example
         *
         * _.isEmpty([1, 2, 3]);
         * // => false
         *
         * _.isEmpty({});
         * // => true
         *
         * _.isEmpty('');
         * // => true
         */
        function isEmpty(value) {
            var result = true;
            if (!value) {
                return result;
            }
            var className = toString.call(value), length = value.length;
            if (className == arrayClass || className == stringClass || (support.argsClass ? className == argsClass : isArguments(value)) || className == objectClass && typeof length == 'number' && isFunction(value.splice)) {
                return !length;
            }
            forOwn(value, function () {
                return result = false;
            });
            return result;
        }
        /**
         * Performs a deep comparison between two values to determine if they are
         * equivalent to each other. If a callback is provided it will be executed
         * to compare values. If the callback returns `undefined` comparisons will
         * be handled by the method instead. The callback is bound to `thisArg` and
         * invoked with two arguments; (a, b).
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} a The value to compare.
         * @param {*} b The other value to compare.
         * @param {Function} [callback] The function to customize comparing values.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
         * @example
         *
         * var object = { 'name': 'fred' };
         * var copy = { 'name': 'fred' };
         *
         * object == copy;
         * // => false
         *
         * _.isEqual(object, copy);
         * // => true
         *
         * var words = ['hello', 'goodbye'];
         * var otherWords = ['hi', 'goodbye'];
         *
         * _.isEqual(words, otherWords, function(a, b) {
         *   var reGreet = /^(?:hello|hi)$/i,
         *       aGreet = _.isString(a) && reGreet.test(a),
         *       bGreet = _.isString(b) && reGreet.test(b);
         *
         *   return (aGreet || bGreet) ? (aGreet == bGreet) : undefined;
         * });
         * // => true
         */
        function isEqual(a, b, callback, thisArg) {
            return baseIsEqual(a, b, typeof callback == 'function' && baseCreateCallback(callback, thisArg, 2));
        }
        /**
         * Checks if `value` is, or can be coerced to, a finite number.
         *
         * Note: This is not the same as native `isFinite` which will return true for
         * booleans and empty strings. See http://es5.github.io/#x15.1.2.5.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is finite, else `false`.
         * @example
         *
         * _.isFinite(-101);
         * // => true
         *
         * _.isFinite('10');
         * // => true
         *
         * _.isFinite(true);
         * // => false
         *
         * _.isFinite('');
         * // => false
         *
         * _.isFinite(Infinity);
         * // => false
         */
        function isFinite(value) {
            return nativeIsFinite(value) && !nativeIsNaN(parseFloat(value));
        }
        /**
         * Checks if `value` is a function.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is a function, else `false`.
         * @example
         *
         * _.isFunction(_);
         * // => true
         */
        function isFunction(value) {
            return typeof value == 'function';
        }
        // fallback for older versions of Chrome and Safari
        if (isFunction(/x/)) {
            isFunction = function (value) {
                return typeof value == 'function' && toString.call(value) == funcClass;
            };
        }
        /**
         * Checks if `value` is the language type of Object.
         * (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is an object, else `false`.
         * @example
         *
         * _.isObject({});
         * // => true
         *
         * _.isObject([1, 2, 3]);
         * // => true
         *
         * _.isObject(1);
         * // => false
         */
        function isObject(value) {
            // check if the value is the ECMAScript language type of Object
            // http://es5.github.io/#x8
            // and avoid a V8 bug
            // http://code.google.com/p/v8/issues/detail?id=2291
            return !!(value && objectTypes[typeof value]);
        }
        /**
         * Checks if `value` is `NaN`.
         *
         * Note: This is not the same as native `isNaN` which will return `true` for
         * `undefined` and other non-numeric values. See http://es5.github.io/#x15.1.2.4.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is `NaN`, else `false`.
         * @example
         *
         * _.isNaN(NaN);
         * // => true
         *
         * _.isNaN(new Number(NaN));
         * // => true
         *
         * isNaN(undefined);
         * // => true
         *
         * _.isNaN(undefined);
         * // => false
         */
        function isNaN(value) {
            // `NaN` as a primitive is the only value that is not equal to itself
            // (perform the [[Class]] check first to avoid errors with some host objects in IE)
            return isNumber(value) && value != +value;
        }
        /**
         * Checks if `value` is `null`.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is `null`, else `false`.
         * @example
         *
         * _.isNull(null);
         * // => true
         *
         * _.isNull(undefined);
         * // => false
         */
        function isNull(value) {
            return value === null;
        }
        /**
         * Checks if `value` is a number.
         *
         * Note: `NaN` is considered a number. See http://es5.github.io/#x8.5.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is a number, else `false`.
         * @example
         *
         * _.isNumber(8.4 * 5);
         * // => true
         */
        function isNumber(value) {
            return typeof value == 'number' || value && typeof value == 'object' && toString.call(value) == numberClass || false;
        }
        /**
         * Checks if `value` is an object created by the `Object` constructor.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
         * @example
         *
         * function Shape() {
         *   this.x = 0;
         *   this.y = 0;
         * }
         *
         * _.isPlainObject(new Shape);
         * // => false
         *
         * _.isPlainObject([1, 2, 3]);
         * // => false
         *
         * _.isPlainObject({ 'x': 0, 'y': 0 });
         * // => true
         */
        var isPlainObject = !getPrototypeOf ? shimIsPlainObject : function (value) {
                if (!(value && toString.call(value) == objectClass) || !support.argsClass && isArguments(value)) {
                    return false;
                }
                var valueOf = value.valueOf, objProto = typeof valueOf == 'function' && (objProto = getPrototypeOf(valueOf)) && getPrototypeOf(objProto);
                return objProto ? value == objProto || getPrototypeOf(value) == objProto : shimIsPlainObject(value);
            };
        /**
         * Checks if `value` is a regular expression.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is a regular expression, else `false`.
         * @example
         *
         * _.isRegExp(/fred/);
         * // => true
         */
        function isRegExp(value) {
            return value && objectTypes[typeof value] && toString.call(value) == regexpClass || false;
        }
        /**
         * Checks if `value` is a string.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is a string, else `false`.
         * @example
         *
         * _.isString('fred');
         * // => true
         */
        function isString(value) {
            return typeof value == 'string' || value && typeof value == 'object' && toString.call(value) == stringClass || false;
        }
        /**
         * Checks if `value` is `undefined`.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {*} value The value to check.
         * @returns {boolean} Returns `true` if the `value` is `undefined`, else `false`.
         * @example
         *
         * _.isUndefined(void 0);
         * // => true
         */
        function isUndefined(value) {
            return typeof value == 'undefined';
        }
        /**
         * Recursively merges own enumerable properties of the source object(s), that
         * don't resolve to `undefined` into the destination object. Subsequent sources
         * will overwrite property assignments of previous sources. If a callback is
         * provided it will be executed to produce the merged values of the destination
         * and source properties. If the callback returns `undefined` merging will
         * be handled by the method instead. The callback is bound to `thisArg` and
         * invoked with two arguments; (objectValue, sourceValue).
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The destination object.
         * @param {...Object} [source] The source objects.
         * @param {Function} [callback] The function to customize merging properties.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns the destination object.
         * @example
         *
         * var names = {
         *   'characters': [
         *     { 'name': 'barney' },
         *     { 'name': 'fred' }
         *   ]
         * };
         *
         * var ages = {
         *   'characters': [
         *     { 'age': 36 },
         *     { 'age': 40 }
         *   ]
         * };
         *
         * _.merge(names, ages);
         * // => { 'characters': [{ 'name': 'barney', 'age': 36 }, { 'name': 'fred', 'age': 40 }] }
         *
         * var food = {
         *   'fruits': ['apple'],
         *   'vegetables': ['beet']
         * };
         *
         * var otherFood = {
         *   'fruits': ['banana'],
         *   'vegetables': ['carrot']
         * };
         *
         * _.merge(food, otherFood, function(a, b) {
         *   return _.isArray(a) ? a.concat(b) : undefined;
         * });
         * // => { 'fruits': ['apple', 'banana'], 'vegetables': ['beet', 'carrot] }
         */
        function merge(object) {
            var args = arguments, length = 2;
            if (!isObject(object)) {
                return object;
            }
            // allows working with `_.reduce` and `_.reduceRight` without using
            // their `index` and `collection` arguments
            if (typeof args[2] != 'number') {
                length = args.length;
            }
            if (length > 3 && typeof args[length - 2] == 'function') {
                var callback = baseCreateCallback(args[--length - 1], args[length--], 2);
            } else if (length > 2 && typeof args[length - 1] == 'function') {
                callback = args[--length];
            }
            var sources = slice(arguments, 1, length), index = -1, stackA = getArray(), stackB = getArray();
            while (++index < length) {
                baseMerge(object, sources[index], callback, stackA, stackB);
            }
            releaseArray(stackA);
            releaseArray(stackB);
            return object;
        }
        /**
         * Creates a shallow clone of `object` excluding the specified properties.
         * Property names may be specified as individual arguments or as arrays of
         * property names. If a callback is provided it will be executed for each
         * property of `object` omitting the properties the callback returns truey
         * for. The callback is bound to `thisArg` and invoked with three arguments;
         * (value, key, object).
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The source object.
         * @param {Function|...string|string[]} [callback] The properties to omit or the
         *  function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns an object without the omitted properties.
         * @example
         *
         * _.omit({ 'name': 'fred', 'age': 40 }, 'age');
         * // => { 'name': 'fred' }
         *
         * _.omit({ 'name': 'fred', 'age': 40 }, function(value) {
         *   return typeof value == 'number';
         * });
         * // => { 'name': 'fred' }
         */
        function omit(object, callback, thisArg) {
            var result = {};
            if (typeof callback != 'function') {
                var props = [];
                forIn(object, function (value, key) {
                    props.push(key);
                });
                props = baseDifference(props, baseFlatten(arguments, true, false, 1));
                var index = -1, length = props.length;
                while (++index < length) {
                    var key = props[index];
                    result[key] = object[key];
                }
            } else {
                callback = lodash.createCallback(callback, thisArg, 3);
                forIn(object, function (value, key, object) {
                    if (!callback(value, key, object)) {
                        result[key] = value;
                    }
                });
            }
            return result;
        }
        /**
         * Creates a two dimensional array of an object's key-value pairs,
         * i.e. `[[key1, value1], [key2, value2]]`.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to inspect.
         * @returns {Array} Returns new array of key-value pairs.
         * @example
         *
         * _.pairs({ 'barney': 36, 'fred': 40 });
         * // => [['barney', 36], ['fred', 40]] (property order is not guaranteed across environments)
         */
        function pairs(object) {
            var index = -1, props = keys(object), length = props.length, result = Array(length);
            while (++index < length) {
                var key = props[index];
                result[index] = [
                    key,
                    object[key]
                ];
            }
            return result;
        }
        /**
         * Creates a shallow clone of `object` composed of the specified properties.
         * Property names may be specified as individual arguments or as arrays of
         * property names. If a callback is provided it will be executed for each
         * property of `object` picking the properties the callback returns truey
         * for. The callback is bound to `thisArg` and invoked with three arguments;
         * (value, key, object).
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The source object.
         * @param {Function|...string|string[]} [callback] The function called per
         *  iteration or property names to pick, specified as individual property
         *  names or arrays of property names.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns an object composed of the picked properties.
         * @example
         *
         * _.pick({ 'name': 'fred', '_userid': 'fred1' }, 'name');
         * // => { 'name': 'fred' }
         *
         * _.pick({ 'name': 'fred', '_userid': 'fred1' }, function(value, key) {
         *   return key.charAt(0) != '_';
         * });
         * // => { 'name': 'fred' }
         */
        function pick(object, callback, thisArg) {
            var result = {};
            if (typeof callback != 'function') {
                var index = -1, props = baseFlatten(arguments, true, false, 1), length = isObject(object) ? props.length : 0;
                while (++index < length) {
                    var key = props[index];
                    if (key in object) {
                        result[key] = object[key];
                    }
                }
            } else {
                callback = lodash.createCallback(callback, thisArg, 3);
                forIn(object, function (value, key, object) {
                    if (callback(value, key, object)) {
                        result[key] = value;
                    }
                });
            }
            return result;
        }
        /**
         * An alternative to `_.reduce` this method transforms `object` to a new
         * `accumulator` object which is the result of running each of its elements
         * through a callback, with each callback execution potentially mutating
         * the `accumulator` object. The callback is bound to `thisArg` and invoked
         * with four arguments; (accumulator, value, key, object). Callbacks may exit
         * iteration early by explicitly returning `false`.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Array|Object} object The object to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [accumulator] The custom accumulator value.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the accumulated value.
         * @example
         *
         * var squares = _.transform([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], function(result, num) {
         *   num *= num;
         *   if (num % 2) {
         *     return result.push(num) < 3;
         *   }
         * });
         * // => [1, 9, 25]
         *
         * var mapped = _.transform({ 'a': 1, 'b': 2, 'c': 3 }, function(result, num, key) {
         *   result[key] = num * 3;
         * });
         * // => { 'a': 3, 'b': 6, 'c': 9 }
         */
        function transform(object, callback, accumulator, thisArg) {
            var isArr = isArray(object);
            if (accumulator == null) {
                if (isArr) {
                    accumulator = [];
                } else {
                    var ctor = object && object.constructor, proto = ctor && ctor.prototype;
                    accumulator = baseCreate(proto);
                }
            }
            if (callback) {
                callback = lodash.createCallback(callback, thisArg, 4);
                (isArr ? baseEach : forOwn)(object, function (value, index, object) {
                    return callback(accumulator, value, index, object);
                });
            }
            return accumulator;
        }
        /**
         * Creates an array composed of the own enumerable property values of `object`.
         *
         * @static
         * @memberOf _
         * @category Objects
         * @param {Object} object The object to inspect.
         * @returns {Array} Returns an array of property values.
         * @example
         *
         * _.values({ 'one': 1, 'two': 2, 'three': 3 });
         * // => [1, 2, 3] (property order is not guaranteed across environments)
         */
        function values(object) {
            var index = -1, props = keys(object), length = props.length, result = Array(length);
            while (++index < length) {
                result[index] = object[props[index]];
            }
            return result;
        }
        /*--------------------------------------------------------------------------*/
        /**
         * Creates an array of elements from the specified indexes, or keys, of the
         * `collection`. Indexes may be specified as individual arguments or as arrays
         * of indexes.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {...(number|number[]|string|string[])} [index] The indexes of `collection`
         *   to retrieve, specified as individual indexes or arrays of indexes.
         * @returns {Array} Returns a new array of elements corresponding to the
         *  provided indexes.
         * @example
         *
         * _.at(['a', 'b', 'c', 'd', 'e'], [0, 2, 4]);
         * // => ['a', 'c', 'e']
         *
         * _.at(['fred', 'barney', 'pebbles'], 0, 2);
         * // => ['fred', 'pebbles']
         */
        function at(collection) {
            var args = arguments, index = -1, props = baseFlatten(args, true, false, 1), length = args[2] && args[2][args[1]] === collection ? 1 : props.length, result = Array(length);
            if (support.unindexedChars && isString(collection)) {
                collection = collection.split('');
            }
            while (++index < length) {
                result[index] = collection[props[index]];
            }
            return result;
        }
        /**
         * Checks if a given value is present in a collection using strict equality
         * for comparisons, i.e. `===`. If `fromIndex` is negative, it is used as the
         * offset from the end of the collection.
         *
         * @static
         * @memberOf _
         * @alias include
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {*} target The value to check for.
         * @param {number} [fromIndex=0] The index to search from.
         * @returns {boolean} Returns `true` if the `target` element is found, else `false`.
         * @example
         *
         * _.contains([1, 2, 3], 1);
         * // => true
         *
         * _.contains([1, 2, 3], 1, 2);
         * // => false
         *
         * _.contains({ 'name': 'fred', 'age': 40 }, 'fred');
         * // => true
         *
         * _.contains('pebbles', 'eb');
         * // => true
         */
        function contains(collection, target, fromIndex) {
            var index = -1, indexOf = getIndexOf(), length = collection ? collection.length : 0, result = false;
            fromIndex = (fromIndex < 0 ? nativeMax(0, length + fromIndex) : fromIndex) || 0;
            if (isArray(collection)) {
                result = indexOf(collection, target, fromIndex) > -1;
            } else if (typeof length == 'number') {
                result = (isString(collection) ? collection.indexOf(target, fromIndex) : indexOf(collection, target, fromIndex)) > -1;
            } else {
                baseEach(collection, function (value) {
                    if (++index >= fromIndex) {
                        return !(result = value === target);
                    }
                });
            }
            return result;
        }
        /**
         * Creates an object composed of keys generated from the results of running
         * each element of `collection` through the callback. The corresponding value
         * of each key is the number of times the key was returned by the callback.
         * The callback is bound to `thisArg` and invoked with three arguments;
         * (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns the composed aggregate object.
         * @example
         *
         * _.countBy([4.3, 6.1, 6.4], function(num) { return Math.floor(num); });
         * // => { '4': 1, '6': 2 }
         *
         * _.countBy([4.3, 6.1, 6.4], function(num) { return this.floor(num); }, Math);
         * // => { '4': 1, '6': 2 }
         *
         * _.countBy(['one', 'two', 'three'], 'length');
         * // => { '3': 2, '5': 1 }
         */
        var countBy = createAggregator(function (result, value, key) {
                hasOwnProperty.call(result, key) ? result[key]++ : result[key] = 1;
            });
        /**
         * Checks if the given callback returns truey value for **all** elements of
         * a collection. The callback is bound to `thisArg` and invoked with three
         * arguments; (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias all
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {boolean} Returns `true` if all elements passed the callback check,
         *  else `false`.
         * @example
         *
         * _.every([true, 1, null, 'yes']);
         * // => false
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.every(characters, 'age');
         * // => true
         *
         * // using "_.where" callback shorthand
         * _.every(characters, { 'age': 36 });
         * // => false
         */
        function every(collection, callback, thisArg) {
            var result = true;
            callback = lodash.createCallback(callback, thisArg, 3);
            if (isArray(collection)) {
                var index = -1, length = collection.length;
                while (++index < length) {
                    if (!(result = !!callback(collection[index], index, collection))) {
                        break;
                    }
                }
            } else {
                baseEach(collection, function (value, index, collection) {
                    return result = !!callback(value, index, collection);
                });
            }
            return result;
        }
        /**
         * Iterates over elements of a collection, returning an array of all elements
         * the callback returns truey for. The callback is bound to `thisArg` and
         * invoked with three arguments; (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias select
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a new array of elements that passed the callback check.
         * @example
         *
         * var evens = _.filter([1, 2, 3, 4, 5, 6], function(num) { return num % 2 == 0; });
         * // => [2, 4, 6]
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36, 'blocked': false },
         *   { 'name': 'fred',   'age': 40, 'blocked': true }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.filter(characters, 'blocked');
         * // => [{ 'name': 'fred', 'age': 40, 'blocked': true }]
         *
         * // using "_.where" callback shorthand
         * _.filter(characters, { 'age': 36 });
         * // => [{ 'name': 'barney', 'age': 36, 'blocked': false }]
         */
        function filter(collection, callback, thisArg) {
            var result = [];
            callback = lodash.createCallback(callback, thisArg, 3);
            if (isArray(collection)) {
                var index = -1, length = collection.length;
                while (++index < length) {
                    var value = collection[index];
                    if (callback(value, index, collection)) {
                        result.push(value);
                    }
                }
            } else {
                baseEach(collection, function (value, index, collection) {
                    if (callback(value, index, collection)) {
                        result.push(value);
                    }
                });
            }
            return result;
        }
        /**
         * Iterates over elements of a collection, returning the first element that
         * the callback returns truey for. The callback is bound to `thisArg` and
         * invoked with three arguments; (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias detect, findWhere
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the found element, else `undefined`.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney',  'age': 36, 'blocked': false },
         *   { 'name': 'fred',    'age': 40, 'blocked': true },
         *   { 'name': 'pebbles', 'age': 1,  'blocked': false }
         * ];
         *
         * _.find(characters, function(chr) {
         *   return chr.age < 40;
         * });
         * // => { 'name': 'barney', 'age': 36, 'blocked': false }
         *
         * // using "_.where" callback shorthand
         * _.find(characters, { 'age': 1 });
         * // =>  { 'name': 'pebbles', 'age': 1, 'blocked': false }
         *
         * // using "_.pluck" callback shorthand
         * _.find(characters, 'blocked');
         * // => { 'name': 'fred', 'age': 40, 'blocked': true }
         */
        function find(collection, callback, thisArg) {
            callback = lodash.createCallback(callback, thisArg, 3);
            if (isArray(collection)) {
                var index = -1, length = collection.length;
                while (++index < length) {
                    var value = collection[index];
                    if (callback(value, index, collection)) {
                        return value;
                    }
                }
            } else {
                var result;
                baseEach(collection, function (value, index, collection) {
                    if (callback(value, index, collection)) {
                        result = value;
                        return false;
                    }
                });
                return result;
            }
        }
        /**
         * This method is like `_.find` except that it iterates over elements
         * of a `collection` from right to left.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the found element, else `undefined`.
         * @example
         *
         * _.findLast([1, 2, 3, 4], function(num) {
         *   return num % 2 == 1;
         * });
         * // => 3
         */
        function findLast(collection, callback, thisArg) {
            var result;
            callback = lodash.createCallback(callback, thisArg, 3);
            forEachRight(collection, function (value, index, collection) {
                if (callback(value, index, collection)) {
                    result = value;
                    return false;
                }
            });
            return result;
        }
        /**
         * Iterates over elements of a collection, executing the callback for each
         * element. The callback is bound to `thisArg` and invoked with three arguments;
         * (value, index|key, collection). Callbacks may exit iteration early by
         * explicitly returning `false`.
         *
         * Note: As with other "Collections" methods, objects with a `length` property
         * are iterated like arrays. To avoid this behavior `_.forIn` or `_.forOwn`
         * may be used for object iteration.
         *
         * @static
         * @memberOf _
         * @alias each
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array|Object|string} Returns `collection`.
         * @example
         *
         * _([1, 2, 3]).forEach(function(num) { console.log(num); }).join(',');
         * // => logs each number and returns '1,2,3'
         *
         * _.forEach({ 'one': 1, 'two': 2, 'three': 3 }, function(num) { console.log(num); });
         * // => logs each number and returns the object (property order is not guaranteed across environments)
         */
        function forEach(collection, callback, thisArg) {
            if (callback && typeof thisArg == 'undefined' && isArray(collection)) {
                var index = -1, length = collection.length;
                while (++index < length) {
                    if (callback(collection[index], index, collection) === false) {
                        break;
                    }
                }
            } else {
                baseEach(collection, callback, thisArg);
            }
            return collection;
        }
        /**
         * This method is like `_.forEach` except that it iterates over elements
         * of a `collection` from right to left.
         *
         * @static
         * @memberOf _
         * @alias eachRight
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array|Object|string} Returns `collection`.
         * @example
         *
         * _([1, 2, 3]).forEachRight(function(num) { console.log(num); }).join(',');
         * // => logs each number from right to left and returns '3,2,1'
         */
        function forEachRight(collection, callback, thisArg) {
            var iterable = collection, length = collection ? collection.length : 0;
            callback = callback && typeof thisArg == 'undefined' ? callback : baseCreateCallback(callback, thisArg, 3);
            if (isArray(collection)) {
                while (length--) {
                    if (callback(collection[length], length, collection) === false) {
                        break;
                    }
                }
            } else {
                if (typeof length != 'number') {
                    var props = keys(collection);
                    length = props.length;
                } else if (support.unindexedChars && isString(collection)) {
                    iterable = collection.split('');
                }
                baseEach(collection, function (value, key, collection) {
                    key = props ? props[--length] : --length;
                    return callback(iterable[key], key, collection);
                });
            }
            return collection;
        }
        /**
         * Creates an object composed of keys generated from the results of running
         * each element of a collection through the callback. The corresponding value
         * of each key is an array of the elements responsible for generating the key.
         * The callback is bound to `thisArg` and invoked with three arguments;
         * (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns the composed aggregate object.
         * @example
         *
         * _.groupBy([4.2, 6.1, 6.4], function(num) { return Math.floor(num); });
         * // => { '4': [4.2], '6': [6.1, 6.4] }
         *
         * _.groupBy([4.2, 6.1, 6.4], function(num) { return this.floor(num); }, Math);
         * // => { '4': [4.2], '6': [6.1, 6.4] }
         *
         * // using "_.pluck" callback shorthand
         * _.groupBy(['one', 'two', 'three'], 'length');
         * // => { '3': ['one', 'two'], '5': ['three'] }
         */
        var groupBy = createAggregator(function (result, value, key) {
                (hasOwnProperty.call(result, key) ? result[key] : result[key] = []).push(value);
            });
        /**
         * Creates an object composed of keys generated from the results of running
         * each element of the collection through the given callback. The corresponding
         * value of each key is the last element responsible for generating the key.
         * The callback is bound to `thisArg` and invoked with three arguments;
         * (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Object} Returns the composed aggregate object.
         * @example
         *
         * var keys = [
         *   { 'dir': 'left', 'code': 97 },
         *   { 'dir': 'right', 'code': 100 }
         * ];
         *
         * _.indexBy(keys, 'dir');
         * // => { 'left': { 'dir': 'left', 'code': 97 }, 'right': { 'dir': 'right', 'code': 100 } }
         *
         * _.indexBy(keys, function(key) { return String.fromCharCode(key.code); });
         * // => { 'a': { 'dir': 'left', 'code': 97 }, 'd': { 'dir': 'right', 'code': 100 } }
         *
         * _.indexBy(characters, function(key) { this.fromCharCode(key.code); }, String);
         * // => { 'a': { 'dir': 'left', 'code': 97 }, 'd': { 'dir': 'right', 'code': 100 } }
         */
        var indexBy = createAggregator(function (result, value, key) {
                result[key] = value;
            });
        /**
         * Invokes the method named by `methodName` on each element in the `collection`
         * returning an array of the results of each invoked method. Additional arguments
         * will be provided to each invoked method. If `methodName` is a function it
         * will be invoked for, and `this` bound to, each element in the `collection`.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|string} methodName The name of the method to invoke or
         *  the function invoked per iteration.
         * @param {...*} [arg] Arguments to invoke the method with.
         * @returns {Array} Returns a new array of the results of each invoked method.
         * @example
         *
         * _.invoke([[5, 1, 7], [3, 2, 1]], 'sort');
         * // => [[1, 5, 7], [1, 2, 3]]
         *
         * _.invoke([123, 456], String.prototype.split, '');
         * // => [['1', '2', '3'], ['4', '5', '6']]
         */
        function invoke(collection, methodName) {
            var args = slice(arguments, 2), index = -1, isFunc = typeof methodName == 'function', length = collection ? collection.length : 0, result = Array(typeof length == 'number' ? length : 0);
            forEach(collection, function (value) {
                result[++index] = (isFunc ? methodName : value[methodName]).apply(value, args);
            });
            return result;
        }
        /**
         * Creates an array of values by running each element in the collection
         * through the callback. The callback is bound to `thisArg` and invoked with
         * three arguments; (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias collect
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a new array of the results of each `callback` execution.
         * @example
         *
         * _.map([1, 2, 3], function(num) { return num * 3; });
         * // => [3, 6, 9]
         *
         * _.map({ 'one': 1, 'two': 2, 'three': 3 }, function(num) { return num * 3; });
         * // => [3, 6, 9] (property order is not guaranteed across environments)
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.map(characters, 'name');
         * // => ['barney', 'fred']
         */
        function map(collection, callback, thisArg) {
            var index = -1, length = collection ? collection.length : 0, result = Array(typeof length == 'number' ? length : 0);
            callback = lodash.createCallback(callback, thisArg, 3);
            if (isArray(collection)) {
                while (++index < length) {
                    result[index] = callback(collection[index], index, collection);
                }
            } else {
                baseEach(collection, function (value, key, collection) {
                    result[++index] = callback(value, key, collection);
                });
            }
            return result;
        }
        /**
         * Retrieves the maximum value of a collection. If the collection is empty or
         * falsey `-Infinity` is returned. If a callback is provided it will be executed
         * for each value in the collection to generate the criterion by which the value
         * is ranked. The callback is bound to `thisArg` and invoked with three
         * arguments; (value, index, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the maximum value.
         * @example
         *
         * _.max([4, 2, 8, 6]);
         * // => 8
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * _.max(characters, function(chr) { return chr.age; });
         * // => { 'name': 'fred', 'age': 40 };
         *
         * // using "_.pluck" callback shorthand
         * _.max(characters, 'age');
         * // => { 'name': 'fred', 'age': 40 };
         */
        function max(collection, callback, thisArg) {
            var computed = -Infinity, result = computed;
            // allows working with functions like `_.map` without using
            // their `index` argument as a callback
            if (typeof callback != 'function' && thisArg && thisArg[callback] === collection) {
                callback = null;
            }
            if (callback == null && isArray(collection)) {
                var index = -1, length = collection.length;
                while (++index < length) {
                    var value = collection[index];
                    if (value > result) {
                        result = value;
                    }
                }
            } else {
                callback = callback == null && isString(collection) ? charAtCallback : lodash.createCallback(callback, thisArg, 3);
                baseEach(collection, function (value, index, collection) {
                    var current = callback(value, index, collection);
                    if (current > computed) {
                        computed = current;
                        result = value;
                    }
                });
            }
            return result;
        }
        /**
         * Retrieves the minimum value of a collection. If the collection is empty or
         * falsey `Infinity` is returned. If a callback is provided it will be executed
         * for each value in the collection to generate the criterion by which the value
         * is ranked. The callback is bound to `thisArg` and invoked with three
         * arguments; (value, index, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the minimum value.
         * @example
         *
         * _.min([4, 2, 8, 6]);
         * // => 2
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * _.min(characters, function(chr) { return chr.age; });
         * // => { 'name': 'barney', 'age': 36 };
         *
         * // using "_.pluck" callback shorthand
         * _.min(characters, 'age');
         * // => { 'name': 'barney', 'age': 36 };
         */
        function min(collection, callback, thisArg) {
            var computed = Infinity, result = computed;
            // allows working with functions like `_.map` without using
            // their `index` argument as a callback
            if (typeof callback != 'function' && thisArg && thisArg[callback] === collection) {
                callback = null;
            }
            if (callback == null && isArray(collection)) {
                var index = -1, length = collection.length;
                while (++index < length) {
                    var value = collection[index];
                    if (value < result) {
                        result = value;
                    }
                }
            } else {
                callback = callback == null && isString(collection) ? charAtCallback : lodash.createCallback(callback, thisArg, 3);
                baseEach(collection, function (value, index, collection) {
                    var current = callback(value, index, collection);
                    if (current < computed) {
                        computed = current;
                        result = value;
                    }
                });
            }
            return result;
        }
        /**
         * Retrieves the value of a specified property from all elements in the collection.
         *
         * @static
         * @memberOf _
         * @type Function
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {string} property The property to pluck.
         * @returns {Array} Returns a new array of property values.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * _.pluck(characters, 'name');
         * // => ['barney', 'fred']
         */
        var pluck = map;
        /**
         * Reduces a collection to a value which is the accumulated result of running
         * each element in the collection through the callback, where each successive
         * callback execution consumes the return value of the previous execution. If
         * `accumulator` is not provided the first element of the collection will be
         * used as the initial `accumulator` value. The callback is bound to `thisArg`
         * and invoked with four arguments; (accumulator, value, index|key, collection).
         *
         * @static
         * @memberOf _
         * @alias foldl, inject
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [accumulator] Initial value of the accumulator.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the accumulated value.
         * @example
         *
         * var sum = _.reduce([1, 2, 3], function(sum, num) {
         *   return sum + num;
         * });
         * // => 6
         *
         * var mapped = _.reduce({ 'a': 1, 'b': 2, 'c': 3 }, function(result, num, key) {
         *   result[key] = num * 3;
         *   return result;
         * }, {});
         * // => { 'a': 3, 'b': 6, 'c': 9 }
         */
        function reduce(collection, callback, accumulator, thisArg) {
            var noaccum = arguments.length < 3;
            callback = lodash.createCallback(callback, thisArg, 4);
            if (isArray(collection)) {
                var index = -1, length = collection.length;
                if (noaccum) {
                    accumulator = collection[++index];
                }
                while (++index < length) {
                    accumulator = callback(accumulator, collection[index], index, collection);
                }
            } else {
                baseEach(collection, function (value, index, collection) {
                    accumulator = noaccum ? (noaccum = false, value) : callback(accumulator, value, index, collection);
                });
            }
            return accumulator;
        }
        /**
         * This method is like `_.reduce` except that it iterates over elements
         * of a `collection` from right to left.
         *
         * @static
         * @memberOf _
         * @alias foldr
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function} [callback=identity] The function called per iteration.
         * @param {*} [accumulator] Initial value of the accumulator.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the accumulated value.
         * @example
         *
         * var list = [[0, 1], [2, 3], [4, 5]];
         * var flat = _.reduceRight(list, function(a, b) { return a.concat(b); }, []);
         * // => [4, 5, 2, 3, 0, 1]
         */
        function reduceRight(collection, callback, accumulator, thisArg) {
            var noaccum = arguments.length < 3;
            callback = lodash.createCallback(callback, thisArg, 4);
            forEachRight(collection, function (value, index, collection) {
                accumulator = noaccum ? (noaccum = false, value) : callback(accumulator, value, index, collection);
            });
            return accumulator;
        }
        /**
         * The opposite of `_.filter` this method returns the elements of a
         * collection that the callback does **not** return truey for.
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a new array of elements that failed the callback check.
         * @example
         *
         * var odds = _.reject([1, 2, 3, 4, 5, 6], function(num) { return num % 2 == 0; });
         * // => [1, 3, 5]
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36, 'blocked': false },
         *   { 'name': 'fred',   'age': 40, 'blocked': true }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.reject(characters, 'blocked');
         * // => [{ 'name': 'barney', 'age': 36, 'blocked': false }]
         *
         * // using "_.where" callback shorthand
         * _.reject(characters, { 'age': 36 });
         * // => [{ 'name': 'fred', 'age': 40, 'blocked': true }]
         */
        function reject(collection, callback, thisArg) {
            callback = lodash.createCallback(callback, thisArg, 3);
            return filter(collection, function (value, index, collection) {
                return !callback(value, index, collection);
            });
        }
        /**
         * Retrieves a random element or `n` random elements from a collection.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to sample.
         * @param {number} [n] The number of elements to sample.
         * @param- {Object} [guard] Allows working with functions like `_.map`
         *  without using their `index` arguments as `n`.
         * @returns {Array} Returns the random sample(s) of `collection`.
         * @example
         *
         * _.sample([1, 2, 3, 4]);
         * // => 2
         *
         * _.sample([1, 2, 3, 4], 2);
         * // => [3, 1]
         */
        function sample(collection, n, guard) {
            if (collection && typeof collection.length != 'number') {
                collection = values(collection);
            } else if (support.unindexedChars && isString(collection)) {
                collection = collection.split('');
            }
            if (n == null || guard) {
                return collection ? collection[baseRandom(0, collection.length - 1)] : undefined;
            }
            var result = shuffle(collection);
            result.length = nativeMin(nativeMax(0, n), result.length);
            return result;
        }
        /**
         * Creates an array of shuffled values, using a version of the Fisher-Yates
         * shuffle. See http://en.wikipedia.org/wiki/Fisher-Yates_shuffle.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to shuffle.
         * @returns {Array} Returns a new shuffled collection.
         * @example
         *
         * _.shuffle([1, 2, 3, 4, 5, 6]);
         * // => [4, 1, 6, 3, 5, 2]
         */
        function shuffle(collection) {
            var index = -1, length = collection ? collection.length : 0, result = Array(typeof length == 'number' ? length : 0);
            forEach(collection, function (value) {
                var rand = baseRandom(0, ++index);
                result[index] = result[rand];
                result[rand] = value;
            });
            return result;
        }
        /**
         * Gets the size of the `collection` by returning `collection.length` for arrays
         * and array-like objects or the number of own enumerable properties for objects.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to inspect.
         * @returns {number} Returns `collection.length` or number of own enumerable properties.
         * @example
         *
         * _.size([1, 2]);
         * // => 2
         *
         * _.size({ 'one': 1, 'two': 2, 'three': 3 });
         * // => 3
         *
         * _.size('pebbles');
         * // => 5
         */
        function size(collection) {
            var length = collection ? collection.length : 0;
            return typeof length == 'number' ? length : keys(collection).length;
        }
        /**
         * Checks if the callback returns a truey value for **any** element of a
         * collection. The function returns as soon as it finds a passing value and
         * does not iterate over the entire collection. The callback is bound to
         * `thisArg` and invoked with three arguments; (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias any
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {boolean} Returns `true` if any element passed the callback check,
         *  else `false`.
         * @example
         *
         * _.some([null, 0, 'yes', false], Boolean);
         * // => true
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36, 'blocked': false },
         *   { 'name': 'fred',   'age': 40, 'blocked': true }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.some(characters, 'blocked');
         * // => true
         *
         * // using "_.where" callback shorthand
         * _.some(characters, { 'age': 1 });
         * // => false
         */
        function some(collection, callback, thisArg) {
            var result;
            callback = lodash.createCallback(callback, thisArg, 3);
            if (isArray(collection)) {
                var index = -1, length = collection.length;
                while (++index < length) {
                    if (result = callback(collection[index], index, collection)) {
                        break;
                    }
                }
            } else {
                baseEach(collection, function (value, index, collection) {
                    return !(result = callback(value, index, collection));
                });
            }
            return !!result;
        }
        /**
         * Creates an array of elements, sorted in ascending order by the results of
         * running each element in a collection through the callback. This method
         * performs a stable sort, that is, it will preserve the original sort order
         * of equal elements. The callback is bound to `thisArg` and invoked with
         * three arguments; (value, index|key, collection).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a new array of sorted elements.
         * @example
         *
         * _.sortBy([1, 2, 3], function(num) { return Math.sin(num); });
         * // => [3, 1, 2]
         *
         * _.sortBy([1, 2, 3], function(num) { return this.sin(num); }, Math);
         * // => [3, 1, 2]
         *
         * // using "_.pluck" callback shorthand
         * _.sortBy(['banana', 'strawberry', 'apple'], 'length');
         * // => ['apple', 'banana', 'strawberry']
         */
        function sortBy(collection, callback, thisArg) {
            var index = -1, length = collection ? collection.length : 0, result = Array(typeof length == 'number' ? length : 0);
            callback = lodash.createCallback(callback, thisArg, 3);
            forEach(collection, function (value, key, collection) {
                var object = result[++index] = getObject();
                object.criteria = callback(value, key, collection);
                object.index = index;
                object.value = value;
            });
            length = result.length;
            result.sort(compareAscending);
            while (length--) {
                var object = result[length];
                result[length] = object.value;
                releaseObject(object);
            }
            return result;
        }
        /**
         * Converts the `collection` to an array.
         *
         * @static
         * @memberOf _
         * @category Collections
         * @param {Array|Object|string} collection The collection to convert.
         * @returns {Array} Returns the new converted array.
         * @example
         *
         * (function() { return _.toArray(arguments).slice(1); })(1, 2, 3, 4);
         * // => [2, 3, 4]
         */
        function toArray(collection) {
            if (collection && typeof collection.length == 'number') {
                return support.unindexedChars && isString(collection) ? collection.split('') : slice(collection);
            }
            return values(collection);
        }
        /**
         * Performs a deep comparison of each element in a `collection` to the given
         * `properties` object, returning an array of all elements that have equivalent
         * property values.
         *
         * @static
         * @memberOf _
         * @type Function
         * @category Collections
         * @param {Array|Object|string} collection The collection to iterate over.
         * @param {Object} properties The object of property values to filter by.
         * @returns {Array} Returns a new array of elements that have the given properties.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36, 'pets': ['hoppy'] },
         *   { 'name': 'fred',   'age': 40, 'pets': ['baby puss', 'dino'] }
         * ];
         *
         * _.where(characters, { 'age': 36 });
         * // => [{ 'name': 'barney', 'age': 36, 'pets': ['hoppy'] }]
         *
         * _.where(characters, { 'pets': ['dino'] });
         * // => [{ 'name': 'fred', 'age': 40, 'pets': ['baby puss', 'dino'] }]
         */
        var where = filter;
        /*--------------------------------------------------------------------------*/
        /**
         * Creates an array with all falsey values removed. The values `false`, `null`,
         * `0`, `""`, `undefined`, and `NaN` are all falsey.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to compact.
         * @returns {Array} Returns a new array of filtered values.
         * @example
         *
         * _.compact([0, 1, false, 2, '', 3]);
         * // => [1, 2, 3]
         */
        function compact(array) {
            var index = -1, length = array ? array.length : 0, result = [];
            while (++index < length) {
                var value = array[index];
                if (value) {
                    result.push(value);
                }
            }
            return result;
        }
        /**
         * Creates an array excluding all values of the provided arrays using strict
         * equality for comparisons, i.e. `===`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to process.
         * @param {...Array} [values] The arrays of values to exclude.
         * @returns {Array} Returns a new array of filtered values.
         * @example
         *
         * _.difference([1, 2, 3, 4, 5], [5, 2, 10]);
         * // => [1, 3, 4]
         */
        function difference(array) {
            return baseDifference(array, baseFlatten(arguments, true, true, 1));
        }
        /**
         * This method is like `_.find` except that it returns the index of the first
         * element that passes the callback check, instead of the element itself.
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to search.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {number} Returns the index of the found element, else `-1`.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney',  'age': 36, 'blocked': false },
         *   { 'name': 'fred',    'age': 40, 'blocked': true },
         *   { 'name': 'pebbles', 'age': 1,  'blocked': false }
         * ];
         *
         * _.findIndex(characters, function(chr) {
         *   return chr.age < 20;
         * });
         * // => 2
         *
         * // using "_.where" callback shorthand
         * _.findIndex(characters, { 'age': 36 });
         * // => 0
         *
         * // using "_.pluck" callback shorthand
         * _.findIndex(characters, 'blocked');
         * // => 1
         */
        function findIndex(array, callback, thisArg) {
            var index = -1, length = array ? array.length : 0;
            callback = lodash.createCallback(callback, thisArg, 3);
            while (++index < length) {
                if (callback(array[index], index, array)) {
                    return index;
                }
            }
            return -1;
        }
        /**
         * This method is like `_.findIndex` except that it iterates over elements
         * of a `collection` from right to left.
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to search.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {number} Returns the index of the found element, else `-1`.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney',  'age': 36, 'blocked': true },
         *   { 'name': 'fred',    'age': 40, 'blocked': false },
         *   { 'name': 'pebbles', 'age': 1,  'blocked': true }
         * ];
         *
         * _.findLastIndex(characters, function(chr) {
         *   return chr.age > 30;
         * });
         * // => 1
         *
         * // using "_.where" callback shorthand
         * _.findLastIndex(characters, { 'age': 36 });
         * // => 0
         *
         * // using "_.pluck" callback shorthand
         * _.findLastIndex(characters, 'blocked');
         * // => 2
         */
        function findLastIndex(array, callback, thisArg) {
            var length = array ? array.length : 0;
            callback = lodash.createCallback(callback, thisArg, 3);
            while (length--) {
                if (callback(array[length], length, array)) {
                    return length;
                }
            }
            return -1;
        }
        /**
         * Gets the first element or first `n` elements of an array. If a callback
         * is provided elements at the beginning of the array are returned as long
         * as the callback returns truey. The callback is bound to `thisArg` and
         * invoked with three arguments; (value, index, array).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias head, take
         * @category Arrays
         * @param {Array} array The array to query.
         * @param {Function|Object|number|string} [callback] The function called
         *  per element or the number of elements to return. If a property name or
         *  object is provided it will be used to create a "_.pluck" or "_.where"
         *  style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the first element(s) of `array`.
         * @example
         *
         * _.first([1, 2, 3]);
         * // => 1
         *
         * _.first([1, 2, 3], 2);
         * // => [1, 2]
         *
         * _.first([1, 2, 3], function(num) {
         *   return num < 3;
         * });
         * // => [1, 2]
         *
         * var characters = [
         *   { 'name': 'barney',  'blocked': true,  'employer': 'slate' },
         *   { 'name': 'fred',    'blocked': false, 'employer': 'slate' },
         *   { 'name': 'pebbles', 'blocked': true,  'employer': 'na' }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.first(characters, 'blocked');
         * // => [{ 'name': 'barney', 'blocked': true, 'employer': 'slate' }]
         *
         * // using "_.where" callback shorthand
         * _.pluck(_.first(characters, { 'employer': 'slate' }), 'name');
         * // => ['barney', 'fred']
         */
        function first(array, callback, thisArg) {
            var n = 0, length = array ? array.length : 0;
            if (typeof callback != 'number' && callback != null) {
                var index = -1;
                callback = lodash.createCallback(callback, thisArg, 3);
                while (++index < length && callback(array[index], index, array)) {
                    n++;
                }
            } else {
                n = callback;
                if (n == null || thisArg) {
                    return array ? array[0] : undefined;
                }
            }
            return slice(array, 0, nativeMin(nativeMax(0, n), length));
        }
        /**
         * Flattens a nested array (the nesting can be to any depth). If `isShallow`
         * is truey, the array will only be flattened a single level. If a callback
         * is provided each element of the array is passed through the callback before
         * flattening. The callback is bound to `thisArg` and invoked with three
         * arguments; (value, index, array).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to flatten.
         * @param {boolean} [isShallow=false] A flag to restrict flattening to a single level.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a new flattened array.
         * @example
         *
         * _.flatten([1, [2], [3, [[4]]]]);
         * // => [1, 2, 3, 4];
         *
         * _.flatten([1, [2], [3, [[4]]]], true);
         * // => [1, 2, 3, [[4]]];
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 30, 'pets': ['hoppy'] },
         *   { 'name': 'fred',   'age': 40, 'pets': ['baby puss', 'dino'] }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.flatten(characters, 'pets');
         * // => ['hoppy', 'baby puss', 'dino']
         */
        function flatten(array, isShallow, callback, thisArg) {
            // juggle arguments
            if (typeof isShallow != 'boolean' && isShallow != null) {
                thisArg = callback;
                callback = typeof isShallow != 'function' && thisArg && thisArg[isShallow] === array ? null : isShallow;
                isShallow = false;
            }
            if (callback != null) {
                array = map(array, callback, thisArg);
            }
            return baseFlatten(array, isShallow);
        }
        /**
         * Gets the index at which the first occurrence of `value` is found using
         * strict equality for comparisons, i.e. `===`. If the array is already sorted
         * providing `true` for `fromIndex` will run a faster binary search.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to search.
         * @param {*} value The value to search for.
         * @param {boolean|number} [fromIndex=0] The index to search from or `true`
         *  to perform a binary search on a sorted array.
         * @returns {number} Returns the index of the matched value or `-1`.
         * @example
         *
         * _.indexOf([1, 2, 3, 1, 2, 3], 2);
         * // => 1
         *
         * _.indexOf([1, 2, 3, 1, 2, 3], 2, 3);
         * // => 4
         *
         * _.indexOf([1, 1, 2, 2, 3, 3], 2, true);
         * // => 2
         */
        function indexOf(array, value, fromIndex) {
            if (typeof fromIndex == 'number') {
                var length = array ? array.length : 0;
                fromIndex = fromIndex < 0 ? nativeMax(0, length + fromIndex) : fromIndex || 0;
            } else if (fromIndex) {
                var index = sortedIndex(array, value);
                return array[index] === value ? index : -1;
            }
            return baseIndexOf(array, value, fromIndex);
        }
        /**
         * Gets all but the last element or last `n` elements of an array. If a
         * callback is provided elements at the end of the array are excluded from
         * the result as long as the callback returns truey. The callback is bound
         * to `thisArg` and invoked with three arguments; (value, index, array).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to query.
         * @param {Function|Object|number|string} [callback=1] The function called
         *  per element or the number of elements to exclude. If a property name or
         *  object is provided it will be used to create a "_.pluck" or "_.where"
         *  style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a slice of `array`.
         * @example
         *
         * _.initial([1, 2, 3]);
         * // => [1, 2]
         *
         * _.initial([1, 2, 3], 2);
         * // => [1]
         *
         * _.initial([1, 2, 3], function(num) {
         *   return num > 1;
         * });
         * // => [1]
         *
         * var characters = [
         *   { 'name': 'barney',  'blocked': false, 'employer': 'slate' },
         *   { 'name': 'fred',    'blocked': true,  'employer': 'slate' },
         *   { 'name': 'pebbles', 'blocked': true,  'employer': 'na' }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.initial(characters, 'blocked');
         * // => [{ 'name': 'barney',  'blocked': false, 'employer': 'slate' }]
         *
         * // using "_.where" callback shorthand
         * _.pluck(_.initial(characters, { 'employer': 'na' }), 'name');
         * // => ['barney', 'fred']
         */
        function initial(array, callback, thisArg) {
            var n = 0, length = array ? array.length : 0;
            if (typeof callback != 'number' && callback != null) {
                var index = length;
                callback = lodash.createCallback(callback, thisArg, 3);
                while (index-- && callback(array[index], index, array)) {
                    n++;
                }
            } else {
                n = callback == null || thisArg ? 1 : callback || n;
            }
            return slice(array, 0, nativeMin(nativeMax(0, length - n), length));
        }
        /**
         * Creates an array of unique values present in all provided arrays using
         * strict equality for comparisons, i.e. `===`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {...Array} [array] The arrays to inspect.
         * @returns {Array} Returns an array of composite values.
         * @example
         *
         * _.intersection([1, 2, 3], [101, 2, 1, 10], [2, 1]);
         * // => [1, 2]
         */
        function intersection(array) {
            var args = arguments, argsLength = args.length, argsIndex = -1, caches = getArray(), index = -1, indexOf = getIndexOf(), length = array ? array.length : 0, result = [], seen = getArray();
            while (++argsIndex < argsLength) {
                var value = args[argsIndex];
                caches[argsIndex] = indexOf === baseIndexOf && (value ? value.length : 0) >= largeArraySize && createCache(argsIndex ? args[argsIndex] : seen);
            }
            outer:
                while (++index < length) {
                    var cache = caches[0];
                    value = array[index];
                    if ((cache ? cacheIndexOf(cache, value) : indexOf(seen, value)) < 0) {
                        argsIndex = argsLength;
                        (cache || seen).push(value);
                        while (--argsIndex) {
                            cache = caches[argsIndex];
                            if ((cache ? cacheIndexOf(cache, value) : indexOf(args[argsIndex], value)) < 0) {
                                continue outer;
                            }
                        }
                        result.push(value);
                    }
                }
            while (argsLength--) {
                cache = caches[argsLength];
                if (cache) {
                    releaseObject(cache);
                }
            }
            releaseArray(caches);
            releaseArray(seen);
            return result;
        }
        /**
         * Gets the last element or last `n` elements of an array. If a callback is
         * provided elements at the end of the array are returned as long as the
         * callback returns truey. The callback is bound to `thisArg` and invoked
         * with three arguments; (value, index, array).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to query.
         * @param {Function|Object|number|string} [callback] The function called
         *  per element or the number of elements to return. If a property name or
         *  object is provided it will be used to create a "_.pluck" or "_.where"
         *  style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {*} Returns the last element(s) of `array`.
         * @example
         *
         * _.last([1, 2, 3]);
         * // => 3
         *
         * _.last([1, 2, 3], 2);
         * // => [2, 3]
         *
         * _.last([1, 2, 3], function(num) {
         *   return num > 1;
         * });
         * // => [2, 3]
         *
         * var characters = [
         *   { 'name': 'barney',  'blocked': false, 'employer': 'slate' },
         *   { 'name': 'fred',    'blocked': true,  'employer': 'slate' },
         *   { 'name': 'pebbles', 'blocked': true,  'employer': 'na' }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.pluck(_.last(characters, 'blocked'), 'name');
         * // => ['fred', 'pebbles']
         *
         * // using "_.where" callback shorthand
         * _.last(characters, { 'employer': 'na' });
         * // => [{ 'name': 'pebbles', 'blocked': true, 'employer': 'na' }]
         */
        function last(array, callback, thisArg) {
            var n = 0, length = array ? array.length : 0;
            if (typeof callback != 'number' && callback != null) {
                var index = length;
                callback = lodash.createCallback(callback, thisArg, 3);
                while (index-- && callback(array[index], index, array)) {
                    n++;
                }
            } else {
                n = callback;
                if (n == null || thisArg) {
                    return array ? array[length - 1] : undefined;
                }
            }
            return slice(array, nativeMax(0, length - n));
        }
        /**
         * Gets the index at which the last occurrence of `value` is found using strict
         * equality for comparisons, i.e. `===`. If `fromIndex` is negative, it is used
         * as the offset from the end of the collection.
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to search.
         * @param {*} value The value to search for.
         * @param {number} [fromIndex=array.length-1] The index to search from.
         * @returns {number} Returns the index of the matched value or `-1`.
         * @example
         *
         * _.lastIndexOf([1, 2, 3, 1, 2, 3], 2);
         * // => 4
         *
         * _.lastIndexOf([1, 2, 3, 1, 2, 3], 2, 3);
         * // => 1
         */
        function lastIndexOf(array, value, fromIndex) {
            var index = array ? array.length : 0;
            if (typeof fromIndex == 'number') {
                index = (fromIndex < 0 ? nativeMax(0, index + fromIndex) : nativeMin(fromIndex, index - 1)) + 1;
            }
            while (index--) {
                if (array[index] === value) {
                    return index;
                }
            }
            return -1;
        }
        /**
         * Removes all provided values from the given array using strict equality for
         * comparisons, i.e. `===`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to modify.
         * @param {...*} [value] The values to remove.
         * @returns {Array} Returns `array`.
         * @example
         *
         * var array = [1, 2, 3, 1, 2, 3];
         * _.pull(array, 2, 3);
         * console.log(array);
         * // => [1, 1]
         */
        function pull(array) {
            var args = arguments, argsIndex = 0, argsLength = args.length, length = array ? array.length : 0;
            while (++argsIndex < argsLength) {
                var index = -1, value = args[argsIndex];
                while (++index < length) {
                    if (array[index] === value) {
                        splice.call(array, index--, 1);
                        length--;
                    }
                }
            }
            return array;
        }
        /**
         * Creates an array of numbers (positive and/or negative) progressing from
         * `start` up to but not including `end`. If `start` is less than `stop` a
         * zero-length range is created unless a negative `step` is specified.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {number} [start=0] The start of the range.
         * @param {number} end The end of the range.
         * @param {number} [step=1] The value to increment or decrement by.
         * @returns {Array} Returns a new range array.
         * @example
         *
         * _.range(4);
         * // => [0, 1, 2, 3]
         *
         * _.range(1, 5);
         * // => [1, 2, 3, 4]
         *
         * _.range(0, 20, 5);
         * // => [0, 5, 10, 15]
         *
         * _.range(0, -4, -1);
         * // => [0, -1, -2, -3]
         *
         * _.range(1, 4, 0);
         * // => [1, 1, 1]
         *
         * _.range(0);
         * // => []
         */
        function range(start, end, step) {
            start = +start || 0;
            step = typeof step == 'number' ? step : +step || 1;
            if (end == null) {
                end = start;
                start = 0;
            }
            // use `Array(length)` so engines like Chakra and V8 avoid slower modes
            // http://youtu.be/XAqIpGU8ZZk#t=17m25s
            var index = -1, length = nativeMax(0, ceil((end - start) / (step || 1))), result = Array(length);
            while (++index < length) {
                result[index] = start;
                start += step;
            }
            return result;
        }
        /**
         * Removes all elements from an array that the callback returns truey for
         * and returns an array of removed elements. The callback is bound to `thisArg`
         * and invoked with three arguments; (value, index, array).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to modify.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a new array of removed elements.
         * @example
         *
         * var array = [1, 2, 3, 4, 5, 6];
         * var evens = _.remove(array, function(num) { return num % 2 == 0; });
         *
         * console.log(array);
         * // => [1, 3, 5]
         *
         * console.log(evens);
         * // => [2, 4, 6]
         */
        function remove(array, callback, thisArg) {
            var index = -1, length = array ? array.length : 0, result = [];
            callback = lodash.createCallback(callback, thisArg, 3);
            while (++index < length) {
                var value = array[index];
                if (callback(value, index, array)) {
                    result.push(value);
                    splice.call(array, index--, 1);
                    length--;
                }
            }
            return result;
        }
        /**
         * The opposite of `_.initial` this method gets all but the first element or
         * first `n` elements of an array. If a callback function is provided elements
         * at the beginning of the array are excluded from the result as long as the
         * callback returns truey. The callback is bound to `thisArg` and invoked
         * with three arguments; (value, index, array).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias drop, tail
         * @category Arrays
         * @param {Array} array The array to query.
         * @param {Function|Object|number|string} [callback=1] The function called
         *  per element or the number of elements to exclude. If a property name or
         *  object is provided it will be used to create a "_.pluck" or "_.where"
         *  style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a slice of `array`.
         * @example
         *
         * _.rest([1, 2, 3]);
         * // => [2, 3]
         *
         * _.rest([1, 2, 3], 2);
         * // => [3]
         *
         * _.rest([1, 2, 3], function(num) {
         *   return num < 3;
         * });
         * // => [3]
         *
         * var characters = [
         *   { 'name': 'barney',  'blocked': true,  'employer': 'slate' },
         *   { 'name': 'fred',    'blocked': false,  'employer': 'slate' },
         *   { 'name': 'pebbles', 'blocked': true, 'employer': 'na' }
         * ];
         *
         * // using "_.pluck" callback shorthand
         * _.pluck(_.rest(characters, 'blocked'), 'name');
         * // => ['fred', 'pebbles']
         *
         * // using "_.where" callback shorthand
         * _.rest(characters, { 'employer': 'slate' });
         * // => [{ 'name': 'pebbles', 'blocked': true, 'employer': 'na' }]
         */
        function rest(array, callback, thisArg) {
            if (typeof callback != 'number' && callback != null) {
                var n = 0, index = -1, length = array ? array.length : 0;
                callback = lodash.createCallback(callback, thisArg, 3);
                while (++index < length && callback(array[index], index, array)) {
                    n++;
                }
            } else {
                n = callback == null || thisArg ? 1 : nativeMax(0, callback);
            }
            return slice(array, n);
        }
        /**
         * Uses a binary search to determine the smallest index at which a value
         * should be inserted into a given sorted array in order to maintain the sort
         * order of the array. If a callback is provided it will be executed for
         * `value` and each element of `array` to compute their sort ranking. The
         * callback is bound to `thisArg` and invoked with one argument; (value).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to inspect.
         * @param {*} value The value to evaluate.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {number} Returns the index at which `value` should be inserted
         *  into `array`.
         * @example
         *
         * _.sortedIndex([20, 30, 50], 40);
         * // => 2
         *
         * // using "_.pluck" callback shorthand
         * _.sortedIndex([{ 'x': 20 }, { 'x': 30 }, { 'x': 50 }], { 'x': 40 }, 'x');
         * // => 2
         *
         * var dict = {
         *   'wordToNumber': { 'twenty': 20, 'thirty': 30, 'fourty': 40, 'fifty': 50 }
         * };
         *
         * _.sortedIndex(['twenty', 'thirty', 'fifty'], 'fourty', function(word) {
         *   return dict.wordToNumber[word];
         * });
         * // => 2
         *
         * _.sortedIndex(['twenty', 'thirty', 'fifty'], 'fourty', function(word) {
         *   return this.wordToNumber[word];
         * }, dict);
         * // => 2
         */
        function sortedIndex(array, value, callback, thisArg) {
            var low = 0, high = array ? array.length : low;
            // explicitly reference `identity` for better inlining in Firefox
            callback = callback ? lodash.createCallback(callback, thisArg, 1) : identity;
            value = callback(value);
            while (low < high) {
                var mid = low + high >>> 1;
                callback(array[mid]) < value ? low = mid + 1 : high = mid;
            }
            return low;
        }
        /**
         * Creates an array of unique values, in order, of the provided arrays using
         * strict equality for comparisons, i.e. `===`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {...Array} [array] The arrays to inspect.
         * @returns {Array} Returns an array of composite values.
         * @example
         *
         * _.union([1, 2, 3], [101, 2, 1, 10], [2, 1]);
         * // => [1, 2, 3, 101, 10]
         */
        function union(array) {
            return baseUniq(baseFlatten(arguments, true, true));
        }
        /**
         * Creates a duplicate-value-free version of an array using strict equality
         * for comparisons, i.e. `===`. If the array is sorted, providing
         * `true` for `isSorted` will use a faster algorithm. If a callback is provided
         * each element of `array` is passed through the callback before uniqueness
         * is computed. The callback is bound to `thisArg` and invoked with three
         * arguments; (value, index, array).
         *
         * If a property name is provided for `callback` the created "_.pluck" style
         * callback will return the property value of the given element.
         *
         * If an object is provided for `callback` the created "_.where" style callback
         * will return `true` for elements that have the properties of the given object,
         * else `false`.
         *
         * @static
         * @memberOf _
         * @alias unique
         * @category Arrays
         * @param {Array} array The array to process.
         * @param {boolean} [isSorted=false] A flag to indicate that `array` is sorted.
         * @param {Function|Object|string} [callback=identity] The function called
         *  per iteration. If a property name or object is provided it will be used
         *  to create a "_.pluck" or "_.where" style callback, respectively.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns a duplicate-value-free array.
         * @example
         *
         * _.uniq([1, 2, 1, 3, 1]);
         * // => [1, 2, 3]
         *
         * _.uniq([1, 1, 2, 2, 3], true);
         * // => [1, 2, 3]
         *
         * _.uniq(['A', 'b', 'C', 'a', 'B', 'c'], function(letter) { return letter.toLowerCase(); });
         * // => ['A', 'b', 'C']
         *
         * _.uniq([1, 2.5, 3, 1.5, 2, 3.5], function(num) { return this.floor(num); }, Math);
         * // => [1, 2.5, 3]
         *
         * // using "_.pluck" callback shorthand
         * _.uniq([{ 'x': 1 }, { 'x': 2 }, { 'x': 1 }], 'x');
         * // => [{ 'x': 1 }, { 'x': 2 }]
         */
        function uniq(array, isSorted, callback, thisArg) {
            // juggle arguments
            if (typeof isSorted != 'boolean' && isSorted != null) {
                thisArg = callback;
                callback = typeof isSorted != 'function' && thisArg && thisArg[isSorted] === array ? null : isSorted;
                isSorted = false;
            }
            if (callback != null) {
                callback = lodash.createCallback(callback, thisArg, 3);
            }
            return baseUniq(array, isSorted, callback);
        }
        /**
         * Creates an array excluding all provided values using strict equality for
         * comparisons, i.e. `===`.
         *
         * @static
         * @memberOf _
         * @category Arrays
         * @param {Array} array The array to filter.
         * @param {...*} [value] The values to exclude.
         * @returns {Array} Returns a new array of filtered values.
         * @example
         *
         * _.without([1, 2, 1, 0, 3, 1, 4], 0, 1);
         * // => [2, 3, 4]
         */
        function without(array) {
            return baseDifference(array, slice(arguments, 1));
        }
        /**
         * Creates an array of grouped elements, the first of which contains the first
         * elements of the given arrays, the second of which contains the second
         * elements of the given arrays, and so on.
         *
         * @static
         * @memberOf _
         * @alias unzip
         * @category Arrays
         * @param {...Array} [array] Arrays to process.
         * @returns {Array} Returns a new array of grouped elements.
         * @example
         *
         * _.zip(['fred', 'barney'], [30, 40], [true, false]);
         * // => [['fred', 30, true], ['barney', 40, false]]
         */
        function zip() {
            var array = arguments.length > 1 ? arguments : arguments[0], index = -1, length = array ? max(pluck(array, 'length')) : 0, result = Array(length < 0 ? 0 : length);
            while (++index < length) {
                result[index] = pluck(array, index);
            }
            return result;
        }
        /**
         * Creates an object composed from arrays of `keys` and `values`. Provide
         * either a single two dimensional array, i.e. `[[key1, value1], [key2, value2]]`
         * or two arrays, one of `keys` and one of corresponding `values`.
         *
         * @static
         * @memberOf _
         * @alias object
         * @category Arrays
         * @param {Array} keys The array of keys.
         * @param {Array} [values=[]] The array of values.
         * @returns {Object} Returns an object composed of the given keys and
         *  corresponding values.
         * @example
         *
         * _.zipObject(['fred', 'barney'], [30, 40]);
         * // => { 'fred': 30, 'barney': 40 }
         */
        function zipObject(keys, values) {
            var index = -1, length = keys ? keys.length : 0, result = {};
            while (++index < length) {
                var key = keys[index];
                if (values) {
                    result[key] = values[index];
                } else if (key) {
                    result[key[0]] = key[1];
                }
            }
            return result;
        }
        /*--------------------------------------------------------------------------*/
        /**
         * Creates a function that executes `func`, with  the `this` binding and
         * arguments of the created function, only after being called `n` times.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {number} n The number of times the function must be called before
         *  `func` is executed.
         * @param {Function} func The function to restrict.
         * @returns {Function} Returns the new restricted function.
         * @example
         *
         * var saves = ['profile', 'settings'];
         *
         * var done = _.after(saves.length, function() {
         *   console.log('Done saving!');
         * });
         *
         * _.forEach(saves, function(type) {
         *   asyncSave({ 'type': type, 'complete': done });
         * });
         * // => logs 'Done saving!', after all saves have completed
         */
        function after(n, func) {
            if (!isFunction(func)) {
                throw new TypeError();
            }
            return function () {
                if (--n < 1) {
                    return func.apply(this, arguments);
                }
            };
        }
        /**
         * Creates a function that, when called, invokes `func` with the `this`
         * binding of `thisArg` and prepends any additional `bind` arguments to those
         * provided to the bound function.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to bind.
         * @param {*} [thisArg] The `this` binding of `func`.
         * @param {...*} [arg] Arguments to be partially applied.
         * @returns {Function} Returns the new bound function.
         * @example
         *
         * var func = function(greeting) {
         *   return greeting + ' ' + this.name;
         * };
         *
         * func = _.bind(func, { 'name': 'fred' }, 'hi');
         * func();
         * // => 'hi fred'
         */
        function bind(func, thisArg) {
            return arguments.length > 2 ? createWrapper(func, 17, slice(arguments, 2), null, thisArg) : createWrapper(func, 1, null, null, thisArg);
        }
        /**
         * Binds methods of an object to the object itself, overwriting the existing
         * method. Method names may be specified as individual arguments or as arrays
         * of method names. If no method names are provided all the function properties
         * of `object` will be bound.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Object} object The object to bind and assign the bound methods to.
         * @param {...string} [methodName] The object method names to
         *  bind, specified as individual method names or arrays of method names.
         * @returns {Object} Returns `object`.
         * @example
         *
         * var view = {
         *  'label': 'docs',
         *  'onClick': function() { console.log('clicked ' + this.label); }
         * };
         *
         * _.bindAll(view);
         * jQuery('#docs').on('click', view.onClick);
         * // => logs 'clicked docs', when the button is clicked
         */
        function bindAll(object) {
            var funcs = arguments.length > 1 ? baseFlatten(arguments, true, false, 1) : functions(object), index = -1, length = funcs.length;
            while (++index < length) {
                var key = funcs[index];
                object[key] = createWrapper(object[key], 1, null, null, object);
            }
            return object;
        }
        /**
         * Creates a function that, when called, invokes the method at `object[key]`
         * and prepends any additional `bindKey` arguments to those provided to the bound
         * function. This method differs from `_.bind` by allowing bound functions to
         * reference methods that will be redefined or don't yet exist.
         * See http://michaux.ca/articles/lazy-function-definition-pattern.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Object} object The object the method belongs to.
         * @param {string} key The key of the method.
         * @param {...*} [arg] Arguments to be partially applied.
         * @returns {Function} Returns the new bound function.
         * @example
         *
         * var object = {
         *   'name': 'fred',
         *   'greet': function(greeting) {
         *     return greeting + ' ' + this.name;
         *   }
         * };
         *
         * var func = _.bindKey(object, 'greet', 'hi');
         * func();
         * // => 'hi fred'
         *
         * object.greet = function(greeting) {
         *   return greeting + 'ya ' + this.name + '!';
         * };
         *
         * func();
         * // => 'hiya fred!'
         */
        function bindKey(object, key) {
            return arguments.length > 2 ? createWrapper(key, 19, slice(arguments, 2), null, object) : createWrapper(key, 3, null, null, object);
        }
        /**
         * Creates a function that is the composition of the provided functions,
         * where each function consumes the return value of the function that follows.
         * For example, composing the functions `f()`, `g()`, and `h()` produces `f(g(h()))`.
         * Each function is executed with the `this` binding of the composed function.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {...Function} [func] Functions to compose.
         * @returns {Function} Returns the new composed function.
         * @example
         *
         * var realNameMap = {
         *   'pebbles': 'penelope'
         * };
         *
         * var format = function(name) {
         *   name = realNameMap[name.toLowerCase()] || name;
         *   return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
         * };
         *
         * var greet = function(formatted) {
         *   return 'Hiya ' + formatted + '!';
         * };
         *
         * var welcome = _.compose(greet, format);
         * welcome('pebbles');
         * // => 'Hiya Penelope!'
         */
        function compose() {
            var funcs = arguments, length = funcs.length;
            while (length--) {
                if (!isFunction(funcs[length])) {
                    throw new TypeError();
                }
            }
            return function () {
                var args = arguments, length = funcs.length;
                while (length--) {
                    args = [funcs[length].apply(this, args)];
                }
                return args[0];
            };
        }
        /**
         * Produces a callback bound to an optional `thisArg`. If `func` is a property
         * name the created callback will return the property value for a given element.
         * If `func` is an object the created callback will return `true` for elements
         * that contain the equivalent object properties, otherwise it will return `false`.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {*} [func=identity] The value to convert to a callback.
         * @param {*} [thisArg] The `this` binding of the created callback.
         * @param {number} [argCount] The number of arguments the callback accepts.
         * @returns {Function} Returns a callback function.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * // wrap to create custom callback shorthands
         * _.createCallback = _.wrap(_.createCallback, function(func, callback, thisArg) {
         *   var match = /^(.+?)__([gl]t)(.+)$/.exec(callback);
         *   return !match ? func(callback, thisArg) : function(object) {
         *     return match[2] == 'gt' ? object[match[1]] > match[3] : object[match[1]] < match[3];
         *   };
         * });
         *
         * _.filter(characters, 'age__gt38');
         * // => [{ 'name': 'fred', 'age': 40 }]
         */
        function createCallback(func, thisArg, argCount) {
            var type = typeof func;
            if (func == null || type == 'function') {
                return baseCreateCallback(func, thisArg, argCount);
            }
            // handle "_.pluck" style callback shorthands
            if (type != 'object') {
                return function (object) {
                    return object[func];
                };
            }
            var props = keys(func), key = props[0], a = func[key];
            // handle "_.where" style callback shorthands
            if (props.length == 1 && a === a && !isObject(a)) {
                // fast path the common case of providing an object with a single
                // property containing a primitive value
                return function (object) {
                    var b = object[key];
                    return a === b && (a !== 0 || 1 / a == 1 / b);
                };
            }
            return function (object) {
                var length = props.length, result = false;
                while (length--) {
                    if (!(result = baseIsEqual(object[props[length]], func[props[length]], null, true))) {
                        break;
                    }
                }
                return result;
            };
        }
        /**
         * Creates a function which accepts one or more arguments of `func` that when
         * invoked either executes `func` returning its result, if all `func` arguments
         * have been provided, or returns a function that accepts one or more of the
         * remaining `func` arguments, and so on. The arity of `func` can be specified
         * if `func.length` is not sufficient.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to curry.
         * @param {number} [arity=func.length] The arity of `func`.
         * @returns {Function} Returns the new curried function.
         * @example
         *
         * var curried = _.curry(function(a, b, c) {
         *   console.log(a + b + c);
         * });
         *
         * curried(1)(2)(3);
         * // => 6
         *
         * curried(1, 2)(3);
         * // => 6
         *
         * curried(1, 2, 3);
         * // => 6
         */
        function curry(func, arity) {
            arity = typeof arity == 'number' ? arity : +arity || func.length;
            return createWrapper(func, 4, null, null, null, arity);
        }
        /**
         * Creates a function that will delay the execution of `func` until after
         * `wait` milliseconds have elapsed since the last time it was invoked.
         * Provide an options object to indicate that `func` should be invoked on
         * the leading and/or trailing edge of the `wait` timeout. Subsequent calls
         * to the debounced function will return the result of the last `func` call.
         *
         * Note: If `leading` and `trailing` options are `true` `func` will be called
         * on the trailing edge of the timeout only if the the debounced function is
         * invoked more than once during the `wait` timeout.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to debounce.
         * @param {number} wait The number of milliseconds to delay.
         * @param {Object} [options] The options object.
         * @param {boolean} [options.leading=false] Specify execution on the leading edge of the timeout.
         * @param {number} [options.maxWait] The maximum time `func` is allowed to be delayed before it's called.
         * @param {boolean} [options.trailing=true] Specify execution on the trailing edge of the timeout.
         * @returns {Function} Returns the new debounced function.
         * @example
         *
         * // avoid costly calculations while the window size is in flux
         * var lazyLayout = _.debounce(calculateLayout, 150);
         * jQuery(window).on('resize', lazyLayout);
         *
         * // execute `sendMail` when the click event is fired, debouncing subsequent calls
         * jQuery('#postbox').on('click', _.debounce(sendMail, 300, {
         *   'leading': true,
         *   'trailing': false
         * });
         *
         * // ensure `batchLog` is executed once after 1 second of debounced calls
         * var source = new EventSource('/stream');
         * source.addEventListener('message', _.debounce(batchLog, 250, {
         *   'maxWait': 1000
         * }, false);
         */
        function debounce(func, wait, options) {
            var args, maxTimeoutId, result, stamp, thisArg, timeoutId, trailingCall, lastCalled = 0, maxWait = false, trailing = true;
            if (!isFunction(func)) {
                throw new TypeError();
            }
            wait = nativeMax(0, wait) || 0;
            if (options === true) {
                var leading = true;
                trailing = false;
            } else if (isObject(options)) {
                leading = options.leading;
                maxWait = 'maxWait' in options && (nativeMax(wait, options.maxWait) || 0);
                trailing = 'trailing' in options ? options.trailing : trailing;
            }
            var delayed = function () {
                var remaining = wait - (now() - stamp);
                if (remaining <= 0) {
                    if (maxTimeoutId) {
                        clearTimeout(maxTimeoutId);
                    }
                    var isCalled = trailingCall;
                    maxTimeoutId = timeoutId = trailingCall = undefined;
                    if (isCalled) {
                        lastCalled = now();
                        result = func.apply(thisArg, args);
                        if (!timeoutId && !maxTimeoutId) {
                            args = thisArg = null;
                        }
                    }
                } else {
                    timeoutId = setTimeout(delayed, remaining);
                }
            };
            var maxDelayed = function () {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                maxTimeoutId = timeoutId = trailingCall = undefined;
                if (trailing || maxWait !== wait) {
                    lastCalled = now();
                    result = func.apply(thisArg, args);
                    if (!timeoutId && !maxTimeoutId) {
                        args = thisArg = null;
                    }
                }
            };
            return function () {
                args = arguments;
                stamp = now();
                thisArg = this;
                trailingCall = trailing && (timeoutId || !leading);
                if (maxWait === false) {
                    var leadingCall = leading && !timeoutId;
                } else {
                    if (!maxTimeoutId && !leading) {
                        lastCalled = stamp;
                    }
                    var remaining = maxWait - (stamp - lastCalled), isCalled = remaining <= 0;
                    if (isCalled) {
                        if (maxTimeoutId) {
                            maxTimeoutId = clearTimeout(maxTimeoutId);
                        }
                        lastCalled = stamp;
                        result = func.apply(thisArg, args);
                    } else if (!maxTimeoutId) {
                        maxTimeoutId = setTimeout(maxDelayed, remaining);
                    }
                }
                if (isCalled && timeoutId) {
                    timeoutId = clearTimeout(timeoutId);
                } else if (!timeoutId && wait !== maxWait) {
                    timeoutId = setTimeout(delayed, wait);
                }
                if (leadingCall) {
                    isCalled = true;
                    result = func.apply(thisArg, args);
                }
                if (isCalled && !timeoutId && !maxTimeoutId) {
                    args = thisArg = null;
                }
                return result;
            };
        }
        /**
         * Defers executing the `func` function until the current call stack has cleared.
         * Additional arguments will be provided to `func` when it is invoked.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to defer.
         * @param {...*} [arg] Arguments to invoke the function with.
         * @returns {number} Returns the timer id.
         * @example
         *
         * _.defer(function() { console.log('deferred'); });
         * // returns from the function before 'deferred' is logged
         */
        function defer(func) {
            if (!isFunction(func)) {
                throw new TypeError();
            }
            var args = slice(arguments, 1);
            return setTimeout(function () {
                func.apply(undefined, args);
            }, 1);
        }
        // use `setImmediate` if available in Node.js
        if (setImmediate) {
            defer = function (func) {
                if (!isFunction(func)) {
                    throw new TypeError();
                }
                return setImmediate.apply(context, arguments);
            };
        }
        /**
         * Executes the `func` function after `wait` milliseconds. Additional arguments
         * will be provided to `func` when it is invoked.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to delay.
         * @param {number} wait The number of milliseconds to delay execution.
         * @param {...*} [arg] Arguments to invoke the function with.
         * @returns {number} Returns the timer id.
         * @example
         *
         * var log = _.bind(console.log, console);
         * _.delay(log, 1000, 'logged later');
         * // => 'logged later' (Appears after one second.)
         */
        function delay(func, wait) {
            if (!isFunction(func)) {
                throw new TypeError();
            }
            var args = slice(arguments, 2);
            return setTimeout(function () {
                func.apply(undefined, args);
            }, wait);
        }
        /**
         * Creates a function that memoizes the result of `func`. If `resolver` is
         * provided it will be used to determine the cache key for storing the result
         * based on the arguments provided to the memoized function. By default, the
         * first argument provided to the memoized function is used as the cache key.
         * The `func` is executed with the `this` binding of the memoized function.
         * The result cache is exposed as the `cache` property on the memoized function.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to have its output memoized.
         * @param {Function} [resolver] A function used to resolve the cache key.
         * @returns {Function} Returns the new memoizing function.
         * @example
         *
         * var fibonacci = _.memoize(function(n) {
         *   return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
         * });
         *
         * fibonacci(9)
         * // => 34
         *
         * var data = {
         *   'fred': { 'name': 'fred', 'age': 40 },
         *   'pebbles': { 'name': 'pebbles', 'age': 1 }
         * };
         *
         * // modifying the result cache
         * var get = _.memoize(function(name) { return data[name]; }, _.identity);
         * get('pebbles');
         * // => { 'name': 'pebbles', 'age': 1 }
         *
         * get.cache.pebbles.name = 'penelope';
         * get('pebbles');
         * // => { 'name': 'penelope', 'age': 1 }
         */
        function memoize(func, resolver) {
            if (!isFunction(func)) {
                throw new TypeError();
            }
            var memoized = function () {
                var cache = memoized.cache, key = resolver ? resolver.apply(this, arguments) : keyPrefix + arguments[0];
                return hasOwnProperty.call(cache, key) ? cache[key] : cache[key] = func.apply(this, arguments);
            };
            memoized.cache = {};
            return memoized;
        }
        /**
         * Creates a function that is restricted to execute `func` once. Repeat calls to
         * the function will return the value of the first call. The `func` is executed
         * with the `this` binding of the created function.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to restrict.
         * @returns {Function} Returns the new restricted function.
         * @example
         *
         * var initialize = _.once(createApplication);
         * initialize();
         * initialize();
         * // `initialize` executes `createApplication` once
         */
        function once(func) {
            var ran, result;
            if (!isFunction(func)) {
                throw new TypeError();
            }
            return function () {
                if (ran) {
                    return result;
                }
                ran = true;
                result = func.apply(this, arguments);
                // clear the `func` variable so the function may be garbage collected
                func = null;
                return result;
            };
        }
        /**
         * Creates a function that, when called, invokes `func` with any additional
         * `partial` arguments prepended to those provided to the new function. This
         * method is similar to `_.bind` except it does **not** alter the `this` binding.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to partially apply arguments to.
         * @param {...*} [arg] Arguments to be partially applied.
         * @returns {Function} Returns the new partially applied function.
         * @example
         *
         * var greet = function(greeting, name) { return greeting + ' ' + name; };
         * var hi = _.partial(greet, 'hi');
         * hi('fred');
         * // => 'hi fred'
         */
        function partial(func) {
            return createWrapper(func, 16, slice(arguments, 1));
        }
        /**
         * This method is like `_.partial` except that `partial` arguments are
         * appended to those provided to the new function.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to partially apply arguments to.
         * @param {...*} [arg] Arguments to be partially applied.
         * @returns {Function} Returns the new partially applied function.
         * @example
         *
         * var defaultsDeep = _.partialRight(_.merge, _.defaults);
         *
         * var options = {
         *   'variable': 'data',
         *   'imports': { 'jq': $ }
         * };
         *
         * defaultsDeep(options, _.templateSettings);
         *
         * options.variable
         * // => 'data'
         *
         * options.imports
         * // => { '_': _, 'jq': $ }
         */
        function partialRight(func) {
            return createWrapper(func, 32, null, slice(arguments, 1));
        }
        /**
         * Creates a function that, when executed, will only call the `func` function
         * at most once per every `wait` milliseconds. Provide an options object to
         * indicate that `func` should be invoked on the leading and/or trailing edge
         * of the `wait` timeout. Subsequent calls to the throttled function will
         * return the result of the last `func` call.
         *
         * Note: If `leading` and `trailing` options are `true` `func` will be called
         * on the trailing edge of the timeout only if the the throttled function is
         * invoked more than once during the `wait` timeout.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {Function} func The function to throttle.
         * @param {number} wait The number of milliseconds to throttle executions to.
         * @param {Object} [options] The options object.
         * @param {boolean} [options.leading=true] Specify execution on the leading edge of the timeout.
         * @param {boolean} [options.trailing=true] Specify execution on the trailing edge of the timeout.
         * @returns {Function} Returns the new throttled function.
         * @example
         *
         * // avoid excessively updating the position while scrolling
         * var throttled = _.throttle(updatePosition, 100);
         * jQuery(window).on('scroll', throttled);
         *
         * // execute `renewToken` when the click event is fired, but not more than once every 5 minutes
         * jQuery('.interactive').on('click', _.throttle(renewToken, 300000, {
         *   'trailing': false
         * }));
         */
        function throttle(func, wait, options) {
            var leading = true, trailing = true;
            if (!isFunction(func)) {
                throw new TypeError();
            }
            if (options === false) {
                leading = false;
            } else if (isObject(options)) {
                leading = 'leading' in options ? options.leading : leading;
                trailing = 'trailing' in options ? options.trailing : trailing;
            }
            debounceOptions.leading = leading;
            debounceOptions.maxWait = wait;
            debounceOptions.trailing = trailing;
            return debounce(func, wait, debounceOptions);
        }
        /**
         * Creates a function that provides `value` to the wrapper function as its
         * first argument. Additional arguments provided to the function are appended
         * to those provided to the wrapper function. The wrapper is executed with
         * the `this` binding of the created function.
         *
         * @static
         * @memberOf _
         * @category Functions
         * @param {*} value The value to wrap.
         * @param {Function} wrapper The wrapper function.
         * @returns {Function} Returns the new function.
         * @example
         *
         * var p = _.wrap(_.escape, function(func, text) {
         *   return '<p>' + func(text) + '</p>';
         * });
         *
         * p('Fred, Wilma, & Pebbles');
         * // => '<p>Fred, Wilma, &amp; Pebbles</p>'
         */
        function wrap(value, wrapper) {
            return createWrapper(wrapper, 16, [value]);
        }
        /*--------------------------------------------------------------------------*/
        /**
         * Converts the characters `&`, `<`, `>`, `"`, and `'` in `string` to their
         * corresponding HTML entities.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {string} string The string to escape.
         * @returns {string} Returns the escaped string.
         * @example
         *
         * _.escape('Fred, Wilma, & Pebbles');
         * // => 'Fred, Wilma, &amp; Pebbles'
         */
        function escape(string) {
            return string == null ? '' : String(string).replace(reUnescapedHtml, escapeHtmlChar);
        }
        /**
         * This method returns the first argument provided to it.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {*} value Any value.
         * @returns {*} Returns `value`.
         * @example
         *
         * var object = { 'name': 'fred' };
         * _.identity(object) === object;
         * // => true
         */
        function identity(value) {
            return value;
        }
        /**
         * Adds function properties of a source object to the `lodash` function and
         * chainable wrapper.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {Object} object The object of function properties to add to `lodash`.
         * @param {Object} object The object of function properties to add to `lodash`.
         * @example
         *
         * _.mixin({
         *   'capitalize': function(string) {
         *     return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
         *   }
         * });
         *
         * _.capitalize('fred');
         * // => 'Fred'
         *
         * _('fred').capitalize();
         * // => 'Fred'
         */
        function mixin(object, source) {
            var ctor = object, isFunc = !source || isFunction(ctor);
            if (!source) {
                ctor = lodashWrapper;
                source = object;
                object = lodash;
            }
            forEach(functions(source), function (methodName) {
                var func = object[methodName] = source[methodName];
                if (isFunc) {
                    ctor.prototype[methodName] = function () {
                        var value = this.__wrapped__, args = [value];
                        push.apply(args, arguments);
                        var result = func.apply(object, args);
                        if (value && typeof value == 'object' && value === result) {
                            return this;
                        }
                        result = new ctor(result);
                        result.__chain__ = this.__chain__;
                        return result;
                    };
                }
            });
        }
        /**
         * Reverts the '_' variable to its previous value and returns a reference to
         * the `lodash` function.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @returns {Function} Returns the `lodash` function.
         * @example
         *
         * var lodash = _.noConflict();
         */
        function noConflict() {
            context._ = oldDash;
            return this;
        }
        /**
         * A no-operation function.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @example
         *
         * var object = { 'name': 'fred' };
         * _.noop(object) === undefined;
         * // => true
         */
        function noop() {
        }
        /**
         * Converts the given value into an integer of the specified radix.
         * If `radix` is `undefined` or `0` a `radix` of `10` is used unless the
         * `value` is a hexadecimal, in which case a `radix` of `16` is used.
         *
         * Note: This method avoids differences in native ES3 and ES5 `parseInt`
         * implementations. See http://es5.github.io/#E.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {string} value The value to parse.
         * @param {number} [radix] The radix used to interpret the value to parse.
         * @returns {number} Returns the new integer value.
         * @example
         *
         * _.parseInt('08');
         * // => 8
         */
        var parseInt = nativeParseInt(whitespace + '08') == 8 ? nativeParseInt : function (value, radix) {
                // Firefox < 21 and Opera < 15 follow the ES3 specified implementation of `parseInt`
                return nativeParseInt(isString(value) ? value.replace(reLeadingSpacesAndZeros, '') : value, radix || 0);
            };
        /**
         * Produces a random number between `min` and `max` (inclusive). If only one
         * argument is provided a number between `0` and the given number will be
         * returned. If `floating` is truey or either `min` or `max` are floats a
         * floating-point number will be returned instead of an integer.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {number} [min=0] The minimum possible value.
         * @param {number} [max=1] The maximum possible value.
         * @param {boolean} [floating=false] Specify returning a floating-point number.
         * @returns {number} Returns a random number.
         * @example
         *
         * _.random(0, 5);
         * // => an integer between 0 and 5
         *
         * _.random(5);
         * // => also an integer between 0 and 5
         *
         * _.random(5, true);
         * // => a floating-point number between 0 and 5
         *
         * _.random(1.2, 5.2);
         * // => a floating-point number between 1.2 and 5.2
         */
        function random(min, max, floating) {
            var noMin = min == null, noMax = max == null;
            if (floating == null) {
                if (typeof min == 'boolean' && noMax) {
                    floating = min;
                    min = 1;
                } else if (!noMax && typeof max == 'boolean') {
                    floating = max;
                    noMax = true;
                }
            }
            if (noMin && noMax) {
                max = 1;
            }
            min = +min || 0;
            if (noMax) {
                max = min;
                min = 0;
            } else {
                max = +max || 0;
            }
            if (floating || min % 1 || max % 1) {
                var rand = nativeRandom();
                return nativeMin(min + rand * (max - min + parseFloat('1e-' + ((rand + '').length - 1))), max);
            }
            return baseRandom(min, max);
        }
        /**
         * Resolves the value of `property` on `object`. If `property` is a function
         * it will be invoked with the `this` binding of `object` and its result returned,
         * else the property value is returned. If `object` is falsey then `undefined`
         * is returned.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {Object} object The object to inspect.
         * @param {string} property The property to get the value of.
         * @returns {*} Returns the resolved value.
         * @example
         *
         * var object = {
         *   'cheese': 'crumpets',
         *   'stuff': function() {
         *     return 'nonsense';
         *   }
         * };
         *
         * _.result(object, 'cheese');
         * // => 'crumpets'
         *
         * _.result(object, 'stuff');
         * // => 'nonsense'
         */
        function result(object, property) {
            if (object) {
                var value = object[property];
                return isFunction(value) ? object[property]() : value;
            }
        }
        /**
         * A micro-templating method that handles arbitrary delimiters, preserves
         * whitespace, and correctly escapes quotes within interpolated code.
         *
         * Note: In the development build, `_.template` utilizes sourceURLs for easier
         * debugging. See http://www.html5rocks.com/en/tutorials/developertools/sourcemaps/#toc-sourceurl
         *
         * For more information on precompiling templates see:
         * http://lodash.com/custom-builds
         *
         * For more information on Chrome extension sandboxes see:
         * http://developer.chrome.com/stable/extensions/sandboxingEval.html
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {string} text The template text.
         * @param {Object} data The data object used to populate the text.
         * @param {Object} [options] The options object.
         * @param {RegExp} [options.escape] The "escape" delimiter.
         * @param {RegExp} [options.evaluate] The "evaluate" delimiter.
         * @param {Object} [options.imports] An object to import into the template as local variables.
         * @param {RegExp} [options.interpolate] The "interpolate" delimiter.
         * @param {string} [sourceURL] The sourceURL of the template's compiled source.
         * @param {string} [variable] The data object variable name.
         * @returns {Function|string} Returns a compiled function when no `data` object
         *  is given, else it returns the interpolated text.
         * @example
         *
         * // using the "interpolate" delimiter to create a compiled template
         * var compiled = _.template('hello <%= name %>');
         * compiled({ 'name': 'fred' });
         * // => 'hello fred'
         *
         * // using the "escape" delimiter to escape HTML in data property values
         * _.template('<b><%- value %></b>', { 'value': '<script>' });
         * // => '<b>&lt;script&gt;</b>'
         *
         * // using the "evaluate" delimiter to generate HTML
         * var list = '<% _.forEach(people, function(name) { %><li><%- name %></li><% }); %>';
         * _.template(list, { 'people': ['fred', 'barney'] });
         * // => '<li>fred</li><li>barney</li>'
         *
         * // using the ES6 delimiter as an alternative to the default "interpolate" delimiter
         * _.template('hello ${ name }', { 'name': 'pebbles' });
         * // => 'hello pebbles'
         *
         * // using the internal `print` function in "evaluate" delimiters
         * _.template('<% print("hello " + name); %>!', { 'name': 'barney' });
         * // => 'hello barney!'
         *
         * // using a custom template delimiters
         * _.templateSettings = {
         *   'interpolate': /{{([\s\S]+?)}}/g
         * };
         *
         * _.template('hello {{ name }}!', { 'name': 'mustache' });
         * // => 'hello mustache!'
         *
         * // using the `imports` option to import jQuery
         * var list = '<% $.each(people, function(name) { %><li><%- name %></li><% }); %>';
         * _.template(list, { 'people': ['fred', 'barney'] }, { 'imports': { '$': jQuery } });
         * // => '<li>fred</li><li>barney</li>'
         *
         * // using the `sourceURL` option to specify a custom sourceURL for the template
         * var compiled = _.template('hello <%= name %>', null, { 'sourceURL': '/basic/greeting.jst' });
         * compiled(data);
         * // => find the source of "greeting.jst" under the Sources tab or Resources panel of the web inspector
         *
         * // using the `variable` option to ensure a with-statement isn't used in the compiled template
         * var compiled = _.template('hi <%= data.name %>!', null, { 'variable': 'data' });
         * compiled.source;
         * // => function(data) {
         *   var __t, __p = '', __e = _.escape;
         *   __p += 'hi ' + ((__t = ( data.name )) == null ? '' : __t) + '!';
         *   return __p;
         * }
         *
         * // using the `source` property to inline compiled templates for meaningful
         * // line numbers in error messages and a stack trace
         * fs.writeFileSync(path.join(cwd, 'jst.js'), '\
         *   var JST = {\
         *     "main": ' + _.template(mainText).source + '\
         *   };\
         * ');
         */
        function template(text, data, options) {
            // based on John Resig's `tmpl` implementation
            // http://ejohn.org/blog/javascript-micro-templating/
            // and Laura Doktorova's doT.js
            // https://github.com/olado/doT
            var settings = lodash.templateSettings;
            text = String(text || '');
            // avoid missing dependencies when `iteratorTemplate` is not defined
            options = iteratorTemplate ? defaults({}, options, settings) : settings;
            var imports = iteratorTemplate && defaults({}, options.imports, settings.imports), importsKeys = iteratorTemplate ? keys(imports) : ['_'], importsValues = iteratorTemplate ? values(imports) : [lodash];
            var isEvaluating, index = 0, interpolate = options.interpolate || reNoMatch, source = '__p += \'';
            // compile the regexp to match each delimiter
            var reDelimiters = RegExp((options.escape || reNoMatch).source + '|' + interpolate.source + '|' + (interpolate === reInterpolate ? reEsTemplate : reNoMatch).source + '|' + (options.evaluate || reNoMatch).source + '|$', 'g');
            text.replace(reDelimiters, function (match, escapeValue, interpolateValue, esTemplateValue, evaluateValue, offset) {
                interpolateValue || (interpolateValue = esTemplateValue);
                // escape characters that cannot be included in string literals
                source += text.slice(index, offset).replace(reUnescapedString, escapeStringChar);
                // replace delimiters with snippets
                if (escapeValue) {
                    source += '\' +\n__e(' + escapeValue + ') +\n\'';
                }
                if (evaluateValue) {
                    isEvaluating = true;
                    source += '\';\n' + evaluateValue + ';\n__p += \'';
                }
                if (interpolateValue) {
                    source += '\' +\n((__t = (' + interpolateValue + ')) == null ? \'\' : __t) +\n\'';
                }
                index = offset + match.length;
                // the JS engine embedded in Adobe products requires returning the `match`
                // string in order to produce the correct `offset` value
                return match;
            });
            source += '\';\n';
            // if `variable` is not specified, wrap a with-statement around the generated
            // code to add the data object to the top of the scope chain
            var variable = options.variable, hasVariable = variable;
            if (!hasVariable) {
                variable = 'obj';
                source = 'with (' + variable + ') {\n' + source + '\n}\n';
            }
            // cleanup code by stripping empty strings
            source = (isEvaluating ? source.replace(reEmptyStringLeading, '') : source).replace(reEmptyStringMiddle, '$1').replace(reEmptyStringTrailing, '$1;');
            // frame code as the function body
            source = 'function(' + variable + ') {\n' + (hasVariable ? '' : variable + ' || (' + variable + ' = {});\n') + 'var __t, __p = \'\', __e = _.escape' + (isEvaluating ? ', __j = Array.prototype.join;\n' + 'function print() { __p += __j.call(arguments, \'\') }\n' : ';\n') + source + 'return __p\n}';
            // Use a sourceURL for easier debugging.
            // http://www.html5rocks.com/en/tutorials/developertools/sourcemaps/#toc-sourceurl
            var sourceURL = '\n/*\n//# sourceURL=' + (options.sourceURL || '/lodash/template/source[' + templateCounter++ + ']') + '\n*/';
            try {
                var result = Function(importsKeys, 'return ' + source + sourceURL).apply(undefined, importsValues);
            } catch (e) {
                e.source = source;
                throw e;
            }
            if (data) {
                return result(data);
            }
            // provide the compiled function's source by its `toString` method, in
            // supported environments, or the `source` property as a convenience for
            // inlining compiled templates during the build process
            result.source = source;
            return result;
        }
        /**
         * Executes the callback `n` times, returning an array of the results
         * of each callback execution. The callback is bound to `thisArg` and invoked
         * with one argument; (index).
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {number} n The number of times to execute the callback.
         * @param {Function} callback The function called per iteration.
         * @param {*} [thisArg] The `this` binding of `callback`.
         * @returns {Array} Returns an array of the results of each `callback` execution.
         * @example
         *
         * var diceRolls = _.times(3, _.partial(_.random, 1, 6));
         * // => [3, 6, 4]
         *
         * _.times(3, function(n) { mage.castSpell(n); });
         * // => calls `mage.castSpell(n)` three times, passing `n` of `0`, `1`, and `2` respectively
         *
         * _.times(3, function(n) { this.cast(n); }, mage);
         * // => also calls `mage.castSpell(n)` three times
         */
        function times(n, callback, thisArg) {
            n = (n = +n) > -1 ? n : 0;
            var index = -1, result = Array(n);
            callback = baseCreateCallback(callback, thisArg, 1);
            while (++index < n) {
                result[index] = callback(index);
            }
            return result;
        }
        /**
         * The inverse of `_.escape` this method converts the HTML entities
         * `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` in `string` to their
         * corresponding characters.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {string} string The string to unescape.
         * @returns {string} Returns the unescaped string.
         * @example
         *
         * _.unescape('Fred, Barney &amp; Pebbles');
         * // => 'Fred, Barney & Pebbles'
         */
        function unescape(string) {
            return string == null ? '' : String(string).replace(reEscapedHtml, unescapeHtmlChar);
        }
        /**
         * Generates a unique ID. If `prefix` is provided the ID will be appended to it.
         *
         * @static
         * @memberOf _
         * @category Utilities
         * @param {string} [prefix] The value to prefix the ID with.
         * @returns {string} Returns the unique ID.
         * @example
         *
         * _.uniqueId('contact_');
         * // => 'contact_104'
         *
         * _.uniqueId();
         * // => '105'
         */
        function uniqueId(prefix) {
            var id = ++idCounter;
            return String(prefix == null ? '' : prefix) + id;
        }
        /*--------------------------------------------------------------------------*/
        /**
         * Creates a `lodash` object that wraps the given value with explicit
         * method chaining enabled.
         *
         * @static
         * @memberOf _
         * @category Chaining
         * @param {*} value The value to wrap.
         * @returns {Object} Returns the wrapper object.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney',  'age': 36 },
         *   { 'name': 'fred',    'age': 40 },
         *   { 'name': 'pebbles', 'age': 1 }
         * ];
         *
         * var youngest = _.chain(characters)
         *     .sortBy('age')
         *     .map(function(chr) { return chr.name + ' is ' + chr.age; })
         *     .first()
         *     .value();
         * // => 'pebbles is 1'
         */
        function chain(value) {
            value = new lodashWrapper(value);
            value.__chain__ = true;
            return value;
        }
        /**
         * Invokes `interceptor` with the `value` as the first argument and then
         * returns `value`. The purpose of this method is to "tap into" a method
         * chain in order to perform operations on intermediate results within
         * the chain.
         *
         * @static
         * @memberOf _
         * @category Chaining
         * @param {*} value The value to provide to `interceptor`.
         * @param {Function} interceptor The function to invoke.
         * @returns {*} Returns `value`.
         * @example
         *
         * _([1, 2, 3, 4])
         *  .tap(function(array) { array.pop(); })
         *  .reverse()
         *  .value();
         * // => [3, 2, 1]
         */
        function tap(value, interceptor) {
            interceptor(value);
            return value;
        }
        /**
         * Enables explicit method chaining on the wrapper object.
         *
         * @name chain
         * @memberOf _
         * @category Chaining
         * @returns {*} Returns the wrapper object.
         * @example
         *
         * var characters = [
         *   { 'name': 'barney', 'age': 36 },
         *   { 'name': 'fred',   'age': 40 }
         * ];
         *
         * // without explicit chaining
         * _(characters).first();
         * // => { 'name': 'barney', 'age': 36 }
         *
         * // with explicit chaining
         * _(characters).chain()
         *   .first()
         *   .pick('age')
         *   .value()
         * // => { 'age': 36 }
         */
        function wrapperChain() {
            this.__chain__ = true;
            return this;
        }
        /**
         * Produces the `toString` result of the wrapped value.
         *
         * @name toString
         * @memberOf _
         * @category Chaining
         * @returns {string} Returns the string result.
         * @example
         *
         * _([1, 2, 3]).toString();
         * // => '1,2,3'
         */
        function wrapperToString() {
            return String(this.__wrapped__);
        }
        /**
         * Extracts the wrapped value.
         *
         * @name valueOf
         * @memberOf _
         * @alias value
         * @category Chaining
         * @returns {*} Returns the wrapped value.
         * @example
         *
         * _([1, 2, 3]).valueOf();
         * // => [1, 2, 3]
         */
        function wrapperValueOf() {
            return this.__wrapped__;
        }
        /*--------------------------------------------------------------------------*/
        // add functions that return wrapped values when chaining
        lodash.after = after;
        lodash.assign = assign;
        lodash.at = at;
        lodash.bind = bind;
        lodash.bindAll = bindAll;
        lodash.bindKey = bindKey;
        lodash.chain = chain;
        lodash.compact = compact;
        lodash.compose = compose;
        lodash.countBy = countBy;
        lodash.create = create;
        lodash.createCallback = createCallback;
        lodash.curry = curry;
        lodash.debounce = debounce;
        lodash.defaults = defaults;
        lodash.defer = defer;
        lodash.delay = delay;
        lodash.difference = difference;
        lodash.filter = filter;
        lodash.flatten = flatten;
        lodash.forEach = forEach;
        lodash.forEachRight = forEachRight;
        lodash.forIn = forIn;
        lodash.forInRight = forInRight;
        lodash.forOwn = forOwn;
        lodash.forOwnRight = forOwnRight;
        lodash.functions = functions;
        lodash.groupBy = groupBy;
        lodash.indexBy = indexBy;
        lodash.initial = initial;
        lodash.intersection = intersection;
        lodash.invert = invert;
        lodash.invoke = invoke;
        lodash.keys = keys;
        lodash.map = map;
        lodash.max = max;
        lodash.memoize = memoize;
        lodash.merge = merge;
        lodash.min = min;
        lodash.omit = omit;
        lodash.once = once;
        lodash.pairs = pairs;
        lodash.partial = partial;
        lodash.partialRight = partialRight;
        lodash.pick = pick;
        lodash.pluck = pluck;
        lodash.pull = pull;
        lodash.range = range;
        lodash.reject = reject;
        lodash.remove = remove;
        lodash.rest = rest;
        lodash.shuffle = shuffle;
        lodash.sortBy = sortBy;
        lodash.tap = tap;
        lodash.throttle = throttle;
        lodash.times = times;
        lodash.toArray = toArray;
        lodash.transform = transform;
        lodash.union = union;
        lodash.uniq = uniq;
        lodash.values = values;
        lodash.where = where;
        lodash.without = without;
        lodash.wrap = wrap;
        lodash.zip = zip;
        lodash.zipObject = zipObject;
        // add aliases
        lodash.collect = map;
        lodash.drop = rest;
        lodash.each = forEach;
        lodash.eachRight = forEachRight;
        lodash.extend = assign;
        lodash.methods = functions;
        lodash.object = zipObject;
        lodash.select = filter;
        lodash.tail = rest;
        lodash.unique = uniq;
        lodash.unzip = zip;
        // add functions to `lodash.prototype`
        mixin(lodash);
        /*--------------------------------------------------------------------------*/
        // add functions that return unwrapped values when chaining
        lodash.clone = clone;
        lodash.cloneDeep = cloneDeep;
        lodash.contains = contains;
        lodash.escape = escape;
        lodash.every = every;
        lodash.find = find;
        lodash.findIndex = findIndex;
        lodash.findKey = findKey;
        lodash.findLast = findLast;
        lodash.findLastIndex = findLastIndex;
        lodash.findLastKey = findLastKey;
        lodash.has = has;
        lodash.identity = identity;
        lodash.indexOf = indexOf;
        lodash.isArguments = isArguments;
        lodash.isArray = isArray;
        lodash.isBoolean = isBoolean;
        lodash.isDate = isDate;
        lodash.isElement = isElement;
        lodash.isEmpty = isEmpty;
        lodash.isEqual = isEqual;
        lodash.isFinite = isFinite;
        lodash.isFunction = isFunction;
        lodash.isNaN = isNaN;
        lodash.isNull = isNull;
        lodash.isNumber = isNumber;
        lodash.isObject = isObject;
        lodash.isPlainObject = isPlainObject;
        lodash.isRegExp = isRegExp;
        lodash.isString = isString;
        lodash.isUndefined = isUndefined;
        lodash.lastIndexOf = lastIndexOf;
        lodash.mixin = mixin;
        lodash.noConflict = noConflict;
        lodash.noop = noop;
        lodash.parseInt = parseInt;
        lodash.random = random;
        lodash.reduce = reduce;
        lodash.reduceRight = reduceRight;
        lodash.result = result;
        lodash.runInContext = runInContext;
        lodash.size = size;
        lodash.some = some;
        lodash.sortedIndex = sortedIndex;
        lodash.template = template;
        lodash.unescape = unescape;
        lodash.uniqueId = uniqueId;
        // add aliases
        lodash.all = every;
        lodash.any = some;
        lodash.detect = find;
        lodash.findWhere = find;
        lodash.foldl = reduce;
        lodash.foldr = reduceRight;
        lodash.include = contains;
        lodash.inject = reduce;
        forOwn(lodash, function (func, methodName) {
            if (!lodash.prototype[methodName]) {
                lodash.prototype[methodName] = function () {
                    var args = [this.__wrapped__], chainAll = this.__chain__;
                    push.apply(args, arguments);
                    var result = func.apply(lodash, args);
                    return chainAll ? new lodashWrapper(result, chainAll) : result;
                };
            }
        });
        /*--------------------------------------------------------------------------*/
        // add functions capable of returning wrapped and unwrapped values when chaining
        lodash.first = first;
        lodash.last = last;
        lodash.sample = sample;
        // add aliases
        lodash.take = first;
        lodash.head = first;
        forOwn(lodash, function (func, methodName) {
            var callbackable = methodName !== 'sample';
            if (!lodash.prototype[methodName]) {
                lodash.prototype[methodName] = function (n, guard) {
                    var chainAll = this.__chain__, result = func(this.__wrapped__, n, guard);
                    return !chainAll && (n == null || guard && !(callbackable && typeof n == 'function')) ? result : new lodashWrapper(result, chainAll);
                };
            }
        });
        /*--------------------------------------------------------------------------*/
        /**
         * The semantic version number.
         *
         * @static
         * @memberOf _
         * @type string
         */
        lodash.VERSION = '2.3.0';
        // add "Chaining" functions to the wrapper
        lodash.prototype.chain = wrapperChain;
        lodash.prototype.toString = wrapperToString;
        lodash.prototype.value = wrapperValueOf;
        lodash.prototype.valueOf = wrapperValueOf;
        // add `Array` functions that return unwrapped values
        baseEach([
            'join',
            'pop',
            'shift'
        ], function (methodName) {
            var func = arrayRef[methodName];
            lodash.prototype[methodName] = function () {
                var chainAll = this.__chain__, result = func.apply(this.__wrapped__, arguments);
                return chainAll ? new lodashWrapper(result, chainAll) : result;
            };
        });
        // add `Array` functions that return the wrapped value
        baseEach([
            'push',
            'reverse',
            'sort',
            'unshift'
        ], function (methodName) {
            var func = arrayRef[methodName];
            lodash.prototype[methodName] = function () {
                func.apply(this.__wrapped__, arguments);
                return this;
            };
        });
        // add `Array` functions that return new wrapped values
        baseEach([
            'concat',
            'slice',
            'splice'
        ], function (methodName) {
            var func = arrayRef[methodName];
            lodash.prototype[methodName] = function () {
                return new lodashWrapper(func.apply(this.__wrapped__, arguments), this.__chain__);
            };
        });
        // avoid array-like object bugs with `Array#shift` and `Array#splice`
        // in IE < 9, Firefox < 10, Narwhal, and RingoJS
        if (!support.spliceObjects) {
            baseEach([
                'pop',
                'shift',
                'splice'
            ], function (methodName) {
                var func = arrayRef[methodName], isSplice = methodName == 'splice';
                lodash.prototype[methodName] = function () {
                    var chainAll = this.__chain__, value = this.__wrapped__, result = func.apply(value, arguments);
                    if (value.length === 0) {
                        delete value[0];
                    }
                    return chainAll || isSplice ? new lodashWrapper(result, chainAll) : result;
                };
            });
        }
        // add pseudo private property to be used and removed during the build process
        lodash._baseEach = baseEach;
        lodash._iteratorTemplate = iteratorTemplate;
        lodash._shimKeys = shimKeys;
        return lodash;
    }
    /*--------------------------------------------------------------------------*/
    // expose Lo-Dash
    var _ = runInContext();
    // some AMD build optimizers like r.js check for condition patterns like the following:
    if (true) {
        // Expose Lo-Dash to the global object even when an AMD loader is present in
        // case Lo-Dash was injected by a third-party script and not intended to be
        // loaded as a module. The global assignment can be reverted in the Lo-Dash
        // module by its `noConflict()` method.
        root._ = _;    // define as an anonymous module so, through path mapping, it can be
                       // referenced as the "underscore" module
        var lodash = function () {
                return _;
            }();
    }    // check for `exports` after `define` in case a build optimizer adds an `exports` object
    else if (freeExports && freeModule) {
        // in Node.js or RingoJS
        if (moduleExports) {
            (freeModule.exports = _)._ = _;
        }    // in Narwhal or Rhino -require
        else {
            freeExports._ = _;
        }
    } else {
        // in a browser or Rhino
        root._ = _;
    }
}.call(this));
/* parser generated by jison 0.4.13 */
/*
  Returns a Parser object of the following structure:

  Parser: {
    yy: {}
  }

  Parser.prototype: {
    yy: {},
    trace: function(),
    symbols_: {associative list: name ==> number},
    terminals_: {associative list: number ==> name},
    productions_: [...],
    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),
    table: [...],
    defaultActions: {...},
    parseError: function(str, hash),
    parse: function(input),

    lexer: {
        EOF: 1,
        parseError: function(str, hash),
        setInput: function(input),
        input: function(),
        unput: function(str),
        more: function(),
        less: function(n),
        pastInput: function(),
        upcomingInput: function(),
        showPosition: function(),
        test_match: function(regex_match_array, rule_index),
        next: function(),
        lex: function(),
        begin: function(condition),
        popState: function(),
        _currentRules: function(),
        topState: function(),
        pushState: function(condition),

        options: {
            ranges: boolean           (optional: true ==> token location info will include a .range[] member)
            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)
            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)
        },

        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),
        rules: [...],
        conditions: {associative list: name ==> set},
    }
  }


  token location info (@$, _$, etc.): {
    first_line: n,
    last_line: n,
    first_column: n,
    last_column: n,
    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)
  }


  the parseError function receives a 'hash' object with these members for lexer and parser errors: {
    text:        (matched text)
    token:       (the produced terminal token, if any)
    line:        (yylineno)
  }
  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {
    loc:         (yylloc)
    expected:    (string describing the set of expected tokens)
    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)
  }
*/
var parser = function () {
        var parser = {
                trace: function trace() {
                },
                yy: {},
                symbols_: {
                    'error': 2,
                    'Program': 3,
                    'ProgramSectionList': 4,
                    'ProgramSection': 5,
                    'StatementList': 6,
                    'FunctionDefinition': 7,
                    'Statement': 8,
                    'ExpressionStatement': 9,
                    'LoopStatement': 10,
                    'JumpStatement': 11,
                    'CodeSegment': 12,
                    'SEMICOLON': 13,
                    'Expression': 14,
                    'ChuckExpression': 15,
                    'COMMA': 16,
                    'ArrowExpression': 17,
                    'ChuckOperator': 18,
                    'DeclExpression': 19,
                    'ConditionalExpression': 20,
                    'TypeDecl': 21,
                    'VarDeclList': 22,
                    'VarDecl': 23,
                    'ID': 24,
                    'ArrayExpression': 25,
                    'ArrayEmpty': 26,
                    'Literal': 27,
                    'NULL': 28,
                    'TypeDeclA': 29,
                    'TypeDeclB': 30,
                    'AT_SYM': 31,
                    'LT': 32,
                    'IdDot': 33,
                    'GT': 34,
                    'TypeDecl2': 35,
                    'LogicalOrExpression': 36,
                    'LogicalAndExpression': 37,
                    'InclusiveOrExpression': 38,
                    'ExclusiveOrExpression': 39,
                    'AndExpression': 40,
                    'EqualityExpression': 41,
                    'RelationalExpression': 42,
                    'ShiftExpression': 43,
                    'AdditiveExpression': 44,
                    'MultiplicativeExpression': 45,
                    'PLUS': 46,
                    'MINUS': 47,
                    'TildaExpression': 48,
                    'TIMES': 49,
                    'DIVIDE': 50,
                    'CastExpression': 51,
                    'UnaryExpression': 52,
                    'DurExpression': 53,
                    'PLUSPLUS': 54,
                    'PostfixExpression': 55,
                    'COLONCOLON': 56,
                    'PrimaryExpression': 57,
                    'LPAREN': 58,
                    'RPAREN': 59,
                    'DOT': 60,
                    'NUMBER': 61,
                    'FLOAT': 62,
                    'STRING_LIT': 63,
                    'L_HACK': 64,
                    'R_HACK': 65,
                    'WHILE': 66,
                    'FOR': 67,
                    'LBRACE': 68,
                    'RBRACE': 69,
                    'BREAK': 70,
                    'LBRACK': 71,
                    'RBRACK': 72,
                    'CHUCK': 73,
                    'AT_CHUCK': 74,
                    'PLUS_CHUCK': 75,
                    'MINUS_CHUCK': 76,
                    'UNCHUCK': 77,
                    'FunctionDeclaration': 78,
                    'StaticDecl': 79,
                    'ArgList': 80,
                    'FUNCTION': 81,
                    '$accept': 0,
                    '$end': 1
                },
                terminals_: {
                    2: 'error',
                    13: 'SEMICOLON',
                    16: 'COMMA',
                    24: 'ID',
                    28: 'NULL',
                    31: 'AT_SYM',
                    32: 'LT',
                    34: 'GT',
                    46: 'PLUS',
                    47: 'MINUS',
                    49: 'TIMES',
                    50: 'DIVIDE',
                    54: 'PLUSPLUS',
                    56: 'COLONCOLON',
                    58: 'LPAREN',
                    59: 'RPAREN',
                    60: 'DOT',
                    61: 'NUMBER',
                    62: 'FLOAT',
                    63: 'STRING_LIT',
                    64: 'L_HACK',
                    65: 'R_HACK',
                    66: 'WHILE',
                    67: 'FOR',
                    68: 'LBRACE',
                    69: 'RBRACE',
                    70: 'BREAK',
                    71: 'LBRACK',
                    72: 'RBRACK',
                    73: 'CHUCK',
                    74: 'AT_CHUCK',
                    75: 'PLUS_CHUCK',
                    76: 'MINUS_CHUCK',
                    77: 'UNCHUCK',
                    81: 'FUNCTION'
                },
                productions_: [
                    0,
                    [
                        3,
                        1
                    ],
                    [
                        4,
                        1
                    ],
                    [
                        4,
                        2
                    ],
                    [
                        5,
                        1
                    ],
                    [
                        5,
                        1
                    ],
                    [
                        6,
                        1
                    ],
                    [
                        6,
                        2
                    ],
                    [
                        8,
                        1
                    ],
                    [
                        8,
                        1
                    ],
                    [
                        8,
                        1
                    ],
                    [
                        8,
                        1
                    ],
                    [
                        9,
                        1
                    ],
                    [
                        9,
                        2
                    ],
                    [
                        14,
                        1
                    ],
                    [
                        14,
                        3
                    ],
                    [
                        15,
                        1
                    ],
                    [
                        15,
                        3
                    ],
                    [
                        17,
                        1
                    ],
                    [
                        19,
                        1
                    ],
                    [
                        19,
                        2
                    ],
                    [
                        22,
                        1
                    ],
                    [
                        23,
                        1
                    ],
                    [
                        23,
                        2
                    ],
                    [
                        23,
                        2
                    ],
                    [
                        27,
                        1
                    ],
                    [
                        21,
                        1
                    ],
                    [
                        21,
                        1
                    ],
                    [
                        29,
                        1
                    ],
                    [
                        29,
                        2
                    ],
                    [
                        30,
                        3
                    ],
                    [
                        30,
                        4
                    ],
                    [
                        35,
                        1
                    ],
                    [
                        20,
                        1
                    ],
                    [
                        36,
                        1
                    ],
                    [
                        37,
                        1
                    ],
                    [
                        38,
                        1
                    ],
                    [
                        39,
                        1
                    ],
                    [
                        40,
                        1
                    ],
                    [
                        41,
                        1
                    ],
                    [
                        42,
                        1
                    ],
                    [
                        42,
                        3
                    ],
                    [
                        42,
                        3
                    ],
                    [
                        43,
                        1
                    ],
                    [
                        44,
                        1
                    ],
                    [
                        44,
                        3
                    ],
                    [
                        44,
                        3
                    ],
                    [
                        45,
                        1
                    ],
                    [
                        45,
                        3
                    ],
                    [
                        45,
                        3
                    ],
                    [
                        48,
                        1
                    ],
                    [
                        51,
                        1
                    ],
                    [
                        52,
                        1
                    ],
                    [
                        52,
                        2
                    ],
                    [
                        53,
                        1
                    ],
                    [
                        53,
                        3
                    ],
                    [
                        55,
                        1
                    ],
                    [
                        55,
                        2
                    ],
                    [
                        55,
                        4
                    ],
                    [
                        55,
                        3
                    ],
                    [
                        55,
                        3
                    ],
                    [
                        55,
                        2
                    ],
                    [
                        57,
                        1
                    ],
                    [
                        57,
                        1
                    ],
                    [
                        57,
                        1
                    ],
                    [
                        57,
                        1
                    ],
                    [
                        57,
                        3
                    ],
                    [
                        57,
                        3
                    ],
                    [
                        57,
                        1
                    ],
                    [
                        10,
                        5
                    ],
                    [
                        10,
                        7
                    ],
                    [
                        12,
                        2
                    ],
                    [
                        12,
                        3
                    ],
                    [
                        11,
                        2
                    ],
                    [
                        33,
                        1
                    ],
                    [
                        33,
                        3
                    ],
                    [
                        25,
                        3
                    ],
                    [
                        26,
                        2
                    ],
                    [
                        18,
                        1
                    ],
                    [
                        18,
                        1
                    ],
                    [
                        18,
                        1
                    ],
                    [
                        18,
                        1
                    ],
                    [
                        18,
                        1
                    ],
                    [
                        7,
                        8
                    ],
                    [
                        7,
                        7
                    ],
                    [
                        80,
                        2
                    ],
                    [
                        80,
                        4
                    ],
                    [
                        78,
                        1
                    ],
                    [
                        79,
                        0
                    ]
                ],
                performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$) {
                    /* this == yyval */
                    var $0 = $$.length - 1;
                    switch (yystate) {
                    case 1:
                        return this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.Program($$[$0]));
                        break;
                    case 2:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])([$$[$0]]);
                        break;
                    case 3:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])([$$[$0 - 1]].concat($$[$0]));
                        break;
                    case 4:
                        this.$ = $$[$0];
                        break;
                    case 5:
                        this.$ = $$[$0];
                        break;
                    case 6:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])([$$[$0]]);
                        break;
                    case 7:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])([$$[$0 - 1]].concat($$[$0]));
                        break;
                    case 8:
                        this.$ = $$[$0];
                        break;
                    case 9:
                        this.$ = $$[$0];
                        break;
                    case 10:
                        this.$ = $$[$0];
                        break;
                    case 11:
                        this.$ = $$[$0];
                        break;
                    case 12:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(void 0);
                        break;
                    case 13:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.ExpressionStatement($$[$0 - 1]));
                        break;
                    case 14:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.ExpressionList($$[$0]));
                        break;
                    case 15:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])($$[$0].prepend($$[$0 - 2]));
                        break;
                    case 16:
                        this.$ = $$[$0];
                        break;
                    case 17:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.BinaryExpression($$[$0 - 2], $$[$0 - 1], $$[$0]));
                        break;
                    case 18:
                        this.$ = $$[$0];
                        break;
                    case 19:
                        this.$ = $$[$0];
                        break;
                    case 20:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.DeclarationExpression($$[$0 - 1], $$[$0], 0));
                        break;
                    case 21:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])([$$[$0]]);
                        break;
                    case 22:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.VariableDeclaration($$[$0]));
                        break;
                    case 23:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.VariableDeclaration($$[$0 - 1], $$[$0]));
                        break;
                    case 24:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.VariableDeclaration($$[$0 - 1], $$[$0]));
                        break;
                    case 25:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.Null());
                        break;
                    case 26:
                        this.$ = $$[$0];
                        break;
                    case 27:
                        this.$ = $$[$0];
                        break;
                    case 28:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.TypeDeclaration($$[$0], 0));
                        break;
                    case 29:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.TypeDeclaration($$[$0 - 1], 1));
                        break;
                    case 30:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.TypeDeclaration($$[$0 - 1], 0));
                        break;
                    case 31:
                        this.$ = yy.addLocationDataFn(_$[$0 - 3], _$[$0])(new yy.TypeDeclaration($$[$0 - 2], 1));
                        break;
                    case 32:
                        this.$ = $$[$0];
                        break;
                    case 33:
                        this.$ = $$[$0];
                        break;
                    case 34:
                        this.$ = $$[$0];
                        break;
                    case 35:
                        this.$ = $$[$0];
                        break;
                    case 36:
                        this.$ = $$[$0];
                        break;
                    case 37:
                        this.$ = $$[$0];
                        break;
                    case 38:
                        this.$ = $$[$0];
                        break;
                    case 39:
                        this.$ = $$[$0];
                        break;
                    case 40:
                        this.$ = $$[$0];
                        break;
                    case 41:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.BinaryExpression($$[$0 - 2], new yy.LtOperator(), $$[$0]));
                        break;
                    case 42:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.BinaryExpression($$[$0 - 2], new yy.GtOperator(), $$[$0]));
                        break;
                    case 43:
                        this.$ = $$[$0];
                        break;
                    case 44:
                        this.$ = $$[$0];
                        break;
                    case 45:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.BinaryExpression($$[$0 - 2], new yy.PlusOperator(), $$[$0]));
                        break;
                    case 46:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.BinaryExpression($$[$0 - 2], new yy.MinusOperator(), $$[$0]));
                        break;
                    case 47:
                        this.$ = $$[$0];
                        break;
                    case 48:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.BinaryExpression($$[$0 - 2], new yy.TimesOperator(), $$[$0]));
                        break;
                    case 49:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.BinaryExpression($$[$0 - 2], new yy.DivideOperator(), $$[$0]));
                        break;
                    case 50:
                        this.$ = $$[$0];
                        break;
                    case 51:
                        this.$ = $$[$0];
                        break;
                    case 52:
                        this.$ = $$[$0];
                        break;
                    case 53:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.UnaryExpression(new yy.PrefixPlusPlusOperator(), $$[$0]));
                        break;
                    case 54:
                        this.$ = $$[$0];
                        break;
                    case 55:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.DurExpression($$[$0 - 2], $$[$0]));
                        break;
                    case 56:
                        this.$ = $$[$0];
                        break;
                    case 57:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.ArrayExpression($$[$0 - 1], $$[$0]));
                        break;
                    case 58:
                        this.$ = yy.addLocationDataFn(_$[$0 - 3], _$[$0])(new yy.FuncCallExpression($$[$0 - 3], $$[$0 - 1]));
                        break;
                    case 59:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.FuncCallExpression($$[$0 - 2]));
                        break;
                    case 60:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.DotMemberExpression($$[$0 - 2], $$[$0]));
                        break;
                    case 61:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.PostfixExpression($$[$0 - 1], new yy.PostfixPlusPlusOperator()));
                        break;
                    case 62:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.PrimaryVariableExpression($$[$0]));
                        break;
                    case 63:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.PrimaryIntExpression($$[$0]));
                        break;
                    case 64:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.PrimaryFloatExpression($$[$0]));
                        break;
                    case 65:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.PrimaryStringExpression($$[$0]));
                        break;
                    case 66:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.PrimaryHackExpression($$[$0 - 1]));
                        break;
                    case 67:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])($$[$0 - 1]);
                        break;
                    case 68:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.PrimaryArrayExpression($$[$0]));
                        break;
                    case 69:
                        this.$ = yy.addLocationDataFn(_$[$0 - 4], _$[$0])(new yy.WhileStatement($$[$0 - 2], $$[$0]));
                        break;
                    case 70:
                        this.$ = yy.addLocationDataFn(_$[$0 - 6], _$[$0])(new yy.ForStatement($$[$0 - 4], $$[$0 - 3], $$[$0 - 2], $$[$0]));
                        break;
                    case 71:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.CodeStatement());
                        break;
                    case 72:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.CodeStatement($$[$0 - 1]));
                        break;
                    case 73:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.BreakStatement());
                        break;
                    case 74:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])([$$[$0]]);
                        break;
                    case 75:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])($$[$0].push($$[$0 - 2]));
                        break;
                    case 76:
                        this.$ = yy.addLocationDataFn(_$[$0 - 2], _$[$0])(new yy.ArraySub($$[$0 - 1]));
                        break;
                    case 77:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])(new yy.ArraySub());
                        break;
                    case 78:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.ChuckOperator());
                        break;
                    case 79:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.AtChuckOperator());
                        break;
                    case 80:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.PlusChuckOperator());
                        break;
                    case 81:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.MinusChuckOperator());
                        break;
                    case 82:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(new yy.UnchuckOperator());
                        break;
                    case 83:
                        this.$ = yy.addLocationDataFn(_$[$0 - 7], _$[$0])(new yy.FunctionDefinition($$[$0 - 7], $$[$0 - 6], $$[$0 - 5], $$[$0 - 4], $$[$0 - 2], $$[$0]));
                        break;
                    case 84:
                        this.$ = yy.addLocationDataFn(_$[$0 - 6], _$[$0])(new yy.FunctionDefinition($$[$0 - 6], $$[$0 - 5], $$[$0 - 4], $$[$0 - 3], [], $$[$0]));
                        break;
                    case 85:
                        this.$ = yy.addLocationDataFn(_$[$0 - 1], _$[$0])([new yy.Arg($$[$0 - 1], $$[$0])]);
                        break;
                    case 86:
                        this.$ = yy.addLocationDataFn(_$[$0 - 3], _$[$0])([new yy.Arg($$[$0 - 3], $$[$0 - 2])].concat($$[$0]));
                        break;
                    case 87:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(function () {
                        }());
                        break;
                    case 88:
                        this.$ = yy.addLocationDataFn(_$[$0], _$[$0])(function () {
                        }());
                        break;
                    }
                },
                table: [
                    {
                        3: 1,
                        4: 2,
                        5: 3,
                        6: 4,
                        7: 5,
                        8: 6,
                        9: 8,
                        10: 9,
                        11: 10,
                        12: 11,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        66: [
                            1,
                            15
                        ],
                        67: [
                            1,
                            16
                        ],
                        68: [
                            1,
                            18
                        ],
                        70: [
                            1,
                            17
                        ],
                        71: [
                            1,
                            51
                        ],
                        78: 7,
                        81: [
                            1,
                            12
                        ]
                    },
                    { 1: [3] },
                    {
                        1: [
                            2,
                            1
                        ]
                    },
                    {
                        1: [
                            2,
                            2
                        ],
                        4: 52,
                        5: 3,
                        6: 4,
                        7: 5,
                        8: 6,
                        9: 8,
                        10: 9,
                        11: 10,
                        12: 11,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        66: [
                            1,
                            15
                        ],
                        67: [
                            1,
                            16
                        ],
                        68: [
                            1,
                            18
                        ],
                        70: [
                            1,
                            17
                        ],
                        71: [
                            1,
                            51
                        ],
                        78: 7,
                        81: [
                            1,
                            12
                        ]
                    },
                    {
                        1: [
                            2,
                            4
                        ],
                        13: [
                            2,
                            4
                        ],
                        24: [
                            2,
                            4
                        ],
                        32: [
                            2,
                            4
                        ],
                        54: [
                            2,
                            4
                        ],
                        58: [
                            2,
                            4
                        ],
                        61: [
                            2,
                            4
                        ],
                        62: [
                            2,
                            4
                        ],
                        63: [
                            2,
                            4
                        ],
                        64: [
                            2,
                            4
                        ],
                        66: [
                            2,
                            4
                        ],
                        67: [
                            2,
                            4
                        ],
                        68: [
                            2,
                            4
                        ],
                        70: [
                            2,
                            4
                        ],
                        71: [
                            2,
                            4
                        ],
                        81: [
                            2,
                            4
                        ]
                    },
                    {
                        1: [
                            2,
                            5
                        ],
                        13: [
                            2,
                            5
                        ],
                        24: [
                            2,
                            5
                        ],
                        32: [
                            2,
                            5
                        ],
                        54: [
                            2,
                            5
                        ],
                        58: [
                            2,
                            5
                        ],
                        61: [
                            2,
                            5
                        ],
                        62: [
                            2,
                            5
                        ],
                        63: [
                            2,
                            5
                        ],
                        64: [
                            2,
                            5
                        ],
                        66: [
                            2,
                            5
                        ],
                        67: [
                            2,
                            5
                        ],
                        68: [
                            2,
                            5
                        ],
                        70: [
                            2,
                            5
                        ],
                        71: [
                            2,
                            5
                        ],
                        81: [
                            2,
                            5
                        ]
                    },
                    {
                        1: [
                            2,
                            6
                        ],
                        6: 53,
                        8: 6,
                        9: 8,
                        10: 9,
                        11: 10,
                        12: 11,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        66: [
                            1,
                            15
                        ],
                        67: [
                            1,
                            16
                        ],
                        68: [
                            1,
                            18
                        ],
                        69: [
                            2,
                            6
                        ],
                        70: [
                            1,
                            17
                        ],
                        71: [
                            1,
                            51
                        ],
                        81: [
                            2,
                            6
                        ]
                    },
                    {
                        24: [
                            2,
                            88
                        ],
                        32: [
                            2,
                            88
                        ],
                        79: 54
                    },
                    {
                        1: [
                            2,
                            8
                        ],
                        13: [
                            2,
                            8
                        ],
                        24: [
                            2,
                            8
                        ],
                        32: [
                            2,
                            8
                        ],
                        54: [
                            2,
                            8
                        ],
                        58: [
                            2,
                            8
                        ],
                        61: [
                            2,
                            8
                        ],
                        62: [
                            2,
                            8
                        ],
                        63: [
                            2,
                            8
                        ],
                        64: [
                            2,
                            8
                        ],
                        66: [
                            2,
                            8
                        ],
                        67: [
                            2,
                            8
                        ],
                        68: [
                            2,
                            8
                        ],
                        69: [
                            2,
                            8
                        ],
                        70: [
                            2,
                            8
                        ],
                        71: [
                            2,
                            8
                        ],
                        81: [
                            2,
                            8
                        ]
                    },
                    {
                        1: [
                            2,
                            9
                        ],
                        13: [
                            2,
                            9
                        ],
                        24: [
                            2,
                            9
                        ],
                        32: [
                            2,
                            9
                        ],
                        54: [
                            2,
                            9
                        ],
                        58: [
                            2,
                            9
                        ],
                        61: [
                            2,
                            9
                        ],
                        62: [
                            2,
                            9
                        ],
                        63: [
                            2,
                            9
                        ],
                        64: [
                            2,
                            9
                        ],
                        66: [
                            2,
                            9
                        ],
                        67: [
                            2,
                            9
                        ],
                        68: [
                            2,
                            9
                        ],
                        69: [
                            2,
                            9
                        ],
                        70: [
                            2,
                            9
                        ],
                        71: [
                            2,
                            9
                        ],
                        81: [
                            2,
                            9
                        ]
                    },
                    {
                        1: [
                            2,
                            10
                        ],
                        13: [
                            2,
                            10
                        ],
                        24: [
                            2,
                            10
                        ],
                        32: [
                            2,
                            10
                        ],
                        54: [
                            2,
                            10
                        ],
                        58: [
                            2,
                            10
                        ],
                        61: [
                            2,
                            10
                        ],
                        62: [
                            2,
                            10
                        ],
                        63: [
                            2,
                            10
                        ],
                        64: [
                            2,
                            10
                        ],
                        66: [
                            2,
                            10
                        ],
                        67: [
                            2,
                            10
                        ],
                        68: [
                            2,
                            10
                        ],
                        69: [
                            2,
                            10
                        ],
                        70: [
                            2,
                            10
                        ],
                        71: [
                            2,
                            10
                        ],
                        81: [
                            2,
                            10
                        ]
                    },
                    {
                        1: [
                            2,
                            11
                        ],
                        13: [
                            2,
                            11
                        ],
                        24: [
                            2,
                            11
                        ],
                        32: [
                            2,
                            11
                        ],
                        54: [
                            2,
                            11
                        ],
                        58: [
                            2,
                            11
                        ],
                        61: [
                            2,
                            11
                        ],
                        62: [
                            2,
                            11
                        ],
                        63: [
                            2,
                            11
                        ],
                        64: [
                            2,
                            11
                        ],
                        66: [
                            2,
                            11
                        ],
                        67: [
                            2,
                            11
                        ],
                        68: [
                            2,
                            11
                        ],
                        69: [
                            2,
                            11
                        ],
                        70: [
                            2,
                            11
                        ],
                        71: [
                            2,
                            11
                        ],
                        81: [
                            2,
                            11
                        ]
                    },
                    {
                        24: [
                            2,
                            87
                        ],
                        32: [
                            2,
                            87
                        ]
                    },
                    {
                        1: [
                            2,
                            12
                        ],
                        13: [
                            2,
                            12
                        ],
                        24: [
                            2,
                            12
                        ],
                        32: [
                            2,
                            12
                        ],
                        54: [
                            2,
                            12
                        ],
                        58: [
                            2,
                            12
                        ],
                        61: [
                            2,
                            12
                        ],
                        62: [
                            2,
                            12
                        ],
                        63: [
                            2,
                            12
                        ],
                        64: [
                            2,
                            12
                        ],
                        66: [
                            2,
                            12
                        ],
                        67: [
                            2,
                            12
                        ],
                        68: [
                            2,
                            12
                        ],
                        69: [
                            2,
                            12
                        ],
                        70: [
                            2,
                            12
                        ],
                        71: [
                            2,
                            12
                        ],
                        81: [
                            2,
                            12
                        ]
                    },
                    {
                        13: [
                            1,
                            55
                        ]
                    },
                    {
                        58: [
                            1,
                            56
                        ]
                    },
                    {
                        58: [
                            1,
                            57
                        ]
                    },
                    {
                        13: [
                            1,
                            58
                        ]
                    },
                    {
                        6: 60,
                        8: 6,
                        9: 8,
                        10: 9,
                        11: 10,
                        12: 11,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        66: [
                            1,
                            15
                        ],
                        67: [
                            1,
                            16
                        ],
                        68: [
                            1,
                            18
                        ],
                        69: [
                            1,
                            59
                        ],
                        70: [
                            1,
                            17
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        13: [
                            2,
                            14
                        ],
                        16: [
                            1,
                            61
                        ],
                        18: 62,
                        59: [
                            2,
                            14
                        ],
                        65: [
                            2,
                            14
                        ],
                        72: [
                            2,
                            14
                        ],
                        73: [
                            1,
                            63
                        ],
                        74: [
                            1,
                            64
                        ],
                        75: [
                            1,
                            65
                        ],
                        76: [
                            1,
                            66
                        ],
                        77: [
                            1,
                            67
                        ]
                    },
                    {
                        13: [
                            2,
                            16
                        ],
                        16: [
                            2,
                            16
                        ],
                        59: [
                            2,
                            16
                        ],
                        65: [
                            2,
                            16
                        ],
                        72: [
                            2,
                            16
                        ],
                        73: [
                            2,
                            16
                        ],
                        74: [
                            2,
                            16
                        ],
                        75: [
                            2,
                            16
                        ],
                        76: [
                            2,
                            16
                        ],
                        77: [
                            2,
                            16
                        ]
                    },
                    {
                        13: [
                            2,
                            18
                        ],
                        16: [
                            2,
                            18
                        ],
                        59: [
                            2,
                            18
                        ],
                        65: [
                            2,
                            18
                        ],
                        72: [
                            2,
                            18
                        ],
                        73: [
                            2,
                            18
                        ],
                        74: [
                            2,
                            18
                        ],
                        75: [
                            2,
                            18
                        ],
                        76: [
                            2,
                            18
                        ],
                        77: [
                            2,
                            18
                        ]
                    },
                    {
                        13: [
                            2,
                            19
                        ],
                        16: [
                            2,
                            19
                        ],
                        59: [
                            2,
                            19
                        ],
                        65: [
                            2,
                            19
                        ],
                        72: [
                            2,
                            19
                        ],
                        73: [
                            2,
                            19
                        ],
                        74: [
                            2,
                            19
                        ],
                        75: [
                            2,
                            19
                        ],
                        76: [
                            2,
                            19
                        ],
                        77: [
                            2,
                            19
                        ]
                    },
                    {
                        22: 68,
                        23: 69,
                        24: [
                            1,
                            70
                        ]
                    },
                    {
                        13: [
                            2,
                            33
                        ],
                        16: [
                            2,
                            33
                        ],
                        59: [
                            2,
                            33
                        ],
                        65: [
                            2,
                            33
                        ],
                        72: [
                            2,
                            33
                        ],
                        73: [
                            2,
                            33
                        ],
                        74: [
                            2,
                            33
                        ],
                        75: [
                            2,
                            33
                        ],
                        76: [
                            2,
                            33
                        ],
                        77: [
                            2,
                            33
                        ]
                    },
                    {
                        24: [
                            2,
                            26
                        ]
                    },
                    {
                        24: [
                            2,
                            27
                        ]
                    },
                    {
                        13: [
                            2,
                            34
                        ],
                        16: [
                            2,
                            34
                        ],
                        59: [
                            2,
                            34
                        ],
                        65: [
                            2,
                            34
                        ],
                        72: [
                            2,
                            34
                        ],
                        73: [
                            2,
                            34
                        ],
                        74: [
                            2,
                            34
                        ],
                        75: [
                            2,
                            34
                        ],
                        76: [
                            2,
                            34
                        ],
                        77: [
                            2,
                            34
                        ]
                    },
                    {
                        13: [
                            2,
                            62
                        ],
                        16: [
                            2,
                            62
                        ],
                        24: [
                            2,
                            28
                        ],
                        31: [
                            1,
                            71
                        ],
                        32: [
                            2,
                            62
                        ],
                        34: [
                            2,
                            62
                        ],
                        46: [
                            2,
                            62
                        ],
                        47: [
                            2,
                            62
                        ],
                        49: [
                            2,
                            62
                        ],
                        50: [
                            2,
                            62
                        ],
                        54: [
                            2,
                            62
                        ],
                        56: [
                            2,
                            62
                        ],
                        58: [
                            2,
                            62
                        ],
                        59: [
                            2,
                            62
                        ],
                        60: [
                            2,
                            62
                        ],
                        65: [
                            2,
                            62
                        ],
                        71: [
                            2,
                            62
                        ],
                        72: [
                            2,
                            62
                        ],
                        73: [
                            2,
                            62
                        ],
                        74: [
                            2,
                            62
                        ],
                        75: [
                            2,
                            62
                        ],
                        76: [
                            2,
                            62
                        ],
                        77: [
                            2,
                            62
                        ]
                    },
                    {
                        24: [
                            1,
                            73
                        ],
                        33: 72
                    },
                    {
                        13: [
                            2,
                            35
                        ],
                        16: [
                            2,
                            35
                        ],
                        59: [
                            2,
                            35
                        ],
                        65: [
                            2,
                            35
                        ],
                        72: [
                            2,
                            35
                        ],
                        73: [
                            2,
                            35
                        ],
                        74: [
                            2,
                            35
                        ],
                        75: [
                            2,
                            35
                        ],
                        76: [
                            2,
                            35
                        ],
                        77: [
                            2,
                            35
                        ]
                    },
                    {
                        13: [
                            2,
                            36
                        ],
                        16: [
                            2,
                            36
                        ],
                        59: [
                            2,
                            36
                        ],
                        65: [
                            2,
                            36
                        ],
                        72: [
                            2,
                            36
                        ],
                        73: [
                            2,
                            36
                        ],
                        74: [
                            2,
                            36
                        ],
                        75: [
                            2,
                            36
                        ],
                        76: [
                            2,
                            36
                        ],
                        77: [
                            2,
                            36
                        ]
                    },
                    {
                        13: [
                            2,
                            37
                        ],
                        16: [
                            2,
                            37
                        ],
                        59: [
                            2,
                            37
                        ],
                        65: [
                            2,
                            37
                        ],
                        72: [
                            2,
                            37
                        ],
                        73: [
                            2,
                            37
                        ],
                        74: [
                            2,
                            37
                        ],
                        75: [
                            2,
                            37
                        ],
                        76: [
                            2,
                            37
                        ],
                        77: [
                            2,
                            37
                        ]
                    },
                    {
                        13: [
                            2,
                            38
                        ],
                        16: [
                            2,
                            38
                        ],
                        59: [
                            2,
                            38
                        ],
                        65: [
                            2,
                            38
                        ],
                        72: [
                            2,
                            38
                        ],
                        73: [
                            2,
                            38
                        ],
                        74: [
                            2,
                            38
                        ],
                        75: [
                            2,
                            38
                        ],
                        76: [
                            2,
                            38
                        ],
                        77: [
                            2,
                            38
                        ]
                    },
                    {
                        13: [
                            2,
                            39
                        ],
                        16: [
                            2,
                            39
                        ],
                        32: [
                            1,
                            74
                        ],
                        34: [
                            1,
                            75
                        ],
                        59: [
                            2,
                            39
                        ],
                        65: [
                            2,
                            39
                        ],
                        72: [
                            2,
                            39
                        ],
                        73: [
                            2,
                            39
                        ],
                        74: [
                            2,
                            39
                        ],
                        75: [
                            2,
                            39
                        ],
                        76: [
                            2,
                            39
                        ],
                        77: [
                            2,
                            39
                        ]
                    },
                    {
                        13: [
                            2,
                            40
                        ],
                        16: [
                            2,
                            40
                        ],
                        32: [
                            2,
                            40
                        ],
                        34: [
                            2,
                            40
                        ],
                        59: [
                            2,
                            40
                        ],
                        65: [
                            2,
                            40
                        ],
                        72: [
                            2,
                            40
                        ],
                        73: [
                            2,
                            40
                        ],
                        74: [
                            2,
                            40
                        ],
                        75: [
                            2,
                            40
                        ],
                        76: [
                            2,
                            40
                        ],
                        77: [
                            2,
                            40
                        ]
                    },
                    {
                        13: [
                            2,
                            43
                        ],
                        16: [
                            2,
                            43
                        ],
                        32: [
                            2,
                            43
                        ],
                        34: [
                            2,
                            43
                        ],
                        46: [
                            1,
                            76
                        ],
                        47: [
                            1,
                            77
                        ],
                        59: [
                            2,
                            43
                        ],
                        65: [
                            2,
                            43
                        ],
                        72: [
                            2,
                            43
                        ],
                        73: [
                            2,
                            43
                        ],
                        74: [
                            2,
                            43
                        ],
                        75: [
                            2,
                            43
                        ],
                        76: [
                            2,
                            43
                        ],
                        77: [
                            2,
                            43
                        ]
                    },
                    {
                        13: [
                            2,
                            44
                        ],
                        16: [
                            2,
                            44
                        ],
                        32: [
                            2,
                            44
                        ],
                        34: [
                            2,
                            44
                        ],
                        46: [
                            2,
                            44
                        ],
                        47: [
                            2,
                            44
                        ],
                        49: [
                            1,
                            78
                        ],
                        50: [
                            1,
                            79
                        ],
                        59: [
                            2,
                            44
                        ],
                        65: [
                            2,
                            44
                        ],
                        72: [
                            2,
                            44
                        ],
                        73: [
                            2,
                            44
                        ],
                        74: [
                            2,
                            44
                        ],
                        75: [
                            2,
                            44
                        ],
                        76: [
                            2,
                            44
                        ],
                        77: [
                            2,
                            44
                        ]
                    },
                    {
                        13: [
                            2,
                            47
                        ],
                        16: [
                            2,
                            47
                        ],
                        32: [
                            2,
                            47
                        ],
                        34: [
                            2,
                            47
                        ],
                        46: [
                            2,
                            47
                        ],
                        47: [
                            2,
                            47
                        ],
                        49: [
                            2,
                            47
                        ],
                        50: [
                            2,
                            47
                        ],
                        59: [
                            2,
                            47
                        ],
                        65: [
                            2,
                            47
                        ],
                        72: [
                            2,
                            47
                        ],
                        73: [
                            2,
                            47
                        ],
                        74: [
                            2,
                            47
                        ],
                        75: [
                            2,
                            47
                        ],
                        76: [
                            2,
                            47
                        ],
                        77: [
                            2,
                            47
                        ]
                    },
                    {
                        13: [
                            2,
                            50
                        ],
                        16: [
                            2,
                            50
                        ],
                        32: [
                            2,
                            50
                        ],
                        34: [
                            2,
                            50
                        ],
                        46: [
                            2,
                            50
                        ],
                        47: [
                            2,
                            50
                        ],
                        49: [
                            2,
                            50
                        ],
                        50: [
                            2,
                            50
                        ],
                        59: [
                            2,
                            50
                        ],
                        65: [
                            2,
                            50
                        ],
                        72: [
                            2,
                            50
                        ],
                        73: [
                            2,
                            50
                        ],
                        74: [
                            2,
                            50
                        ],
                        75: [
                            2,
                            50
                        ],
                        76: [
                            2,
                            50
                        ],
                        77: [
                            2,
                            50
                        ]
                    },
                    {
                        13: [
                            2,
                            51
                        ],
                        16: [
                            2,
                            51
                        ],
                        32: [
                            2,
                            51
                        ],
                        34: [
                            2,
                            51
                        ],
                        46: [
                            2,
                            51
                        ],
                        47: [
                            2,
                            51
                        ],
                        49: [
                            2,
                            51
                        ],
                        50: [
                            2,
                            51
                        ],
                        59: [
                            2,
                            51
                        ],
                        65: [
                            2,
                            51
                        ],
                        72: [
                            2,
                            51
                        ],
                        73: [
                            2,
                            51
                        ],
                        74: [
                            2,
                            51
                        ],
                        75: [
                            2,
                            51
                        ],
                        76: [
                            2,
                            51
                        ],
                        77: [
                            2,
                            51
                        ]
                    },
                    {
                        13: [
                            2,
                            52
                        ],
                        16: [
                            2,
                            52
                        ],
                        32: [
                            2,
                            52
                        ],
                        34: [
                            2,
                            52
                        ],
                        46: [
                            2,
                            52
                        ],
                        47: [
                            2,
                            52
                        ],
                        49: [
                            2,
                            52
                        ],
                        50: [
                            2,
                            52
                        ],
                        56: [
                            1,
                            80
                        ],
                        59: [
                            2,
                            52
                        ],
                        65: [
                            2,
                            52
                        ],
                        72: [
                            2,
                            52
                        ],
                        73: [
                            2,
                            52
                        ],
                        74: [
                            2,
                            52
                        ],
                        75: [
                            2,
                            52
                        ],
                        76: [
                            2,
                            52
                        ],
                        77: [
                            2,
                            52
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        52: 81,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        13: [
                            2,
                            54
                        ],
                        16: [
                            2,
                            54
                        ],
                        25: 83,
                        32: [
                            2,
                            54
                        ],
                        34: [
                            2,
                            54
                        ],
                        46: [
                            2,
                            54
                        ],
                        47: [
                            2,
                            54
                        ],
                        49: [
                            2,
                            54
                        ],
                        50: [
                            2,
                            54
                        ],
                        54: [
                            1,
                            86
                        ],
                        56: [
                            2,
                            54
                        ],
                        58: [
                            1,
                            84
                        ],
                        59: [
                            2,
                            54
                        ],
                        60: [
                            1,
                            85
                        ],
                        65: [
                            2,
                            54
                        ],
                        71: [
                            1,
                            51
                        ],
                        72: [
                            2,
                            54
                        ],
                        73: [
                            2,
                            54
                        ],
                        74: [
                            2,
                            54
                        ],
                        75: [
                            2,
                            54
                        ],
                        76: [
                            2,
                            54
                        ],
                        77: [
                            2,
                            54
                        ]
                    },
                    {
                        13: [
                            2,
                            56
                        ],
                        16: [
                            2,
                            56
                        ],
                        32: [
                            2,
                            56
                        ],
                        34: [
                            2,
                            56
                        ],
                        46: [
                            2,
                            56
                        ],
                        47: [
                            2,
                            56
                        ],
                        49: [
                            2,
                            56
                        ],
                        50: [
                            2,
                            56
                        ],
                        54: [
                            2,
                            56
                        ],
                        56: [
                            2,
                            56
                        ],
                        58: [
                            2,
                            56
                        ],
                        59: [
                            2,
                            56
                        ],
                        60: [
                            2,
                            56
                        ],
                        65: [
                            2,
                            56
                        ],
                        71: [
                            2,
                            56
                        ],
                        72: [
                            2,
                            56
                        ],
                        73: [
                            2,
                            56
                        ],
                        74: [
                            2,
                            56
                        ],
                        75: [
                            2,
                            56
                        ],
                        76: [
                            2,
                            56
                        ],
                        77: [
                            2,
                            56
                        ]
                    },
                    {
                        13: [
                            2,
                            63
                        ],
                        16: [
                            2,
                            63
                        ],
                        32: [
                            2,
                            63
                        ],
                        34: [
                            2,
                            63
                        ],
                        46: [
                            2,
                            63
                        ],
                        47: [
                            2,
                            63
                        ],
                        49: [
                            2,
                            63
                        ],
                        50: [
                            2,
                            63
                        ],
                        54: [
                            2,
                            63
                        ],
                        56: [
                            2,
                            63
                        ],
                        58: [
                            2,
                            63
                        ],
                        59: [
                            2,
                            63
                        ],
                        60: [
                            2,
                            63
                        ],
                        65: [
                            2,
                            63
                        ],
                        71: [
                            2,
                            63
                        ],
                        72: [
                            2,
                            63
                        ],
                        73: [
                            2,
                            63
                        ],
                        74: [
                            2,
                            63
                        ],
                        75: [
                            2,
                            63
                        ],
                        76: [
                            2,
                            63
                        ],
                        77: [
                            2,
                            63
                        ]
                    },
                    {
                        13: [
                            2,
                            64
                        ],
                        16: [
                            2,
                            64
                        ],
                        32: [
                            2,
                            64
                        ],
                        34: [
                            2,
                            64
                        ],
                        46: [
                            2,
                            64
                        ],
                        47: [
                            2,
                            64
                        ],
                        49: [
                            2,
                            64
                        ],
                        50: [
                            2,
                            64
                        ],
                        54: [
                            2,
                            64
                        ],
                        56: [
                            2,
                            64
                        ],
                        58: [
                            2,
                            64
                        ],
                        59: [
                            2,
                            64
                        ],
                        60: [
                            2,
                            64
                        ],
                        65: [
                            2,
                            64
                        ],
                        71: [
                            2,
                            64
                        ],
                        72: [
                            2,
                            64
                        ],
                        73: [
                            2,
                            64
                        ],
                        74: [
                            2,
                            64
                        ],
                        75: [
                            2,
                            64
                        ],
                        76: [
                            2,
                            64
                        ],
                        77: [
                            2,
                            64
                        ]
                    },
                    {
                        13: [
                            2,
                            65
                        ],
                        16: [
                            2,
                            65
                        ],
                        32: [
                            2,
                            65
                        ],
                        34: [
                            2,
                            65
                        ],
                        46: [
                            2,
                            65
                        ],
                        47: [
                            2,
                            65
                        ],
                        49: [
                            2,
                            65
                        ],
                        50: [
                            2,
                            65
                        ],
                        54: [
                            2,
                            65
                        ],
                        56: [
                            2,
                            65
                        ],
                        58: [
                            2,
                            65
                        ],
                        59: [
                            2,
                            65
                        ],
                        60: [
                            2,
                            65
                        ],
                        65: [
                            2,
                            65
                        ],
                        71: [
                            2,
                            65
                        ],
                        72: [
                            2,
                            65
                        ],
                        73: [
                            2,
                            65
                        ],
                        74: [
                            2,
                            65
                        ],
                        75: [
                            2,
                            65
                        ],
                        76: [
                            2,
                            65
                        ],
                        77: [
                            2,
                            65
                        ]
                    },
                    {
                        14: 87,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        14: 88,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        13: [
                            2,
                            68
                        ],
                        16: [
                            2,
                            68
                        ],
                        32: [
                            2,
                            68
                        ],
                        34: [
                            2,
                            68
                        ],
                        46: [
                            2,
                            68
                        ],
                        47: [
                            2,
                            68
                        ],
                        49: [
                            2,
                            68
                        ],
                        50: [
                            2,
                            68
                        ],
                        54: [
                            2,
                            68
                        ],
                        56: [
                            2,
                            68
                        ],
                        58: [
                            2,
                            68
                        ],
                        59: [
                            2,
                            68
                        ],
                        60: [
                            2,
                            68
                        ],
                        65: [
                            2,
                            68
                        ],
                        71: [
                            2,
                            68
                        ],
                        72: [
                            2,
                            68
                        ],
                        73: [
                            2,
                            68
                        ],
                        74: [
                            2,
                            68
                        ],
                        75: [
                            2,
                            68
                        ],
                        76: [
                            2,
                            68
                        ],
                        77: [
                            2,
                            68
                        ]
                    },
                    {
                        14: 89,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        1: [
                            2,
                            3
                        ]
                    },
                    {
                        1: [
                            2,
                            7
                        ],
                        13: [
                            2,
                            7
                        ],
                        24: [
                            2,
                            7
                        ],
                        32: [
                            2,
                            7
                        ],
                        54: [
                            2,
                            7
                        ],
                        58: [
                            2,
                            7
                        ],
                        61: [
                            2,
                            7
                        ],
                        62: [
                            2,
                            7
                        ],
                        63: [
                            2,
                            7
                        ],
                        64: [
                            2,
                            7
                        ],
                        66: [
                            2,
                            7
                        ],
                        67: [
                            2,
                            7
                        ],
                        68: [
                            2,
                            7
                        ],
                        69: [
                            2,
                            7
                        ],
                        70: [
                            2,
                            7
                        ],
                        71: [
                            2,
                            7
                        ],
                        81: [
                            2,
                            7
                        ]
                    },
                    {
                        21: 91,
                        24: [
                            1,
                            92
                        ],
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        35: 90
                    },
                    {
                        1: [
                            2,
                            13
                        ],
                        13: [
                            2,
                            13
                        ],
                        24: [
                            2,
                            13
                        ],
                        32: [
                            2,
                            13
                        ],
                        54: [
                            2,
                            13
                        ],
                        58: [
                            2,
                            13
                        ],
                        61: [
                            2,
                            13
                        ],
                        62: [
                            2,
                            13
                        ],
                        63: [
                            2,
                            13
                        ],
                        64: [
                            2,
                            13
                        ],
                        66: [
                            2,
                            13
                        ],
                        67: [
                            2,
                            13
                        ],
                        68: [
                            2,
                            13
                        ],
                        69: [
                            2,
                            13
                        ],
                        70: [
                            2,
                            13
                        ],
                        71: [
                            2,
                            13
                        ],
                        81: [
                            2,
                            13
                        ]
                    },
                    {
                        14: 93,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        9: 94,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        1: [
                            2,
                            73
                        ],
                        13: [
                            2,
                            73
                        ],
                        24: [
                            2,
                            73
                        ],
                        32: [
                            2,
                            73
                        ],
                        54: [
                            2,
                            73
                        ],
                        58: [
                            2,
                            73
                        ],
                        61: [
                            2,
                            73
                        ],
                        62: [
                            2,
                            73
                        ],
                        63: [
                            2,
                            73
                        ],
                        64: [
                            2,
                            73
                        ],
                        66: [
                            2,
                            73
                        ],
                        67: [
                            2,
                            73
                        ],
                        68: [
                            2,
                            73
                        ],
                        69: [
                            2,
                            73
                        ],
                        70: [
                            2,
                            73
                        ],
                        71: [
                            2,
                            73
                        ],
                        81: [
                            2,
                            73
                        ]
                    },
                    {
                        1: [
                            2,
                            71
                        ],
                        13: [
                            2,
                            71
                        ],
                        24: [
                            2,
                            71
                        ],
                        32: [
                            2,
                            71
                        ],
                        54: [
                            2,
                            71
                        ],
                        58: [
                            2,
                            71
                        ],
                        61: [
                            2,
                            71
                        ],
                        62: [
                            2,
                            71
                        ],
                        63: [
                            2,
                            71
                        ],
                        64: [
                            2,
                            71
                        ],
                        66: [
                            2,
                            71
                        ],
                        67: [
                            2,
                            71
                        ],
                        68: [
                            2,
                            71
                        ],
                        69: [
                            2,
                            71
                        ],
                        70: [
                            2,
                            71
                        ],
                        71: [
                            2,
                            71
                        ],
                        81: [
                            2,
                            71
                        ]
                    },
                    {
                        69: [
                            1,
                            95
                        ]
                    },
                    {
                        14: 96,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        17: 97,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            2,
                            78
                        ],
                        32: [
                            2,
                            78
                        ],
                        54: [
                            2,
                            78
                        ],
                        58: [
                            2,
                            78
                        ],
                        61: [
                            2,
                            78
                        ],
                        62: [
                            2,
                            78
                        ],
                        63: [
                            2,
                            78
                        ],
                        64: [
                            2,
                            78
                        ],
                        71: [
                            2,
                            78
                        ]
                    },
                    {
                        24: [
                            2,
                            79
                        ],
                        32: [
                            2,
                            79
                        ],
                        54: [
                            2,
                            79
                        ],
                        58: [
                            2,
                            79
                        ],
                        61: [
                            2,
                            79
                        ],
                        62: [
                            2,
                            79
                        ],
                        63: [
                            2,
                            79
                        ],
                        64: [
                            2,
                            79
                        ],
                        71: [
                            2,
                            79
                        ]
                    },
                    {
                        24: [
                            2,
                            80
                        ],
                        32: [
                            2,
                            80
                        ],
                        54: [
                            2,
                            80
                        ],
                        58: [
                            2,
                            80
                        ],
                        61: [
                            2,
                            80
                        ],
                        62: [
                            2,
                            80
                        ],
                        63: [
                            2,
                            80
                        ],
                        64: [
                            2,
                            80
                        ],
                        71: [
                            2,
                            80
                        ]
                    },
                    {
                        24: [
                            2,
                            81
                        ],
                        32: [
                            2,
                            81
                        ],
                        54: [
                            2,
                            81
                        ],
                        58: [
                            2,
                            81
                        ],
                        61: [
                            2,
                            81
                        ],
                        62: [
                            2,
                            81
                        ],
                        63: [
                            2,
                            81
                        ],
                        64: [
                            2,
                            81
                        ],
                        71: [
                            2,
                            81
                        ]
                    },
                    {
                        24: [
                            2,
                            82
                        ],
                        32: [
                            2,
                            82
                        ],
                        54: [
                            2,
                            82
                        ],
                        58: [
                            2,
                            82
                        ],
                        61: [
                            2,
                            82
                        ],
                        62: [
                            2,
                            82
                        ],
                        63: [
                            2,
                            82
                        ],
                        64: [
                            2,
                            82
                        ],
                        71: [
                            2,
                            82
                        ]
                    },
                    {
                        13: [
                            2,
                            20
                        ],
                        16: [
                            2,
                            20
                        ],
                        59: [
                            2,
                            20
                        ],
                        65: [
                            2,
                            20
                        ],
                        72: [
                            2,
                            20
                        ],
                        73: [
                            2,
                            20
                        ],
                        74: [
                            2,
                            20
                        ],
                        75: [
                            2,
                            20
                        ],
                        76: [
                            2,
                            20
                        ],
                        77: [
                            2,
                            20
                        ]
                    },
                    {
                        13: [
                            2,
                            21
                        ],
                        16: [
                            2,
                            21
                        ],
                        59: [
                            2,
                            21
                        ],
                        65: [
                            2,
                            21
                        ],
                        72: [
                            2,
                            21
                        ],
                        73: [
                            2,
                            21
                        ],
                        74: [
                            2,
                            21
                        ],
                        75: [
                            2,
                            21
                        ],
                        76: [
                            2,
                            21
                        ],
                        77: [
                            2,
                            21
                        ]
                    },
                    {
                        13: [
                            2,
                            22
                        ],
                        16: [
                            2,
                            22
                        ],
                        25: 98,
                        26: 99,
                        59: [
                            2,
                            22
                        ],
                        65: [
                            2,
                            22
                        ],
                        71: [
                            1,
                            100
                        ],
                        72: [
                            2,
                            22
                        ],
                        73: [
                            2,
                            22
                        ],
                        74: [
                            2,
                            22
                        ],
                        75: [
                            2,
                            22
                        ],
                        76: [
                            2,
                            22
                        ],
                        77: [
                            2,
                            22
                        ]
                    },
                    {
                        24: [
                            2,
                            29
                        ]
                    },
                    {
                        34: [
                            1,
                            101
                        ]
                    },
                    {
                        34: [
                            2,
                            74
                        ],
                        60: [
                            1,
                            102
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        43: 103,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        43: 104,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        45: 105,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        45: 106,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        48: 107,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        48: 108,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            1,
                            82
                        ],
                        25: 50,
                        55: 109,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        13: [
                            2,
                            53
                        ],
                        16: [
                            2,
                            53
                        ],
                        32: [
                            2,
                            53
                        ],
                        34: [
                            2,
                            53
                        ],
                        46: [
                            2,
                            53
                        ],
                        47: [
                            2,
                            53
                        ],
                        49: [
                            2,
                            53
                        ],
                        50: [
                            2,
                            53
                        ],
                        59: [
                            2,
                            53
                        ],
                        65: [
                            2,
                            53
                        ],
                        72: [
                            2,
                            53
                        ],
                        73: [
                            2,
                            53
                        ],
                        74: [
                            2,
                            53
                        ],
                        75: [
                            2,
                            53
                        ],
                        76: [
                            2,
                            53
                        ],
                        77: [
                            2,
                            53
                        ]
                    },
                    {
                        13: [
                            2,
                            62
                        ],
                        16: [
                            2,
                            62
                        ],
                        32: [
                            2,
                            62
                        ],
                        34: [
                            2,
                            62
                        ],
                        46: [
                            2,
                            62
                        ],
                        47: [
                            2,
                            62
                        ],
                        49: [
                            2,
                            62
                        ],
                        50: [
                            2,
                            62
                        ],
                        54: [
                            2,
                            62
                        ],
                        56: [
                            2,
                            62
                        ],
                        58: [
                            2,
                            62
                        ],
                        59: [
                            2,
                            62
                        ],
                        60: [
                            2,
                            62
                        ],
                        65: [
                            2,
                            62
                        ],
                        71: [
                            2,
                            62
                        ],
                        72: [
                            2,
                            62
                        ],
                        73: [
                            2,
                            62
                        ],
                        74: [
                            2,
                            62
                        ],
                        75: [
                            2,
                            62
                        ],
                        76: [
                            2,
                            62
                        ],
                        77: [
                            2,
                            62
                        ]
                    },
                    {
                        13: [
                            2,
                            57
                        ],
                        16: [
                            2,
                            57
                        ],
                        32: [
                            2,
                            57
                        ],
                        34: [
                            2,
                            57
                        ],
                        46: [
                            2,
                            57
                        ],
                        47: [
                            2,
                            57
                        ],
                        49: [
                            2,
                            57
                        ],
                        50: [
                            2,
                            57
                        ],
                        54: [
                            2,
                            57
                        ],
                        56: [
                            2,
                            57
                        ],
                        58: [
                            2,
                            57
                        ],
                        59: [
                            2,
                            57
                        ],
                        60: [
                            2,
                            57
                        ],
                        65: [
                            2,
                            57
                        ],
                        71: [
                            2,
                            57
                        ],
                        72: [
                            2,
                            57
                        ],
                        73: [
                            2,
                            57
                        ],
                        74: [
                            2,
                            57
                        ],
                        75: [
                            2,
                            57
                        ],
                        76: [
                            2,
                            57
                        ],
                        77: [
                            2,
                            57
                        ]
                    },
                    {
                        14: 110,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        59: [
                            1,
                            111
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        24: [
                            1,
                            112
                        ]
                    },
                    {
                        13: [
                            2,
                            61
                        ],
                        16: [
                            2,
                            61
                        ],
                        32: [
                            2,
                            61
                        ],
                        34: [
                            2,
                            61
                        ],
                        46: [
                            2,
                            61
                        ],
                        47: [
                            2,
                            61
                        ],
                        49: [
                            2,
                            61
                        ],
                        50: [
                            2,
                            61
                        ],
                        54: [
                            2,
                            61
                        ],
                        56: [
                            2,
                            61
                        ],
                        58: [
                            2,
                            61
                        ],
                        59: [
                            2,
                            61
                        ],
                        60: [
                            2,
                            61
                        ],
                        65: [
                            2,
                            61
                        ],
                        71: [
                            2,
                            61
                        ],
                        72: [
                            2,
                            61
                        ],
                        73: [
                            2,
                            61
                        ],
                        74: [
                            2,
                            61
                        ],
                        75: [
                            2,
                            61
                        ],
                        76: [
                            2,
                            61
                        ],
                        77: [
                            2,
                            61
                        ]
                    },
                    {
                        65: [
                            1,
                            113
                        ]
                    },
                    {
                        59: [
                            1,
                            114
                        ]
                    },
                    {
                        72: [
                            1,
                            115
                        ]
                    },
                    {
                        24: [
                            1,
                            116
                        ]
                    },
                    {
                        24: [
                            2,
                            32
                        ]
                    },
                    {
                        24: [
                            2,
                            28
                        ],
                        31: [
                            1,
                            71
                        ]
                    },
                    {
                        59: [
                            1,
                            117
                        ]
                    },
                    {
                        9: 118,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        1: [
                            2,
                            72
                        ],
                        13: [
                            2,
                            72
                        ],
                        24: [
                            2,
                            72
                        ],
                        32: [
                            2,
                            72
                        ],
                        54: [
                            2,
                            72
                        ],
                        58: [
                            2,
                            72
                        ],
                        61: [
                            2,
                            72
                        ],
                        62: [
                            2,
                            72
                        ],
                        63: [
                            2,
                            72
                        ],
                        64: [
                            2,
                            72
                        ],
                        66: [
                            2,
                            72
                        ],
                        67: [
                            2,
                            72
                        ],
                        68: [
                            2,
                            72
                        ],
                        69: [
                            2,
                            72
                        ],
                        70: [
                            2,
                            72
                        ],
                        71: [
                            2,
                            72
                        ],
                        81: [
                            2,
                            72
                        ]
                    },
                    {
                        13: [
                            2,
                            15
                        ],
                        59: [
                            2,
                            15
                        ],
                        65: [
                            2,
                            15
                        ],
                        72: [
                            2,
                            15
                        ]
                    },
                    {
                        13: [
                            2,
                            17
                        ],
                        16: [
                            2,
                            17
                        ],
                        59: [
                            2,
                            17
                        ],
                        65: [
                            2,
                            17
                        ],
                        72: [
                            2,
                            17
                        ],
                        73: [
                            2,
                            17
                        ],
                        74: [
                            2,
                            17
                        ],
                        75: [
                            2,
                            17
                        ],
                        76: [
                            2,
                            17
                        ],
                        77: [
                            2,
                            17
                        ]
                    },
                    {
                        13: [
                            2,
                            23
                        ],
                        16: [
                            2,
                            23
                        ],
                        59: [
                            2,
                            23
                        ],
                        65: [
                            2,
                            23
                        ],
                        72: [
                            2,
                            23
                        ],
                        73: [
                            2,
                            23
                        ],
                        74: [
                            2,
                            23
                        ],
                        75: [
                            2,
                            23
                        ],
                        76: [
                            2,
                            23
                        ],
                        77: [
                            2,
                            23
                        ]
                    },
                    {
                        13: [
                            2,
                            24
                        ],
                        16: [
                            2,
                            24
                        ],
                        59: [
                            2,
                            24
                        ],
                        65: [
                            2,
                            24
                        ],
                        72: [
                            2,
                            24
                        ],
                        73: [
                            2,
                            24
                        ],
                        74: [
                            2,
                            24
                        ],
                        75: [
                            2,
                            24
                        ],
                        76: [
                            2,
                            24
                        ],
                        77: [
                            2,
                            24
                        ]
                    },
                    {
                        14: 89,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ],
                        72: [
                            1,
                            119
                        ]
                    },
                    {
                        24: [
                            2,
                            30
                        ],
                        31: [
                            1,
                            120
                        ]
                    },
                    {
                        24: [
                            1,
                            73
                        ],
                        33: 121
                    },
                    {
                        13: [
                            2,
                            41
                        ],
                        16: [
                            2,
                            41
                        ],
                        32: [
                            2,
                            41
                        ],
                        34: [
                            2,
                            41
                        ],
                        59: [
                            2,
                            41
                        ],
                        65: [
                            2,
                            41
                        ],
                        72: [
                            2,
                            41
                        ],
                        73: [
                            2,
                            41
                        ],
                        74: [
                            2,
                            41
                        ],
                        75: [
                            2,
                            41
                        ],
                        76: [
                            2,
                            41
                        ],
                        77: [
                            2,
                            41
                        ]
                    },
                    {
                        13: [
                            2,
                            42
                        ],
                        16: [
                            2,
                            42
                        ],
                        32: [
                            2,
                            42
                        ],
                        34: [
                            2,
                            42
                        ],
                        59: [
                            2,
                            42
                        ],
                        65: [
                            2,
                            42
                        ],
                        72: [
                            2,
                            42
                        ],
                        73: [
                            2,
                            42
                        ],
                        74: [
                            2,
                            42
                        ],
                        75: [
                            2,
                            42
                        ],
                        76: [
                            2,
                            42
                        ],
                        77: [
                            2,
                            42
                        ]
                    },
                    {
                        13: [
                            2,
                            45
                        ],
                        16: [
                            2,
                            45
                        ],
                        32: [
                            2,
                            45
                        ],
                        34: [
                            2,
                            45
                        ],
                        46: [
                            2,
                            45
                        ],
                        47: [
                            2,
                            45
                        ],
                        49: [
                            1,
                            78
                        ],
                        50: [
                            1,
                            79
                        ],
                        59: [
                            2,
                            45
                        ],
                        65: [
                            2,
                            45
                        ],
                        72: [
                            2,
                            45
                        ],
                        73: [
                            2,
                            45
                        ],
                        74: [
                            2,
                            45
                        ],
                        75: [
                            2,
                            45
                        ],
                        76: [
                            2,
                            45
                        ],
                        77: [
                            2,
                            45
                        ]
                    },
                    {
                        13: [
                            2,
                            46
                        ],
                        16: [
                            2,
                            46
                        ],
                        32: [
                            2,
                            46
                        ],
                        34: [
                            2,
                            46
                        ],
                        46: [
                            2,
                            46
                        ],
                        47: [
                            2,
                            46
                        ],
                        49: [
                            1,
                            78
                        ],
                        50: [
                            1,
                            79
                        ],
                        59: [
                            2,
                            46
                        ],
                        65: [
                            2,
                            46
                        ],
                        72: [
                            2,
                            46
                        ],
                        73: [
                            2,
                            46
                        ],
                        74: [
                            2,
                            46
                        ],
                        75: [
                            2,
                            46
                        ],
                        76: [
                            2,
                            46
                        ],
                        77: [
                            2,
                            46
                        ]
                    },
                    {
                        13: [
                            2,
                            48
                        ],
                        16: [
                            2,
                            48
                        ],
                        32: [
                            2,
                            48
                        ],
                        34: [
                            2,
                            48
                        ],
                        46: [
                            2,
                            48
                        ],
                        47: [
                            2,
                            48
                        ],
                        49: [
                            2,
                            48
                        ],
                        50: [
                            2,
                            48
                        ],
                        59: [
                            2,
                            48
                        ],
                        65: [
                            2,
                            48
                        ],
                        72: [
                            2,
                            48
                        ],
                        73: [
                            2,
                            48
                        ],
                        74: [
                            2,
                            48
                        ],
                        75: [
                            2,
                            48
                        ],
                        76: [
                            2,
                            48
                        ],
                        77: [
                            2,
                            48
                        ]
                    },
                    {
                        13: [
                            2,
                            49
                        ],
                        16: [
                            2,
                            49
                        ],
                        32: [
                            2,
                            49
                        ],
                        34: [
                            2,
                            49
                        ],
                        46: [
                            2,
                            49
                        ],
                        47: [
                            2,
                            49
                        ],
                        49: [
                            2,
                            49
                        ],
                        50: [
                            2,
                            49
                        ],
                        59: [
                            2,
                            49
                        ],
                        65: [
                            2,
                            49
                        ],
                        72: [
                            2,
                            49
                        ],
                        73: [
                            2,
                            49
                        ],
                        74: [
                            2,
                            49
                        ],
                        75: [
                            2,
                            49
                        ],
                        76: [
                            2,
                            49
                        ],
                        77: [
                            2,
                            49
                        ]
                    },
                    {
                        13: [
                            2,
                            55
                        ],
                        16: [
                            2,
                            55
                        ],
                        25: 83,
                        32: [
                            2,
                            55
                        ],
                        34: [
                            2,
                            55
                        ],
                        46: [
                            2,
                            55
                        ],
                        47: [
                            2,
                            55
                        ],
                        49: [
                            2,
                            55
                        ],
                        50: [
                            2,
                            55
                        ],
                        54: [
                            1,
                            86
                        ],
                        56: [
                            2,
                            55
                        ],
                        58: [
                            1,
                            84
                        ],
                        59: [
                            2,
                            55
                        ],
                        60: [
                            1,
                            85
                        ],
                        65: [
                            2,
                            55
                        ],
                        71: [
                            1,
                            51
                        ],
                        72: [
                            2,
                            55
                        ],
                        73: [
                            2,
                            55
                        ],
                        74: [
                            2,
                            55
                        ],
                        75: [
                            2,
                            55
                        ],
                        76: [
                            2,
                            55
                        ],
                        77: [
                            2,
                            55
                        ]
                    },
                    {
                        59: [
                            1,
                            122
                        ]
                    },
                    {
                        13: [
                            2,
                            59
                        ],
                        16: [
                            2,
                            59
                        ],
                        32: [
                            2,
                            59
                        ],
                        34: [
                            2,
                            59
                        ],
                        46: [
                            2,
                            59
                        ],
                        47: [
                            2,
                            59
                        ],
                        49: [
                            2,
                            59
                        ],
                        50: [
                            2,
                            59
                        ],
                        54: [
                            2,
                            59
                        ],
                        56: [
                            2,
                            59
                        ],
                        58: [
                            2,
                            59
                        ],
                        59: [
                            2,
                            59
                        ],
                        60: [
                            2,
                            59
                        ],
                        65: [
                            2,
                            59
                        ],
                        71: [
                            2,
                            59
                        ],
                        72: [
                            2,
                            59
                        ],
                        73: [
                            2,
                            59
                        ],
                        74: [
                            2,
                            59
                        ],
                        75: [
                            2,
                            59
                        ],
                        76: [
                            2,
                            59
                        ],
                        77: [
                            2,
                            59
                        ]
                    },
                    {
                        13: [
                            2,
                            60
                        ],
                        16: [
                            2,
                            60
                        ],
                        32: [
                            2,
                            60
                        ],
                        34: [
                            2,
                            60
                        ],
                        46: [
                            2,
                            60
                        ],
                        47: [
                            2,
                            60
                        ],
                        49: [
                            2,
                            60
                        ],
                        50: [
                            2,
                            60
                        ],
                        54: [
                            2,
                            60
                        ],
                        56: [
                            2,
                            60
                        ],
                        58: [
                            2,
                            60
                        ],
                        59: [
                            2,
                            60
                        ],
                        60: [
                            2,
                            60
                        ],
                        65: [
                            2,
                            60
                        ],
                        71: [
                            2,
                            60
                        ],
                        72: [
                            2,
                            60
                        ],
                        73: [
                            2,
                            60
                        ],
                        74: [
                            2,
                            60
                        ],
                        75: [
                            2,
                            60
                        ],
                        76: [
                            2,
                            60
                        ],
                        77: [
                            2,
                            60
                        ]
                    },
                    {
                        13: [
                            2,
                            66
                        ],
                        16: [
                            2,
                            66
                        ],
                        32: [
                            2,
                            66
                        ],
                        34: [
                            2,
                            66
                        ],
                        46: [
                            2,
                            66
                        ],
                        47: [
                            2,
                            66
                        ],
                        49: [
                            2,
                            66
                        ],
                        50: [
                            2,
                            66
                        ],
                        54: [
                            2,
                            66
                        ],
                        56: [
                            2,
                            66
                        ],
                        58: [
                            2,
                            66
                        ],
                        59: [
                            2,
                            66
                        ],
                        60: [
                            2,
                            66
                        ],
                        65: [
                            2,
                            66
                        ],
                        71: [
                            2,
                            66
                        ],
                        72: [
                            2,
                            66
                        ],
                        73: [
                            2,
                            66
                        ],
                        74: [
                            2,
                            66
                        ],
                        75: [
                            2,
                            66
                        ],
                        76: [
                            2,
                            66
                        ],
                        77: [
                            2,
                            66
                        ]
                    },
                    {
                        13: [
                            2,
                            67
                        ],
                        16: [
                            2,
                            67
                        ],
                        32: [
                            2,
                            67
                        ],
                        34: [
                            2,
                            67
                        ],
                        46: [
                            2,
                            67
                        ],
                        47: [
                            2,
                            67
                        ],
                        49: [
                            2,
                            67
                        ],
                        50: [
                            2,
                            67
                        ],
                        54: [
                            2,
                            67
                        ],
                        56: [
                            2,
                            67
                        ],
                        58: [
                            2,
                            67
                        ],
                        59: [
                            2,
                            67
                        ],
                        60: [
                            2,
                            67
                        ],
                        65: [
                            2,
                            67
                        ],
                        71: [
                            2,
                            67
                        ],
                        72: [
                            2,
                            67
                        ],
                        73: [
                            2,
                            67
                        ],
                        74: [
                            2,
                            67
                        ],
                        75: [
                            2,
                            67
                        ],
                        76: [
                            2,
                            67
                        ],
                        77: [
                            2,
                            67
                        ]
                    },
                    {
                        13: [
                            2,
                            76
                        ],
                        16: [
                            2,
                            76
                        ],
                        32: [
                            2,
                            76
                        ],
                        34: [
                            2,
                            76
                        ],
                        46: [
                            2,
                            76
                        ],
                        47: [
                            2,
                            76
                        ],
                        49: [
                            2,
                            76
                        ],
                        50: [
                            2,
                            76
                        ],
                        54: [
                            2,
                            76
                        ],
                        56: [
                            2,
                            76
                        ],
                        58: [
                            2,
                            76
                        ],
                        59: [
                            2,
                            76
                        ],
                        60: [
                            2,
                            76
                        ],
                        65: [
                            2,
                            76
                        ],
                        71: [
                            2,
                            76
                        ],
                        72: [
                            2,
                            76
                        ],
                        73: [
                            2,
                            76
                        ],
                        74: [
                            2,
                            76
                        ],
                        75: [
                            2,
                            76
                        ],
                        76: [
                            2,
                            76
                        ],
                        77: [
                            2,
                            76
                        ]
                    },
                    {
                        58: [
                            1,
                            123
                        ]
                    },
                    {
                        8: 124,
                        9: 8,
                        10: 9,
                        11: 10,
                        12: 11,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        66: [
                            1,
                            15
                        ],
                        67: [
                            1,
                            16
                        ],
                        68: [
                            1,
                            18
                        ],
                        70: [
                            1,
                            17
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        14: 125,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        13: [
                            2,
                            77
                        ],
                        16: [
                            2,
                            77
                        ],
                        59: [
                            2,
                            77
                        ],
                        65: [
                            2,
                            77
                        ],
                        72: [
                            2,
                            77
                        ],
                        73: [
                            2,
                            77
                        ],
                        74: [
                            2,
                            77
                        ],
                        75: [
                            2,
                            77
                        ],
                        76: [
                            2,
                            77
                        ],
                        77: [
                            2,
                            77
                        ]
                    },
                    {
                        24: [
                            2,
                            31
                        ]
                    },
                    {
                        34: [
                            2,
                            75
                        ]
                    },
                    {
                        13: [
                            2,
                            58
                        ],
                        16: [
                            2,
                            58
                        ],
                        32: [
                            2,
                            58
                        ],
                        34: [
                            2,
                            58
                        ],
                        46: [
                            2,
                            58
                        ],
                        47: [
                            2,
                            58
                        ],
                        49: [
                            2,
                            58
                        ],
                        50: [
                            2,
                            58
                        ],
                        54: [
                            2,
                            58
                        ],
                        56: [
                            2,
                            58
                        ],
                        58: [
                            2,
                            58
                        ],
                        59: [
                            2,
                            58
                        ],
                        60: [
                            2,
                            58
                        ],
                        65: [
                            2,
                            58
                        ],
                        71: [
                            2,
                            58
                        ],
                        72: [
                            2,
                            58
                        ],
                        73: [
                            2,
                            58
                        ],
                        74: [
                            2,
                            58
                        ],
                        75: [
                            2,
                            58
                        ],
                        76: [
                            2,
                            58
                        ],
                        77: [
                            2,
                            58
                        ]
                    },
                    {
                        21: 128,
                        24: [
                            1,
                            92
                        ],
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        59: [
                            1,
                            127
                        ],
                        80: 126
                    },
                    {
                        1: [
                            2,
                            69
                        ],
                        13: [
                            2,
                            69
                        ],
                        24: [
                            2,
                            69
                        ],
                        32: [
                            2,
                            69
                        ],
                        54: [
                            2,
                            69
                        ],
                        58: [
                            2,
                            69
                        ],
                        61: [
                            2,
                            69
                        ],
                        62: [
                            2,
                            69
                        ],
                        63: [
                            2,
                            69
                        ],
                        64: [
                            2,
                            69
                        ],
                        66: [
                            2,
                            69
                        ],
                        67: [
                            2,
                            69
                        ],
                        68: [
                            2,
                            69
                        ],
                        69: [
                            2,
                            69
                        ],
                        70: [
                            2,
                            69
                        ],
                        71: [
                            2,
                            69
                        ],
                        81: [
                            2,
                            69
                        ]
                    },
                    {
                        59: [
                            1,
                            129
                        ]
                    },
                    {
                        59: [
                            1,
                            130
                        ]
                    },
                    {
                        12: 131,
                        68: [
                            1,
                            18
                        ]
                    },
                    {
                        23: 132,
                        24: [
                            1,
                            70
                        ]
                    },
                    {
                        8: 133,
                        9: 8,
                        10: 9,
                        11: 10,
                        12: 11,
                        13: [
                            1,
                            13
                        ],
                        14: 14,
                        15: 19,
                        17: 20,
                        19: 21,
                        20: 22,
                        21: 23,
                        24: [
                            1,
                            28
                        ],
                        25: 50,
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        36: 24,
                        37: 27,
                        38: 30,
                        39: 31,
                        40: 32,
                        41: 33,
                        42: 34,
                        43: 35,
                        44: 36,
                        45: 37,
                        48: 38,
                        51: 39,
                        52: 40,
                        53: 41,
                        54: [
                            1,
                            42
                        ],
                        55: 43,
                        57: 44,
                        58: [
                            1,
                            49
                        ],
                        61: [
                            1,
                            45
                        ],
                        62: [
                            1,
                            46
                        ],
                        63: [
                            1,
                            47
                        ],
                        64: [
                            1,
                            48
                        ],
                        66: [
                            1,
                            15
                        ],
                        67: [
                            1,
                            16
                        ],
                        68: [
                            1,
                            18
                        ],
                        70: [
                            1,
                            17
                        ],
                        71: [
                            1,
                            51
                        ]
                    },
                    {
                        12: 134,
                        68: [
                            1,
                            18
                        ]
                    },
                    {
                        1: [
                            2,
                            84
                        ],
                        13: [
                            2,
                            84
                        ],
                        24: [
                            2,
                            84
                        ],
                        32: [
                            2,
                            84
                        ],
                        54: [
                            2,
                            84
                        ],
                        58: [
                            2,
                            84
                        ],
                        61: [
                            2,
                            84
                        ],
                        62: [
                            2,
                            84
                        ],
                        63: [
                            2,
                            84
                        ],
                        64: [
                            2,
                            84
                        ],
                        66: [
                            2,
                            84
                        ],
                        67: [
                            2,
                            84
                        ],
                        68: [
                            2,
                            84
                        ],
                        70: [
                            2,
                            84
                        ],
                        71: [
                            2,
                            84
                        ],
                        81: [
                            2,
                            84
                        ]
                    },
                    {
                        16: [
                            1,
                            135
                        ],
                        59: [
                            2,
                            85
                        ]
                    },
                    {
                        1: [
                            2,
                            70
                        ],
                        13: [
                            2,
                            70
                        ],
                        24: [
                            2,
                            70
                        ],
                        32: [
                            2,
                            70
                        ],
                        54: [
                            2,
                            70
                        ],
                        58: [
                            2,
                            70
                        ],
                        61: [
                            2,
                            70
                        ],
                        62: [
                            2,
                            70
                        ],
                        63: [
                            2,
                            70
                        ],
                        64: [
                            2,
                            70
                        ],
                        66: [
                            2,
                            70
                        ],
                        67: [
                            2,
                            70
                        ],
                        68: [
                            2,
                            70
                        ],
                        69: [
                            2,
                            70
                        ],
                        70: [
                            2,
                            70
                        ],
                        71: [
                            2,
                            70
                        ],
                        81: [
                            2,
                            70
                        ]
                    },
                    {
                        1: [
                            2,
                            83
                        ],
                        13: [
                            2,
                            83
                        ],
                        24: [
                            2,
                            83
                        ],
                        32: [
                            2,
                            83
                        ],
                        54: [
                            2,
                            83
                        ],
                        58: [
                            2,
                            83
                        ],
                        61: [
                            2,
                            83
                        ],
                        62: [
                            2,
                            83
                        ],
                        63: [
                            2,
                            83
                        ],
                        64: [
                            2,
                            83
                        ],
                        66: [
                            2,
                            83
                        ],
                        67: [
                            2,
                            83
                        ],
                        68: [
                            2,
                            83
                        ],
                        70: [
                            2,
                            83
                        ],
                        71: [
                            2,
                            83
                        ],
                        81: [
                            2,
                            83
                        ]
                    },
                    {
                        21: 128,
                        24: [
                            1,
                            92
                        ],
                        29: 25,
                        30: 26,
                        32: [
                            1,
                            29
                        ],
                        80: 136
                    },
                    {
                        59: [
                            2,
                            86
                        ]
                    }
                ],
                defaultActions: {
                    2: [
                        2,
                        1
                    ],
                    25: [
                        2,
                        26
                    ],
                    26: [
                        2,
                        27
                    ],
                    52: [
                        2,
                        3
                    ],
                    71: [
                        2,
                        29
                    ],
                    91: [
                        2,
                        32
                    ],
                    120: [
                        2,
                        31
                    ],
                    121: [
                        2,
                        75
                    ],
                    136: [
                        2,
                        86
                    ]
                },
                parseError: function parseError(str, hash) {
                    if (hash.recoverable) {
                        this.trace(str);
                    } else {
                        throw new Error(str);
                    }
                },
                parse: function parse(input) {
                    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
                    var args = lstack.slice.call(arguments, 1);
                    this.lexer.setInput(input);
                    this.lexer.yy = this.yy;
                    this.yy.lexer = this.lexer;
                    this.yy.parser = this;
                    if (typeof this.lexer.yylloc == 'undefined') {
                        this.lexer.yylloc = {};
                    }
                    var yyloc = this.lexer.yylloc;
                    lstack.push(yyloc);
                    var ranges = this.lexer.options && this.lexer.options.ranges;
                    if (typeof this.yy.parseError === 'function') {
                        this.parseError = this.yy.parseError;
                    } else {
                        this.parseError = Object.getPrototypeOf(this).parseError;
                    }
                    function popStack(n) {
                        stack.length = stack.length - 2 * n;
                        vstack.length = vstack.length - n;
                        lstack.length = lstack.length - n;
                    }
                    function lex() {
                        var token;
                        token = self.lexer.lex() || EOF;
                        if (typeof token !== 'number') {
                            token = self.symbols_[token] || token;
                        }
                        return token;
                    }
                    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
                    while (true) {
                        state = stack[stack.length - 1];
                        if (this.defaultActions[state]) {
                            action = this.defaultActions[state];
                        } else {
                            if (symbol === null || typeof symbol == 'undefined') {
                                symbol = lex();
                            }
                            action = table[state] && table[state][symbol];
                        }
                        if (typeof action === 'undefined' || !action.length || !action[0]) {
                            var errStr = '';
                            expected = [];
                            for (p in table[state]) {
                                if (this.terminals_[p] && p > TERROR) {
                                    expected.push('\'' + this.terminals_[p] + '\'');
                                }
                            }
                            if (this.lexer.showPosition) {
                                errStr = 'Parse error on line ' + (yylineno + 1) + ':\n' + this.lexer.showPosition() + '\nExpecting ' + expected.join(', ') + ', got \'' + (this.terminals_[symbol] || symbol) + '\'';
                            } else {
                                errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == EOF ? 'end of input' : '\'' + (this.terminals_[symbol] || symbol) + '\'');
                            }
                            this.parseError(errStr, {
                                text: this.lexer.match,
                                token: this.terminals_[symbol] || symbol,
                                line: this.lexer.yylineno,
                                loc: yyloc,
                                expected: expected
                            });
                        }
                        if (action[0] instanceof Array && action.length > 1) {
                            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
                        }
                        switch (action[0]) {
                        case 1:
                            stack.push(symbol);
                            vstack.push(this.lexer.yytext);
                            lstack.push(this.lexer.yylloc);
                            stack.push(action[1]);
                            symbol = null;
                            if (!preErrorSymbol) {
                                yyleng = this.lexer.yyleng;
                                yytext = this.lexer.yytext;
                                yylineno = this.lexer.yylineno;
                                yyloc = this.lexer.yylloc;
                                if (recovering > 0) {
                                    recovering--;
                                }
                            } else {
                                symbol = preErrorSymbol;
                                preErrorSymbol = null;
                            }
                            break;
                        case 2:
                            len = this.productions_[action[1]][1];
                            yyval.$ = vstack[vstack.length - len];
                            yyval._$ = {
                                first_line: lstack[lstack.length - (len || 1)].first_line,
                                last_line: lstack[lstack.length - 1].last_line,
                                first_column: lstack[lstack.length - (len || 1)].first_column,
                                last_column: lstack[lstack.length - 1].last_column
                            };
                            if (ranges) {
                                yyval._$.range = [
                                    lstack[lstack.length - (len || 1)].range[0],
                                    lstack[lstack.length - 1].range[1]
                                ];
                            }
                            r = this.performAction.apply(yyval, [
                                yytext,
                                yyleng,
                                yylineno,
                                this.yy,
                                action[1],
                                vstack,
                                lstack
                            ].concat(args));
                            if (typeof r !== 'undefined') {
                                return r;
                            }
                            if (len) {
                                stack = stack.slice(0, -1 * len * 2);
                                vstack = vstack.slice(0, -1 * len);
                                lstack = lstack.slice(0, -1 * len);
                            }
                            stack.push(this.productions_[action[1]][0]);
                            vstack.push(yyval.$);
                            lstack.push(yyval._$);
                            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
                            stack.push(newState);
                            break;
                        case 3:
                            return true;
                        }
                    }
                    return true;
                }
            };
        function Parser() {
            this.yy = {};
        }
        Parser.prototype = parser;
        parser.Parser = Parser;
        return new Parser();
    }();
if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
    exports.parser = parser;
    exports.Parser = parser.Parser;
    exports.parse = function () {
        return parser.parse.apply(parser, arguments);
    };
    exports.main = function commonjsMain(args) {
        if (!args[1]) {
            console.log('Usage: ' + args[0] + ' FILE');
            process.exit(1);
        }
        var source = fs.readFileSync(path.normalize(args[1]), 'utf8');
        return exports.parser.parse(source);
    };
    if (typeof module !== 'undefined' && require.main === module) {
        exports.main(process.argv.slice(1));
    }
}
window.ChuckParser = parser.Parser;
var chuck_parser = undefined;
if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
    window.Q = module.exports;
    exports.chuck = chuck;
    exports.Q = window.Q;
    module.exports = exports;
}
window.chuck = chuck;
var noamd = undefined;