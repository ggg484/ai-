import type { CloudValue } from "./cloud-state.ts";
import { currentRoomHost } from "./host.ts";
import { admitAsyncRuntime, observeAsyncGeneration, captureAsyncSettlementTicket, scheduleDeferredSettlement, currentAsyncSettlementEpoch, registerAsyncSource, syncHostGeneration } from "./async-runtime.ts";
import { ASYNC_SOURCE_PLAYER_DATA, type PlayerDataHost, type PlayerDataHostPoll, type PlayerDataHostRead, type PlayerDataHostDecision, type PlayerDataHostFailure, type PlayerDataBitsValue } from "./player-data-abi.ts";
export type { CloudValue } from "./cloud-state.ts";
export type PlayerDataCallOptions = {
    timeoutMs?: number;
};
export type PlayerDataRead = {
    found: true;
    value: CloudValue;
    valueRevision: bigint;
    schemaId: string;
    schemaVersion: number;
} | {
    found: false;
    valueRevision: bigint;
};
export type PlayerDataDecision = {
    kind: "set";
    value: CloudValue;
    schemaId: string;
    schemaVersion: number;
} | {
    kind: "delete" | "keep";
};
export type PlayerDataWriteResult = {
    status: "applied" | "unchanged";
    valueRevision: bigint;
};
export type PlayerDataPendingWrite = {
    requestId: string;
    recoveryHandle?: PlayerDataRecoveryHandle<PlayerDataWriteResult>;
};
export type PlayerDataCloseResult = {
    status: "closed";
} | {
    status: "pending";
    writes: readonly PlayerDataPendingWrite[];
};
export type PlayerDataError<T = never> = {
    code: string;
    requestId: string;
    recoveryHandle?: PlayerDataRecoveryHandle<T>;
    recoveryError?: {
        code: string;
    };
};
const mint: unique symbol = Symbol("player-data-recovery");
const recoveries = new WeakMap<object, {
    owner: PlayerData;
    id: bigint;
    generation: bigint;
    epoch: number;
    requestId: string;
}>();
/** Opaque, non-serializable and invariant in its original result type. */
export class PlayerDataRecoveryHandle<T> {
    readonly #invariant?: (value: T) => T;
    constructor(token: typeof mint) { if (token !== mint)
        throw new Error("PlayerDataRecoveryHandle cannot be constructed"); }
    toJSON(): never { throw new Error("PlayerDataRecoveryHandle cannot be serialized"); }
}
const codes = new Set(["invalid_argument", "closed", "capacity_exceeded", "busy", "writer_blocked", "unavailable", "unauthorized", "deadline_exceeded", "outcome_unknown", "protocol_error", "value_too_large", "version_conflict", "rejected", "expired", "unsupported_capability", "callback_failed", "retry_exhausted"]);
function declared(value: unknown): unknown {
    if (value && typeof value === "object" && "payload" in value)
        return (value as {
            payload: unknown;
        }).payload;
    return value;
}
function code(value: unknown): string {
    const raw = declared(value);
    const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : "unavailable";
    const c = text.replaceAll("-", "_");
    return codes.has(c) ? c : "unavailable";
}
function local<T>(c: string): PlayerDataError<T> { return { code: c, requestId: "" }; }
function timeout(options?: PlayerDataCallOptions): number { const n = options?.timeoutMs ?? 5000; if (!Number.isInteger(n) || n < 1 || n > 30000)
    throw "invalid-argument"; return n; }
