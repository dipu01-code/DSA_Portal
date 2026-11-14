# Sandbox Decision — Code Execution for DSA Portal

## Candidate approaches compared

| Criterion              | child_process                                                     | worker_threads                                                        | vm (standalone)                                                          | isolated-vm                                               |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Isolation / security   | Separate OS process; can be killed from outside; no shared memory | Same process, separate V8 isolate; `terminate()` available            | Same process, same event loop; **not a security boundary** per Node docs | Separate V8 isolate; native addon; not a full OS boundary |
| Memory limits          | `--max-old-space-size` per process                                | `resourceLimits` (maxOldGenerationSizeMb)                             | None (inherits parent limit)                                             | `memoryLimit` via isolate config                          |
| Timeouts               | `execFileSync`/`spawn` timeout kills whole process                | `setTimeout` + `worker.terminate()`                                   | None (infinite loop blocks event loop)                                   | None (infinite loop blocks isolate)                       |
| Performance            | Process spawn overhead per run (~50–150 ms)                       | Faster spawn (isolate reuse)                                          | Fastest (no spawn)                                                       | Fast (isolate reuse)                                      |
| Windows/macOS/Linux    | Excellent (Node core)                                             | Good (Node core, some edge cases)                                     | Excellent (Node core)                                                    | Fair (native addon must compile per platform)             |
| Electron compatibility | Excellent (works in main/renderer)                                | Good (main process; renderer needs `nodeIntegration`/`contextBridge`) | Excellent                                                                | Poor (native addon rebuilds for Electron's Node version)  |

## Why not the others

- **vm (standalone):** Node.js docs explicitly state `vm` is **not a security mechanism**. `process.exit`, `require`, infinite loops, and `while(true){}` block the parent process/event loop. Unsafe for untrusted user code.
- **isolated-vm:** Strong isolation but a native addon. Requires recompilation for every Electron runtime version and every platform (Windows/macOS/Linux), adding CI complexity and native build failures. Overkill for a 10-day MVP.
- **worker_threads:** Good middle ground but still shares the OS process. A native crash or `process.exit` in a thread can affect the parent. Electron renderer support requires extra configuration. Memory limits are weaker than OS-level process limits.

## Chosen: child_process + vm inside

Each **submission** runs in its own `child_process` (spawned `node sandbox-exec.js`). Inside that child (Day 9 version):

1. Every test case gets a **fresh vm context** with no host objects: no `require`, `process`, `fs`, network, or host `console` (a capturing `console` is created inside the context). Nothing a test does is visible to the next.
2. Code generation from strings (`eval`, `Function`) and WebAssembly are disabled, so `x.constructor.constructor('return process')()` cannot reach the host.
3. **V8 stops each test** after the per-test timeout (`timeout` + `microtaskMode: 'afterEvaluate'`, so promise jobs count too). The host's `execFile` timeout is the hard backstop that kills the whole process.
4. `--max-old-space-size` caps memory; the output cap applies per test.
5. **Node's permission model** (Day 8): the child may read only the wrapper and its own temp dir, and may not write files, spawn processes or start worker threads. The env holds only `PATH`.
6. One JSON line per finished test, so a crash in test k keeps tests 0…k-1; the rest are marked "Not run".

**Trade-off:** one Node start (~40 ms) per submission. Day 3 started one per _test_, which made Node startup ~95% of judging CPU (see `load-test-report.md`; batching gave 3.7× throughput). Per-test isolation now comes from fresh contexts and V8 timeouts instead of fresh processes. The cost: a memory bomb ends the remaining tests of that one submission (same `error` verdict). Security and portability still win over raw speed; the next step for speed would be a warm pool of children.
