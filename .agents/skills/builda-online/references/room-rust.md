# Rust Room

This page is for Rust Rooms only; for general Room rules see [Room Server](development-guide-room.md). For a TypeScript Room, read
[TypeScript Room](room-typescript.md) instead.

Create a standalone `cdylib` project from the `cysj-room-sdk` template installed in the current project, depending only on the public `cysj-room-sdk`,
`serde`, and `serde_json`. The Room type implements `Default + Room`, and finally calls this once:

```rust
cysj_room_sdk::export_room!(GameRoom);
```

Implement `on_create`, `on_join`, `on_leave`, `on_message`, `on_tick`, and `on_dispose` as the game requires. The Room type must
derive `Serialize + Deserialize`; by default the SDK saves and restores the complete Room. Only override
`on_checkpoint`, `on_restore`, and `on_activated` when using a custom checkpoint format; custom restore must check `RoomSnapshot.schema_version`.

## Required memory design and review

Rust ownership prevents many invalid accesses; successful compilation does not prove bounded memory use. Before adding Room state or changing a hot callback, inventory each growing `Vec`, `String`, map, queue, cache, pending operation, and closure capture in the project's existing test/design notes. Record its owner, maximum entries, maximum bytes per entry and in total, overflow behavior, cleanup event, and whether it belongs in the checkpoint. Derive limits from the confirmed gameplay and `context.max_players`; do not invent an unbounded history or assume that a player limit bounds each player's data.

### Bound growth before allocating

- Validate input byte size, decoded string/array lengths, nesting, numeric ranges, and declared dimensions before copying into state or allocating from them. Use checked arithmetic for dimensions and byte counts. Never feed unchecked client counts into `vec![...; n]`, `with_capacity`, `reserve`, `resize`, `repeat`, or ranges collected into a collection. A short message can still request an enormous allocation.
- Enforce caps at every insertion path, including join, reconnect, Bot spawning, retries, delayed callbacks, and restored data. `with_capacity(n)` reserves space; it does not limit later growth. A bounded entry count is insufficient when values contain unbounded strings or nested collections. Cap decoded input as well as retained state; a length check after an enormous deserialization/allocation is too late.
- Give full queues an explicit gameplay policy: reject new work, replace an older update, or evict expired disposable data. Never silently discard authoritative scores, inventory, pending settlement, or deduplication records still needed to prevent duplicate rewards. Retention of idempotency records must cover the accepted retry lifetime; reject stale requests after that lifetime.
- Prefer ordinary owned state and short borrows. Do not fix borrow-checker errors by cloning the entire Room, world map, or player registry, leaking allocations with `Box::leak` / `mem::forget`, or adding global caches, raw pointers, or `unsafe`. Small bounded copies are fine when their ownership and lifetime are clear. Shared ownership is not a default fix; `Rc`/`Arc` reference cycles can retain allocations.

### Control peak allocations, not just final state size

The current online memory and checkpoint limits are in [Resource Limits](resource-limits.md). WASM memory includes more than serialized game state: budget for retained collections and their capacity, nested allocations, stack, input decoding, output serialization, checkpoint/restore buffers, and SDK overhead. A checkpoint below its limit does not prove that peak memory fits. `size_of::<GameRoom>()` does not measure the heap behind its strings, vectors, and maps.

- In message/tick loops, borrow data and produce a small update instead of `self.clone()`, cloning maps, or building a full `serde_json::Value` tree and then converting it to another string/byte buffer. Serialize the required payload once per update where the public API permits reuse; do not serialize the same full state once for each recipient. Include any simultaneous input, state, output, and snapshot copies in the estimate.
- Keep scratch buffers bounded and reuse them only up to a documented cap. `Vec::clear()` drops elements but retains the vector's capacity; retained nested values can have their own allocations. At a round boundary, drop/replace an exceptionally oversized disposable buffer if it will not be reused. Do not call `shrink_to_fit` every tick or treat it as a guaranteed memory reduction. Dropping Rust allocations does not guarantee a reduction in the reported WASM linear-memory size; check reusable capacity and live state instead of assuming every high-water mark is a leak.
- Do not put large fixed arrays on the stack to avoid heap allocation. Do not replace standard memory allocation or add extra dependencies as the first response to memory pressure. Reduce retained data and simultaneous copies first. Do not rely on `catch_unwind`, `unwrap`, or `expect` to recover from allocation exhaustion; enforce bounds before the allocation. Handle ordinary decoding/serialization failures through the existing callback/API contract.

