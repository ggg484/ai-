# Server-driven room switching: lobby, portal, match, return

This recipe is for a Roblox-style experience in Builda Online: ten people share a lobby; five stand in a portal;
the authoritative lobby creates a separate match room for those five. The SDK changes their connections automatically.
The other five stay in the lobby. No persistent team is created.

## Standard game flow

1. Define a Room-mode `lobby` Activity and a `battle` Activity in the same game compatibility revision.
   The battle capacity must accommodate the selected human players. This operation creates a new, closed room;
   it does not queue for other players or fill with bots.
2. Join the initial lobby through the normal SDK admission flow. Have the server validate portal membership,
   consent/readiness, current presence, and any game requirements. Never accept a client-supplied roster as authority.
3. When the portal countdown ends, freeze a business request ID, target match key, and selected role IDs in the lobby's
   checkpointed game state. Call `createRoomAndTransfer` / `create_room_and_transfer` once. Poll its operation on later
   ticks. `submitting` means locally queued, not accepted or completed. `rejected` is a definitive pre-acceptance refusal; `status_unknown` requires querying/retrying the same intent, never assuming cancellation. Retrying the same business request uses the same
   ID and exactly the same target and roster; changing any of these requires a new ID.
4. The clients receive a started notification and can show a loading overlay. The SDK obtains target admission,
   preconnects, waits for the platform decision, and releases old local handles automatically. Game code must not
   call leave, join, or accept a match from a switching callback.
5. The target reads `switchOrigin` / `context.switch_origin()` for its creation source and expected roster. Initialize
   gameplay in the normal Room lifecycle; only admitted join/reconnect callbacks represent playable members. Origin
   is immutable creation metadata: it survives restore and reconnect and does not mean every listed player is online.
6. `roomSwitchCompleted` fires only after target activation, `room_joined`, and a full target state. Replace the game's
   current Room handle and scene at this point. Filter all gameplay messages by Room ID while the scenes overlap.
   The source Room receives final member departures; its remaining players keep playing.
7. Settle the match once in authoritative Room code. Persist rewards through the normal trusted data APIs; room origin
   and client notifications are not a currency, inventory, or reward grant. To return together, create another room
   with match key `lobby` and a new settlement-scoped request ID. This API creates a **new lobby instance**;
   returning to the exact existing original lobby is a separate capability and is not provided by this API.

## TypeScript Room

Call from a server-validated portal/countdown callback. Save `request` in your existing checkpoint before retrying.
The methods are synchronous and do not block a tick; the operation is progressed by the platform.

```ts
import { createRoomAndTransfer, RoomSwitchOperation, roomSwitchOrigin, type RoomContext } from "@cysj/room";

const request = { requestId: "portal-round-42", matchKey: "battle", roleIds: ["p1", "p2", "p3", "p4", "p5"] };
const operation = createRoomAndTransfer(request);
const progress = operation.poll(); // repeat on later ticks; never busy-loop
// After restoring a saved operation ID:
const restored = new RoomSwitchOperation(operation.switchId);
// In the target's onCreate/onRestore, using the real RoomContext:
function readOrigin(context: RoomContext) { return roomSwitchOrigin(context); }
```

Room subclasses also expose protected `this.createRoomAndTransfer(request)` and `this.switchOrigin`.
Do not re-create the portal decision from the target's roster on restore.

## Rust Room

```rust
use cysj_room_sdk::{RoomContext, RoomSwitchRequest, RoomSwitchOperation};
fn leave_portal(context: &RoomContext) -> Result<RoomSwitchOperation, String> {
    context.create_room_and_transfer(RoomSwitchRequest {
        request_id: "portal-round-42".into(), match_key: "battle".into(),
        role_ids: (1..=5).map(|n| format!("p{n}")).collect(),
    })
}
fn inspect_target(context: &RoomContext) -> Result<(), String> {
    if let Some(origin) = context.switch_origin()? {
        // Use origin.switch_id, origin.source_room_id, and origin.role_ids as creation provenance.
    }
    Ok(())
}
// Keep the returned switch_id in the existing checkpoint; poll the same operation on later ticks.
```

## Client observer API

