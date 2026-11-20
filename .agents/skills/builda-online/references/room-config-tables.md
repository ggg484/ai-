# Dynamic Config Tables

A **dynamic config table** is a read-only JSON table that the author publishes and the game reads at run time. Use it for data you want to change without shipping a new build, such as item stats, drop rates and event rules. The author publishes with `builda config push <table> <file>`: Rooms see the new content after about 2 seconds, and player clients within about a minute. Keep state that changes at run time out of config tables; use Game Data or Player Data for it.

Every table can be read by players. Do not put secrets or values you do not want public in a table.

## Read in a Room

Read a table by name. There are no versions to manage: a read returns the current content. A table starts loading the first time it is read on the current online server, so that read returns `pending`; read again on a later tick.

```ts
const result = this.config.read("items");
if (result.status === "ready") {
  const sword = result.table.sword;
}
```

```rust
match context.read_config("items") {
    ConfigRead::Ready(json) => { /* parse json */ }
    ConfigRead::Pending => { /* read again on the next tick */ }
    ConfigRead::NotFound => { /* this table does not exist */ }
    ConfigRead::Unavailable => { /* the read failed */ }
}
```

`unavailable` means the read failed. It is not an empty table, so never treat it as empty data. Repeated reads of unchanged content do not copy: TypeScript returns the same read-only object, so you can read every tick without caching it yourself. Rust returns a shared `Rc<str>` and you parse the JSON: keep the last `Rc` and its parsed result, and use `Rc::ptr_eq` to skip parsing when it has not changed; otherwise you parse the whole table again on every tick.

For a short time after a publish, different Rooms and players may see different content. Do not rely on an update arriving at an exact moment: publish timed events early and put the start time in the table.

## Local Mock

Put `mock_config_tables` in the scenario file; keys are table names and values are table content. Like the online service, the Mock returns `pending` on the first read.

```json
{ "mock_config_tables": { "items": { "sword": { "damage": 12 } } } }
```

## Read on the client

Clients use `Builda.config.read("items")` (`config_read` in Godot, `ConfigRead` in Unity). See the SDK guide for details.
