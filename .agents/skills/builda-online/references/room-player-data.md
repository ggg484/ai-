# Async Player Data for Target Players

A Room can access the Player Data of players in the same game who are in this Room, in another Room, or offline; the target does not need to join the current Room.
Trusted Room game logic validates why it accesses a target and the business relationship; never trust a target or amount supplied by a client directly. The four client SDKs do not provide this entry point.
Open only creates a target handle for the current Room generation. It does not verify that the account exists, read the whole save, or query online status.

| Operation | TypeScript | Rust |
| --- | --- | --- |
| Target entry | `Room.playerData.openAsync(roleId, options?)` | `context.player_data().open_async(role_id, options)` |
| Authoritative single-key read | `target.getAsync(key, options?)` | `target.get_async(key, options)` |
| Single-key conditional update | `target.updateAsync(key, transform, options?)` | `target.update_async(key, options, transform)` |
| Close target | `target.closeAsync(options?)` | `target.close_async(options)` |
| Resume original write | `Room.playerData.resumeAsync(handle, options?)` | `context.player_data().resume_async(&handle, options)` |
| Release recovery material | `Room.playerData.releaseRecovery(handle)` | `context.player_data().release_recovery(&handle)` |

TypeScript returns a Promise that rejects with `PlayerDataError<T>` on failure; Rust returns `PlayerDataFuture<T>`, which outputs
`Result<T, PlayerDataError<T>>`. In synchronous Room hooks, start async work with the existing `runAsync` / `spawn_local`; never block the tick.
`timeoutMs` / `timeout_ms` defaults to 5000 and accepts 1–30000 milliseconds; queueing, reading, the callback and the commit of an Update share one total deadline.
The callback must be synchronous, pure and fast; a synchronous callback cannot be preempted. Only a definite conflict may re-read and rerun the callback, at most three extra times.
Do not send messages, deliver items, deduct other keys or cause any other side effect inside the callback.

## Values and results

Values reuse CloudValue and support bool, int64, float64, string, bytes and objectCbor. A TypeScript int64 must be a bigint;
never convert it to a number or JSON. Rust uses `PlayerDataValue` (an alias of the existing `CloudValueV1`). Byte values are raw bytes.

Read: TS returns `{ found: true, value, valueRevision, schemaId, schemaVersion }` or `{ found: false, valueRevision }`;
Rust returns `PlayerDataRead::Found { ... }` / `Missing { value_revision }`. A key that never existed has revision 0; a delete tombstone keeps its revision.
Missing only means the key has no live value; it does not mean the account does not exist. Permission, network, decoding and similar errors must not be treated as Missing.

Update callback: TS returns `{kind:"set",value,schemaId,schemaVersion}`, `{kind:"delete"}` or `{kind:"keep"}`;
Rust returns `PlayerDataDecision::Set { ... }` / `Delete` / `Keep`. Without a schema, pass an empty string and 0 explicitly.
Set/Delete commit on the condition of the revision just read. Success returns `applied` / `unchanged` plus the new or read revision;
`unchanged` only means the callback chose not to write based on that read; it does not promise the value is still unchanged when the result arrives. Success confirms the current state; it does not promise that persistence has completed synchronously.

The older in-Room cached API and the payment `doOrder`/`fulfill` flow remain. A new Get always reads authoritatively, does not flush implicitly, and is not guaranteed to see dirty values the old API has not yet committed;
a new Update may return `busy` when it meets an ordinary uncommitted write or a write race. The caches of the new and old entry points are not promised to be immediately consistent.
Do not replace the payment delivery flow with the new API, and do not read or write reserved `builda.` keys.

## Close and unknown writes

Calling Close forbids new Get/Update on that target; in Rust this does not wait for the Future's first poll. Unsent work can be cancelled; sent writes are not undone.
`closed` means no write is pending; it does not prove that earlier writes all succeeded. `pending` lists each original `requestId` / `request_id` and any available recovery handle.
Repeated Close is idempotent and can converge from pending to closed.

When you receive `outcome_unknown`, do not rerun the Update, repeat business side effects, or guess that the write failed.
If there is a `recoveryHandle` / `recovery_handle`, resume the original write with the Room-level resume; it does not rerun the callback and still works after the target is closed.
A temporary recovery failure keeps the result unknown and gives the reason in `recoveryError` / `recovery_error`. Handles cannot be constructed, serialized, or resumed in another Room.
Releasing or expiring a handle does not cancel the remote write. Without usable recovery material, check against the original business actionId and clear evidence; never infer from the current value whether a write happened.
Waiting for recovery does not extend the original recovery validity. Results and handles are kept within a bound; handle results and close targets promptly, or calls return `capacity_exceeded` when it is full.

Stable errors also include `invalid_argument`, `closed`, `busy`, `writer_blocked`, `unavailable`, `unauthorized`,
`deadline_exceeded`, `protocol_error`, `value_too_large`, `version_conflict`, `rejected`, `expired`,
`unsupported_capability`, `callback_failed` and `retry_exhausted`. These new errors do not change the contract of the older CloudStateError.

## Examples and acceptance

The shipped `player-data-example.ts` / `player_data_example.rs` examples show an authoritative read, a pure callback and Close;
they add no client protocol and do not implement a full consignment flow. There are no atomic transactions across keys or players; a full consignment flow needs its own reservation, compensation and business deduplication design.
The local Mock in the same language simulates the API, tombstone revisions and CAS. When started with the local Mock command it keeps confirmed data, so testing can continue after a restart. It does not simulate real permissions, reliable unknown-write recovery or online capacity, and connections and recovery handles are not kept across restarts.
Online acceptance must cover at least an offline target, concurrent writes from another Room, a dirty race, a definite conflict, unknown-write recovery, Close and Room exit.