| SDK | Started / completed / failed |
| --- | --- |
| H5, Cocos | `roomSwitchStarted`, `roomSwitchCompleted`, `roomSwitchFailed` |
| Godot | `room_switch_started`, `room_switch_completed`, `room_switch_failed` |
| Unity | `RoomSwitchStarted`, `RoomSwitchCompleted`, `RoomSwitchFailed` |

H5/Cocos events use the operation ID, source and target Room IDs, current Room ID, commit state, error code, and `room`.
Godot uses snake_case Dictionary keys. Unity uses PascalCase properties on `RoomSwitchEvent`.
On completion `room` is the automatically connected target handle. The server Room SDK API is identical across client engines.
These events describe a different Room ID; existing `roomTransfer*` events describe relocation of the same Room ID.

## Disconnect and failure outcomes

| When | Outcome |
| --- | --- |
| A selected player cannot preconnect | The preparation deadline cancels the whole selected group before commit. Target admission is revoked before the source is unfrozen. Existing source membership remains subject to normal disconnect grace. |
| A player drops after ready but before commit | Readiness is invalidated; a newer connection can become ready before the deadline. Otherwise cancel. |
| A player drops after commit | The operation only moves forward. SDK recovery targets the new Room; a timeout never authorizes returning to the old Room. Normal target disconnect grace and final leave apply. |
| A notification or Gateway response is lost | Reauthenticate and discover the current operation from authenticated membership, then read its authoritative state. |
| A Room is restored or relocated | Generation and presence fences reject stale connections. Creation provenance persists; normal restore/reconnect lifecycle applies. |
| SDK cannot establish the authoritative result within its attempt budget | `ROOM_SWITCH_STATUS_UNKNOWN`. Show reconnect/retry UI. This is not proof of cancellation and must not trigger a manual source join. |
| Committed target recovery exceeds the platform deadline | `failed_after_commit`; old membership stays retired. The platform retains cleanup responsibility. Re-enter through normal admission after authoritative cleanup, never reuse old credentials. |
| Old client/Host lacks this capability | Reject explicitly with an unsupported/capability error before moving any selected member. Upgrade the installed SDK; do not emulate an online switch locally. |

## Standard tests

Run from the SDK repository root:

```sh
node online/scripts/deliverables/room-switch.test.mjs
cargo test --manifest-path online/users/sdk/server/rust/Cargo.toml room_switch
# Compile actual Unity runtime sources with only the network boundary replaced:
dotnet run --project online/scripts/tests/room-switch-unity/RoomSwitch.csproj
# Run with a Godot 4 binary and the SDK directory as the project:
godot --headless --path online/users/sdk/client/godot --script tests/room_switch_test.gd
```

Each delivered SDK archive includes `ROOM_SWITCH_STANDARD.json` with the same ten-player fixture and fault assertions.
In an extracted H5 or Cocos SDK, run `node --test tests/room-switch.test.mjs` against its delivered `dist`.
For Unity, extract `room-switch-standard.zip` beside a copy of `Runtime` in a separate test workspace outside a Unity project, then run `dotnet run --project standard-tests/RoomSwitch.csproj` with .NET 10; this checks the actual
runtime with a replaced network boundary and does not replace a Unity Player build.
The extracted Godot SDK is also a standalone test project: import it once with the editor, then run
`godot --headless --path . --script tests/room_switch_test.gd`. Copy only the add-on into a game; the test project is separate.

The executable SDK tests cover selected five/unselected five, delayed/lost state queries, initial-state completion,
observer failures, cancellation, post-commit uncertainty, and socket shutdown. They replace network boundaries and do not
prove real online allocation or server recovery. A single-Room source Mock returns capability unavailable for this
platform operation; it must not report a fake online transfer as passed.

Before releasing a switching game, run ten real clients with two Activities and record the source, target and operation IDs:
all five selected clients must end in one different Room, the other five must retain the source; repeat with one selected
client offline during preparation, then after commit; verify target reconnect and reward settlement once. Also exercise
source/target server restart and a lost notification. A local SDK regression is not this online acceptance.

The experience resembles Roblox lobby-to-reserved-server games. Roblox's own teleport API and test restrictions are
separate: see [Teleport between places](https://create.roblox.com/docs/projects/teleport). The all-selected-member commit
policy described here is Builda's protocol, not a claim about Roblox's atomicity.