### Tie cleanup to lifecycle and recovery

Keep authoritative data needed for recovery in the Room's serialized state. Rebuildable indexes or scratch buffers may use `#[serde(skip)]` only with a valid default and an explicit bounded rebuild before gameplay resumes. Never skip authoritative state merely to silence checkpoint-size warnings. Test that restored scores, timers, entity IDs, pending settlement, and deduplication behavior remain equivalent.

On abnormal disconnect, preserve the bounded state required by the reconnect grace period. On final leave, remove disposable player/session indexes, queued transient inputs, and stale references; retain only the bounded authoritative records still required by gameplay. A looping Room must clear round-specific entities, timers, queues, and disposable history before the next round. Long-lived Rooms must expire disposable entries during normal operation; cleanup only in `on_dispose` is insufficient. Pending callbacks must not retain an entire Room snapshot or stale player state indefinitely.

### Required local evidence

For a new Rust Room, or changes to retained state, allocation, serialization, or cleanup:

1. Test the configured maximum population and entity counts; exercise each new cap at its boundary and one item/byte beyond it. Include repeated/oversized requests and large declared dimensions. Confirm the overflow policy runs without first allocating the requested huge object.
2. Run at least 20 relevant round/reset or join/final-leave cycles. For a looping Room, reuse the same Room; for a long-lived Room, churn players and temporary entities. Record collection lengths, capacities where available, and serialized checkpoint bytes at equivalent lifecycle points. Counts must return to the documented baseline; a deliberately reused bounded capacity may plateau instead of shrinking. Do not log player payloads or credentials.
3. Exercise checkpoint/restore round-trip tests directly through the public Room callbacks in local tests when serialized state or skipped caches change; assert authoritative equivalence and bounded cache rebuilds. The Mock's periodic checkpoint measurement does not execute restoration.
4. Read the Mock's `resource_diagnostics` after gameplay and resolve warnings. Report `rust_memory_review: passed | failed | blocked` with the inventory, tested caps, cleanup/restore evidence, and remaining uncertainty. Neither a green build, a zero-warning Mock report, native process RSS, nor checkpoint bytes prove the online WASM memory peak. Online memory verification remains pending until actually observed; deploy only when separately authorized.