function bits(value: CloudValue): PlayerDataBitsValue {
    switch (value.kind) {
        case "int64":
            if (typeof value.value !== "bigint" || BigInt.asIntN(64, value.value) !== value.value)
                throw "invalid-argument";
            return { tag: "int64-bits", val: BigInt.asUintN(64, value.value) };
        case "float64": {
            if (!Number.isFinite(value.value))
                throw "invalid-argument";
            const v = new DataView(new ArrayBuffer(8));
            v.setFloat64(0, value.value);
            return { tag: "float64-bits", val: v.getBigUint64(0) };
        }
        case "bool":
            if (typeof value.value !== "boolean")
                throw "invalid-argument";
            return { tag: "bool-value", val: value.value };
        case "string":
            if (typeof value.value !== "string")
                throw "invalid-argument";
            return { tag: "string-value", val: value.value };
        case "bytes":
            if (!(value.value instanceof Uint8Array))
                throw "invalid-argument";
            return { tag: "bytes-inline", val: { data: value.value.slice() } };
        case "objectCbor":
            if (!(value.value instanceof Uint8Array))
                throw "invalid-argument";
            return { tag: "object-cbor", val: value.value.slice() };
        default: throw "invalid-argument";
    }
}
function fromBits(v: PlayerDataBitsValue): CloudValue {
    switch (v.tag) {
        case "int64-bits": return { kind: "int64", value: BigInt.asIntN(64, v.val) };
        case "float64-bits": {
            const b = new DataView(new ArrayBuffer(8));
            b.setBigUint64(0, v.val);
            const value = b.getFloat64(0);
            if (!Number.isFinite(value))
                throw "protocol-error";
            return { kind: "float64", value };
        }
        case "bool-value": return { kind: "bool", value: v.val };
        case "string-value": return { kind: "string", value: v.val };
        case "bytes-inline": return { kind: "bytes", value: v.val.data.slice() };
        case "object-cbor": return { kind: "objectCbor", value: v.val.slice() };
        default: throw "protocol-error";
    }
}
function read(v: PlayerDataHostRead): PlayerDataRead {
    if (typeof v.valueRevision !== "bigint" || v.valueRevision < 0n)
        throw "protocol-error";
    return v.value === undefined ? { found: false, valueRevision: v.valueRevision } : { found: true, value: fromBits(v.value), valueRevision: v.valueRevision, schemaId: v.schemaId, schemaVersion: v.schemaVersion };
}
function decision(d: PlayerDataDecision): PlayerDataHostDecision {
    if (d.kind === "keep" || d.kind === "delete")
        return { tag: d.kind };
    if (d.kind !== "set" || typeof d.schemaId !== "string" || !Number.isInteger(d.schemaVersion) || d.schemaVersion < 0 || d.schemaVersion > 0xffffffff)
        throw "invalid-argument";
    return { tag: "set", val: { value: bits(d.value), schemaId: d.schemaId, schemaVersion: d.schemaVersion } };
}
type Slot = {
    id: bigint;
    kind: "read" | "update" | "close" | "resume";
    transform?: (v: Readonly<PlayerDataRead>) => PlayerDataDecision;
    proposed?: bigint;
    resolve: (v: unknown) => void;
    reject: (e: PlayerDataError<unknown>) => void;
    generation: bigint;
    epoch: number;
    ticket: ReturnType<typeof captureAsyncSettlementTicket>;
    original?: PlayerDataRecoveryHandle<PlayerDataWriteResult>;
    onClosed?: () => void;
};
export class PlayerDataTarget {
    #closed = false;
    #fullyClosed = false;
    constructor(private readonly owner: PlayerData, private readonly id: bigint, readonly roleId: string, private readonly generation: bigint, private readonly epoch: number) { }
    getAsync(key: string, options?: PlayerDataCallOptions): Promise<PlayerDataRead> { return this.#closed ? this.owner.reject(local("closed")) : this.owner.start(this.id, key, "read", this.generation, this.epoch, options); }
    updateAsync(key: string, transform: (current: Readonly<PlayerDataRead>) => PlayerDataDecision, options?: PlayerDataCallOptions): Promise<PlayerDataWriteResult> { return this.#closed ? this.owner.reject(local("closed")) : this.owner.start(this.id, key, "update", this.generation, this.epoch, options, transform); }
    closeAsync(options?: PlayerDataCallOptions): Promise<PlayerDataCloseResult> {
        this.#closed = true;
        if (this.#fullyClosed)
            return this.owner.closed(this.generation, this.epoch, options);
        return this.owner.close(this.id, this.generation, this.epoch, options, () => {
            if (!this.#fullyClosed) {
                this.#fullyClosed = true;
                this.owner.releaseTarget(this.id, this.generation, this.epoch);
            }
        });
    }
}
/** Room-scoped authoritative target access. Runtime never falls back to a local store. */
export class PlayerData {
    #slots = new Map<bigint, Slot>();
    #cursor = 0;
    #ready = new Set<bigint>();
    constructor() { registerAsyncSource(ASYNC_SOURCE_PLAYER_DATA, () => this.#slots.size > 0, (id) => { if (this.#slots.has(id) && this.#ready.size < 64)
        this.#ready.add(id); }); }
    private host(): PlayerDataHost { const h = currentRoomHost(); if (!h?.playerDataOpen || !admitAsyncRuntime())
        throw "unsupported-capability"; return h as PlayerDataHost; }
    private valid(generation: bigint, epoch: number): boolean { return currentAsyncSettlementEpoch() === epoch && observeAsyncGeneration() === generation && generation > 0n; }
    /** @internal */
    reject<T>(error: PlayerDataError<T>): Promise<T> { return Promise.reject(error); }
    openAsync(roleId: string, options?: PlayerDataCallOptions): Promise<PlayerDataTarget> {
        try {
            timeout(options);
            const h = this.host();
            const generation = observeAsyncGeneration();
            const epoch = currentAsyncSettlementEpoch();
            const id = h.playerDataOpen(roleId).id;
            const ticket = captureAsyncSettlementTicket();
            return new Promise<PlayerDataTarget>((resolve) => scheduleDeferredSettlement(() => this.valid(generation, epoch), () => resolve(new PlayerDataTarget(this, id, roleId, generation, epoch)), ticket));
        }
        catch (e) {
            return this.reject(local(code(e)));
        }
    }
    private add<T>(id: bigint, kind: Slot["kind"], generation: bigint, epoch: number, transform?: Slot["transform"], original?: Slot["original"]): Promise<T> {
        if (this.#slots.has(id))
            throw "protocol-error";
        return new Promise<T>((resolve, reject) => this.#slots.set(id, { id, kind, generation, epoch, transform, original, ticket: captureAsyncSettlementTicket(), resolve: resolve as Slot["resolve"], reject }));
    }
    /** @internal */
    start<T>(target: bigint, key: string, kind: "read" | "update", generation: bigint, epoch: number, options?: PlayerDataCallOptions, transform?: Slot["transform"]): Promise<T> {
        try {
            const h = this.host();
            if (!this.valid(generation, epoch))
                throw "closed";
            if (this.#slots.size >= 64)
                throw "capacity-exceeded";
            if (kind === "update" && typeof transform !== "function")
                throw "invalid-argument";
            return this.add(h.playerDataStart({ id: target }, key, kind, timeout(options)).id, kind, generation, epoch, transform);
        }
        catch (e) {
            return this.reject(local(code(e)));
        }
    }
    /** @internal: admission closes before any Promise is returned. */
    close(target: bigint, generation: bigint, epoch: number, options?: PlayerDataCallOptions, onClosed?: () => void): Promise<PlayerDataCloseResult> {
        try {
            const h = this.host();
            if (!this.valid(generation, epoch))
                throw "closed";
            let ms = 5000;
            let invalid = false;
            try {
                ms = timeout(options);
            }
            catch {
                invalid = true;
            }
            const id = h.playerDataCloseStart({ id: target }, ms).id;
            if (invalid) {
                h.playerDataReleaseOperation({ id });
                throw "invalid-argument";
            }
            const result = this.add<PlayerDataCloseResult>(id, "close", generation, epoch);
            this.#slots.get(id)!.onClosed = onClosed;
            return result;
        }
        catch (e) {
            return this.reject(local(code(e)));
        }
    }
    /** @internal */
    closed(generation: bigint, epoch: number, options?: PlayerDataCallOptions): Promise<PlayerDataCloseResult> {
        try {
            timeout(options);
            if (!this.valid(generation, epoch))
                throw "closed";
            const ticket = captureAsyncSettlementTicket();
            return new Promise((resolve) => scheduleDeferredSettlement(() => this.valid(generation, epoch), () => resolve({ status: "closed" }), ticket));
        }
        catch (e) {
            return this.reject(local(code(e)));
        }
    }
    /** @internal */
    releaseTarget(id: bigint, generation: bigint, epoch: number): void { if (this.valid(generation, epoch)) {
        try {
            currentRoomHost()?.playerDataReleaseTarget?.({ id });
        }
        catch { /* Cleanup does not change a verdict. */ }
    } }
    private recovery(id: bigint, generation: bigint, epoch: number, requestId: string): PlayerDataRecoveryHandle<PlayerDataWriteResult> { const h = new PlayerDataRecoveryHandle<PlayerDataWriteResult>(mint); recoveries.set(h, { owner: this, id, generation, epoch, requestId }); return h; }
    resumeAsync(handle: PlayerDataRecoveryHandle<PlayerDataWriteResult>, options?: PlayerDataCallOptions): Promise<PlayerDataWriteResult> {
        const r = recoveries.get(handle);
        if (!r || r.owner !== this || !this.valid(r.generation, r.epoch))
            return this.reject({ ...local("outcome_unknown"), requestId: r?.requestId ?? "", recoveryError: { code: "expired" } });
        try {
            const id = this.host().playerDataResume({ id: r.id }, timeout(options)).id;
            return this.add(id, "resume", r.generation, r.epoch, undefined, handle);
        }
        catch (e) {
            const raw = declared(e) as Partial<PlayerDataHostFailure>;
            return this.reject({ code: "outcome_unknown", requestId: typeof raw?.requestId === "string" && raw.requestId ? raw.requestId : r.requestId, ...(["expired", "closed"].includes(code(raw?.recoveryError ?? raw?.code ?? e)) ? {} : { recoveryHandle: handle }), recoveryError: { code: code(raw?.recoveryError ?? raw?.code ?? e) } });
        }
    }
    releaseRecovery(handle: PlayerDataRecoveryHandle<PlayerDataWriteResult>): void { const r = recoveries.get(handle); if (!r || r.owner !== this)
        return; if (this.valid(r.generation, r.epoch))
        currentRoomHost()?.playerDataReleaseRecovery?.({ id: r.id }); recoveries.delete(handle); }
    private finish(slot: Slot, value: unknown, error?: PlayerDataError<unknown>): void {
        this.#slots.delete(slot.id);
        this.#ready.delete(slot.id);
        try {
            currentRoomHost()?.playerDataReleaseOperation?.({ id: slot.id });
        }
        catch { /* Keep the observed verdict. */ }
        scheduleDeferredSettlement(() => this.valid(slot.generation, slot.epoch), () => { if (!error && slot.kind === "close" && (value as PlayerDataCloseResult).status === "closed")
            slot.onClosed?.(); error ? slot.reject(error) : slot.resolve(value); }, slot.ticket);
    }
    private failure(f: PlayerDataHostFailure, slot: Slot): PlayerDataError<unknown> {
        const c = code(f.code);
        const err: PlayerDataError<unknown> = { code: c, requestId: f.requestId };
        if (f.recovery)
            err.recoveryHandle = this.recovery(f.recovery.id, slot.generation, slot.epoch, f.requestId) as PlayerDataRecoveryHandle<unknown>;
        if (f.recoveryError)
            err.recoveryError = { code: code(f.recoveryError) };
        if (c === "expired" && (slot.kind === "update" || slot.kind === "resume"))
            return { code: "outcome_unknown", requestId: f.requestId, recoveryError: { code: "expired" } };
        if (slot.original && c === "outcome_unknown" && !err.recoveryHandle && !["expired", "closed"].includes(err.recoveryError?.code ?? ""))
            err.recoveryHandle = slot.original as PlayerDataRecoveryHandle<unknown>;
        return err;
    }
    /** @internal: bounded fallback rescan also recovers dropped source=4 notifications. */
    drive(): void {
        syncHostGeneration();
        const slots = [...this.#slots.values()];
        let callbacks = 0;
        const picked = new Set<Slot>();
        for (let n = 0; n < Math.min(8, slots.length); n++)
            picked.add(slots[(this.#cursor + n) % slots.length]!);
        for (const id of this.#ready) {
            const slot = this.#slots.get(id);
            if (slot && picked.size < 16)
                picked.add(slot);
            this.#ready.delete(id);
            if (picked.size >= 16)
                break;
        }
        for (let n = 0; n < slots.length && picked.size < 16; n++)
            picked.add(slots[(this.#cursor + n) % slots.length]!);
        for (const slot of picked) {
            if (!this.valid(slot.generation, slot.epoch)) {
                this.#slots.delete(slot.id);
                continue;
            }
            let p: PlayerDataHostPoll;
            try {
                p = this.host().playerDataPoll({ id: slot.id });
            }
            catch {
                this.finish(slot, undefined, { code: slot.kind === "update" || slot.kind === "resume" ? "outcome_unknown" : "unavailable", requestId: "", recoveryError: { code: "unavailable" } });
                continue;
            }
            try {
                if (p.tag === "pending")
                    continue;
                if (p.tag === "needs-transform") {
                    if (slot.kind !== "update" || !slot.transform)
                        throw "protocol-error";
                    if (slot.proposed === p.val.readGeneration || callbacks >= 4)
                        continue;
                    callbacks++;
                    slot.proposed = p.val.readGeneration;
                    let proposal: PlayerDataHostDecision;
                    try {
                        const d = slot.transform(Object.freeze(read(p.val.current)));
                        if (d && typeof (d as unknown as {
                            then?: unknown;
                        }).then === "function") {
                            Promise.resolve(d).catch(() => { });
                            throw "callback-failed";
                        }
                        proposal = decision(d);
                    }
                    catch {
                        proposal = { tag: "callback-abort" };
                    }
                    this.host().playerDataPropose({ id: slot.id }, p.val.readGeneration, proposal);
                }
                else if (p.tag === "failed")
                    this.finish(slot, undefined, this.failure(p.val, slot));
                else if (p.tag === "read" && slot.kind === "read")
                    this.finish(slot, read(p.val));
                else if (p.tag === "written" && (slot.kind === "update" || slot.kind === "resume"))
                    this.finish(slot, p.val);
                else if (p.tag === "closed" && slot.kind === "close")
                    this.finish(slot, p.val.tag === "closed" ? { status: "closed" } : { status: "pending", writes: p.val.val.map((w) => ({ requestId: w.requestId, ...(w.recovery ? { recoveryHandle: this.recovery(w.recovery.id, slot.generation, slot.epoch, w.requestId) } : {}) })) });
                else
                    throw "protocol-error";
            }
            catch (e) {
                this.finish(slot, undefined, local(code(e)));
            }
        }
        this.#cursor = slots.length ? (this.#cursor + 8) % slots.length : 0;
    }
    /** @internal */
    takeAsyncDriverReadyIds(): bigint[] { const ids = [...this.#ready]; this.#ready.clear(); return ids; }
    asyncDriverIds(): bigint[] { return [...this.#slots.keys()]; }
    /** @internal: one typed poll sharing the GD/PD transform budget. */
    driveAsyncOperation(id: bigint, callbacks: number): number {
        const slot = this.#slots.get(id);
        if (!slot) return callbacks;
        do {
            if (!this.valid(slot.generation, slot.epoch)) {
                this.#slots.delete(slot.id);
                continue;
            }
            let p: PlayerDataHostPoll;
            try {
                p = this.host().playerDataPoll({ id: slot.id });
            }
            catch {
                this.failAsyncDriverSlot(slot);
                continue;
            }
            try {
                if (p.tag === "pending")
                    continue;
                if (p.tag === "needs-transform") {
                    if (slot.kind !== "update" || !slot.transform)
                        throw "protocol-error";
                    if (slot.proposed === p.val.readGeneration) continue;
                    if (callbacks <= 0) return callbacks;
                    callbacks--;
                    slot.proposed = p.val.readGeneration;
                    let proposal: PlayerDataHostDecision;
                    try {
                        const d = slot.transform(Object.freeze(read(p.val.current)));
                        if (d && typeof (d as unknown as {
                            then?: unknown;
                        }).then === "function") {
                            Promise.resolve(d).catch(() => { });
                            throw "callback-failed";
                        }
                        proposal = decision(d);
                    }
                    catch {
                        proposal = { tag: "callback-abort" };
                    }
                    this.host().playerDataPropose({ id: slot.id }, p.val.readGeneration, proposal);
                }
                else if (p.tag === "failed")
                    this.finish(slot, undefined, this.failure(p.val, slot));
                else if (p.tag === "read" && slot.kind === "read")
                    this.finish(slot, read(p.val));
                else if (p.tag === "written" && (slot.kind === "update" || slot.kind === "resume"))
                    this.finish(slot, p.val);
                else if (p.tag === "closed" && slot.kind === "close")
                    this.finish(slot, p.val.tag === "closed" ? { status: "closed" } : { status: "pending", writes: p.val.val.map((w) => ({ requestId: w.requestId, ...(w.recovery ? { recoveryHandle: this.recovery(w.recovery.id, slot.generation, slot.epoch, w.requestId) } : {}) })) });
                else
                    throw "protocol-error";
            }
            catch (e) {
                this.finish(slot, undefined, local(code(e)));
            }
        } while (false);
        return callbacks;
    }
    private failAsyncDriverSlot(slot: Slot): void {
        const error = this.failure({
            code: slot.kind === "update" || slot.kind === "resume" ? "outcome-unknown" : "unavailable",
            requestId: "", recoveryError: "unavailable",
        }, slot);
        if (slot.original && !error.requestId) {
            error.requestId = recoveries.get(slot.original)?.requestId ?? "";
        }
        this.finish(slot, undefined, error);
    }
    /** @internal: bound waits when the notification import fails. */
    failAsyncDriver(): void {
        for (const slot of [...this.#slots.values()]) {
            this.failAsyncDriverSlot(slot);
        }
    }
    /** @internal: never call a new generation with old Host IDs. */
    discard(): void { this.#slots.clear(); this.#ready.clear(); }
}