Rust reference: [`Vec` capacity and clearing](https://doc.rust-lang.org/std/vec/struct.Vec.html), [`mem::forget` and skipped destruction](https://doc.rust-lang.org/std/mem/fn.forget.html).

## Public capabilities

- `context.broadcast(type, &payload)` / `client.send(type, &payload)`: reliable binary broadcast and unicast; when JSON is needed, explicitly use
  `broadcast_json` / `send_json`.
- `context.broadcast_on` / `client.send_on`: binary broadcast or unicast on a chosen logical channel; the corresponding JSON convenience methods are
  `broadcast_json_on` / `send_json_on`. Online WebRTC and the standalone WSS fallback both carry the same binary gameplay frames.
- `context.set_state(&state)` / `context.patch_state(&patch)`: full state and state patch.
- `message.json::<T>()`: parse the client payload into strongly typed input.
- `context.log(level, message)`: write bounded Room logs that are visible locally and queryable online for a short period; for query, quota, privacy, and performance rules,
  read the separate `builda-online-diagnostics` Skill. Exceeding the limit only drops logs and does not affect the Room.
- `context.disconnect(reason)`: request closing the Room.
- `context.random_u64()`: use the migratable host random sequence.
- `context.unix_time_millis()`: read trusted UTC Unix milliseconds as `i64`. It is fixed within one lifecycle callback, and never goes backwards for the same Room across callbacks,
  migration, and failure recovery; use it only for event times and absolute deadlines.
- `cysj_room_sdk::do_order(order_id, callback)` / `fulfill(&[...])`: verify the ext-pay order and write the goods inside the `Allowed`
  callback; do not read or write `builda.`, and do not call `cloud_enqueue_state` / flush inside the callback. The order is in `Allowed(order)`.
  `AlreadyDelivered` means it was already granted. See [Development Guide "Server-side fulfillment of paid orders"](development-guide.md#server-side-fulfillment-of-paid-orders).
- `cysj_room_sdk::cloud_data_bindings` 's `cloud_state_api`: `cloud_enqueue_state`,
  `cloud_read_current`, `cloud_read_many_current`, `cloud_flush_barrier` + `cloud_poll_flush`,
  `cloud_get_snapshot` + `cloud_poll_snapshot`. A successful `cloud_enqueue_state` means the write is queued; when you need to confirm the batch has taken effect,
  use `cloud_flush_barrier` + poll to wait for `applied`. An existing snapshot does not refresh automatically. `role_id` must use `client.user_id`; the client SDK does not provide
  player data APIs. The TypeScript local Mock can simulate locally; the Rust Mock mainly covers the payment-window `fulfill`. Neither impersonates production storage.
- `RoomSnapshot::json(version, &state)` / `snapshot.decode_json()`: migration snapshot.

For complete examples in both languages see [Player Data and Payment Fulfillment](room-cloud-state-and-payment.md).

Rust Rooms likewise must never use the network, files, databases, environment variables, or any system clock. Do not use std `HashMap`, `HashSet`, or `RandomState`: their random seed imports `wasi:random/insecure-seed`, and deployment rejects the Room with `ROOM_ARTIFACT_VALIDATION_FAILED` although it builds locally; use `BTreeMap` / `BTreeSet`. Do not add the WASI wall-clock capability; advance gameplay elapsed
time and countdowns with `on_tick(delta_ms)`, and never use Unix timestamps to advance physics simulation, generate unique IDs, or decide replayable random
outcomes. Lifecycle functions must not block or perform unbounded computation. The following commands are only for local pre-checks:

## Lifecycle example

Use the shipped [Rust Room example](../examples/room-supported-modes.rust.rs) as the complete, compilable reference for Room lifecycle and settlement. Read only the branch matching the confirmed gameplay; do not enable its other modes in the user's game. Keep the example's public API signatures and adapt the game rules and bounded state.

For JSON settlement messages, use `context.broadcast_json("199", &result)` and handle its `Result`; `context.broadcast` accepts `&[u8]` and returns `()`. `RoomClient.user_id` is a field. Key persistent player state by that stable identity; use `session_id` only for connection-specific indexes.

For a single-match Room, persist the final result and close deadline, notify clients, and let clients complete their active leave. After the final leave, schedule close for a later tick; retain the bounded fallback deadline when someone fails to leave. A looping Room instead resets its round state and reopens for the next round. Keep delayed-close flags, timers, and settlement identity in recoverable state. Do not close in the callback that emits the final settlement.

```powershell
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
```

For an online release, upload the complete Workspace source package containing `Cargo.toml`, `Cargo.lock`, and local crates, to be compiled by
the platform. Follow [Online Deployment Workflow](deployment.md) for all deployment rules; never mistake the Builda
client draft upload command for the Room deployment command, and never call platform internal APIs yourself. Do not upload a local WASM yourself,
and do not put `target/`, `.git/`, `.cargo/`, `vendor/`, or `rust-toolchain*` into the source package; only after the build succeeds,
explicitly activate the new Match Activity.
